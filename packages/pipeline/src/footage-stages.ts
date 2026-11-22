import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { footageEditor, type AgentResult } from "@ys/agents";
import { errorText, LocalizedError, msg, type Text, type Timeline, type WordTiming } from "@ys/core";
import type { MediaGateway, RunOptions } from "@ys/media-gateway";
import type { AssetStore } from "@ys/storage";
import { FOOTAGE, FOOTAGE_TYPES, fitCuts, footageKindOf, footageTimeline, frameTimes, isFootageExt, normalizePlan, type FootageCut, type FootageSource } from "./footage.ts";
import { cutVideo, extractAudio, frameImage, probeMedia, sampleFrame } from "./footage-media.ts";
import type { EpisodeState, Stage } from "./state.ts";

type StageFn = (state: EpisodeState, opts: { signal?: AbortSignal }) => Promise<void>;

/** Pipeline'ın footage aşamalarına açtığı yardımcılar (sınıfın özel yöntemleri kapanışla gelir). */
export interface FootageContext {
  store: AssetStore;
  gateway: MediaGateway;
  workDir: string;
  log(text: Text): void;
  save(state: EpisodeState): Promise<void>;
  agent<T>(state: EpisodeState, stage: Stage, call: Promise<AgentResult<T>>): Promise<T>;
  agentDeps(): Parameters<typeof footageEditor>[1];
  runOptions(state: EpisodeState, stage: Stage, signal?: AbortSignal, refId?: string): RunOptions;
  /** Bölümün timeline aşamasıyla aynı müzik ve efekt izleri. */
  music(state: EpisodeState, timeline: Timeline): Promise<void>;
  soundEffects(state: EpisodeState, timeline: Timeline): Promise<void>;
}

const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const prefix = (id: string) => `assets/footage/${id}`;

/** Footage Short süresi Shorts sınırları içinde olmalı. */
export function checkFootageInput(input: { targetSec: number; footage?: { sources: unknown[]; pending?: unknown[] } }): void {
  if (!input.footage?.sources.length && !input.footage?.pending?.length) throw new LocalizedError(msg("err.footage.none"));
  if (!(input.targetSec >= FOOTAGE.minSec && input.targetSec <= FOOTAGE.maxSec)) {
    throw new LocalizedError(msg("err.footage.duration", { min: FOOTAGE.minSec, max: FOOTAGE.maxSec, sec: input.targetSec }));
  }
}

/**
 * Kullanıcının dosyalarını bölüme ekler: tür izin listesinden, ölçüler ffprobe'dan (görüntüsü olmayan dosya reddedilir),
 * içerik adresli anahtar bölümün klasöründe (bölüm silinince gider). Aynı dosya iki kez eklenmez.
 */
export async function addFootageSources(
  store: AssetStore,
  state: EpisodeState,
  files: { name: string; path: string }[],
  read: (path: string) => Promise<Uint8Array>,
): Promise<FootageSource[]> {
  const footage = (state.input.footage ??= { sources: [], narration: true, transcribe: true, texts: [] });
  const added: FootageSource[] = [];
  for (const f of files) {
    const ext = extname(f.name).slice(1).toLowerCase();
    if (!isFootageExt(ext)) throw new LocalizedError(msg("err.footage.type", { name: f.name }));
    const kind = footageKindOf(ext);
    const info = await probeMedia(f.path, kind);
    const bytes = await read(f.path);
    const key = `${prefix(state.id)}/src/${hash(bytes).slice(0, 24)}.${ext}`;
    if (footage.sources.some((s) => s.key === key)) continue;
    await store.put(key, bytes, FOOTAGE_TYPES[ext]);
    const source: FootageSource = { id: `f${footage.sources.length + 1}`, key, name: basename(f.name), ext, ...info };
    footage.sources.push(source);
    added.push(source);
  }
  return added;
}

/**
 * Footage modunun aşamaları; verilmeyenler (ses, render, paket, Short) bölümün normal aşamalarıdır. Stil, kadro, konsept
 * ve kare aşamaları boştur: görüntü kullanıcınındır.
 */
export function footageStages(ctx: FootageContext): Partial<Record<Stage, StageFn>> {
  const noop: StageFn = async () => {};

  /** Kaynağın yerel kopyası (render klasöründe, bir kez indirilir): ffmpeg dosyadan okur. */
  const local = async (state: EpisodeState, src: FootageSource): Promise<string> => {
    const dir = resolve(ctx.workDir, state.id, "footage");
    const file = join(dir, basename(src.key));
    if (existsSync(file)) return file;
    const bytes = await ctx.store.get(src.key);
    if (!bytes) throw new LocalizedError(msg("err.store.missing", { key: src.key }));
    await mkdir(dir, { recursive: true });
    await writeFile(file, bytes);
    return file;
  };

  const sourcesOf = (state: EpisodeState) => state.input.footage!.sources;

  return {
    style: noop,
    cast: noop,
    concept: noop,
    keyframes: noop,
    review: noop,

    /** Tarama: her kaynaktan kareler ve (açıksa) konuşma dökümü. Taranmış kaynak yeniden taranmaz. */
    story: async (state, opts) => {
      checkFootageInput(state.input);
      const footage = state.input.footage!;
      // Stüdyo'dan yüklenenler: ölçülüp bölüme alınır, bekleme alanından silinir (her dosyadan sonra kaydedilir).
      while (footage.pending?.length) {
        const p = footage.pending[0]!;
        const bytes = await ctx.store.get(p.key);
        if (!bytes) throw new LocalizedError(msg("err.store.missing", { key: p.key }));
        const dir = resolve(ctx.workDir, state.id, "upload");
        await mkdir(dir, { recursive: true });
        const file = join(dir, basename(p.key));
        await writeFile(file, bytes);
        await addFootageSources(ctx.store, state, [{ name: p.name, path: file }], async () => bytes);
        footage.pending.shift();
        if (!footage.pending.length) delete footage.pending;
        await ctx.store.delete(p.key);
        await ctx.save(state);
      }
      const scans = (state.footageScan ??= {});
      const times = frameTimes(footage.sources);
      for (const src of footage.sources) {
        if (scans[src.id]) continue;
        const file = await local(state, src);
        const frames: { atMs: number; key: string }[] = [];
        for (const at of times[src.id]!) {
          const bytes = await sampleFrame(file, at, src.kind);
          const key = `${prefix(state.id)}/frames/${src.id}-${at}.jpg`;
          await ctx.store.put(key, bytes, "image/jpeg");
          frames.push({ atMs: at, key });
        }
        let words: WordTiming[] | undefined;
        if (footage.transcribe && src.audio) {
          try {
            const wav = await extractAudio(file, { stt: true });
            const res = await ctx.gateway.generate(
              { capability: "stt", quality: "standard", language: state.input.lang, durationSec: src.durationMs / 1000, refs: [{ role: "source_audio", bytes: wav, mimeType: "audio/wav" }] },
              ctx.runOptions(state, "story", opts.signal, src.id),
            );
            words = res.words ?? [];
          } catch (e) {
            if (opts.signal?.aborted) throw e;
            // Döküm yoksa kurgu karelerle sürer; altyazı yalnız anlatımdan gelir.
            ctx.log(msg("log.footage.sttSkipped", { id: src.id, error: errorText(e) }));
          }
        }
        scans[src.id] = { frames, ...(words ? { words } : {}) };
        await ctx.save(state);
        ctx.log(
          msg("log.footage.scan", {
            id: src.id,
            kind: src.kind,
            sec: (src.durationMs / 1000).toFixed(1),
            frames: frames.length,
            speech: words?.length ? msg("log.footage.speech", { words: words.length }) : "",
          }),
        );
      }
    },

    /** Kurgu: ajan karelere ve dökümlere bakar; kod kuralları uygular. Senaryo vuruşlardır (seslendirme sahne başına). */
    script: async (state) => {
      const footage = state.input.footage!;
      const scans = state.footageScan ?? {};
      const sources = await Promise.all(
        footage.sources.map(async (s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          durationSec: s.durationMs / 1000,
          width: s.width,
          height: s.height,
          audio: s.audio,
          frames: await Promise.all(
            (scans[s.id]?.frames ?? []).map(async (f) => {
              const data = await ctx.store.get(f.key);
              if (!data) throw new LocalizedError(msg("err.store.missing", { key: f.key }));
              return { atSec: f.atMs / 1000, image: { data, mimeType: "image/jpeg" } };
            }),
          ),
          ...(scans[s.id]?.words ? { words: scans[s.id]!.words } : {}),
        })),
      );
      const out = await ctx.agent(
        state,
        "script",
        footageEditor({ brief: state.input.topic, lang: state.input.lang, targetSec: state.input.targetSec, narration: footage.narration, texts: footage.texts, sources }, ctx.agentDeps()),
      );
      const plan = normalizePlan(out, footage);
      state.footagePlan = plan;
      state.story = { title: plan.title || state.input.topic, logline: state.input.topic, premise: "", hook: plan.beats[0]!.narration, beats: [] };
      state.script = {
        scenes: plan.beats.map((b) => ({ id: b.id, beatId: b.id, narration: b.narration, visualIntent: b.segments.map((s) => s.why).join("; "), emotion: b.mood, location: "" })),
      };
      // Yeni kurgu: eski zamanlama ve kesimler geçersiz.
      delete state.footageCuts;
      ctx.log(msg("log.footage.plan", { beats: plan.beats.length, segments: plan.beats.reduce((n, b) => n + b.segments.length, 0), overlays: plan.overlays.length }));
    },

    /** Zamanlama: vuruşlar ses süresine ve hedefe oturur; her parça bir çekim. */
    shots: async (state) => {
      const plan = state.footagePlan;
      if (!plan) throw new LocalizedError(msg("err.missing", { what: "footagePlan" }));
      const voiceMs = Object.fromEntries(Object.entries(state.voice ?? {}).map(([id, v]) => [id, v.durationMs]));
      const cuts = fitCuts(plan, sourcesOf(state), voiceMs, state.input.targetSec * 1000);
      state.footageCuts = cuts;
      state.shots = cuts.map((c) => ({
        id: c.id,
        sceneId: c.beat,
        kind: c.kind === "video" ? ("footage" as const) : ("still_motion" as const),
        startMs: c.startMs,
        endMs: c.startMs + c.durMs,
        description: c.why,
        imagePrompt: "",
        motionPrompt: "",
        camera: c.kind === "video" ? ("static" as const) : ("push_in" as const),
      }));
      const end = cuts.reduce((a, c) => Math.max(a, c.startMs + c.durMs), 0);
      ctx.log(msg("log.footage.fit", { sec: (end / 1000).toFixed(1), target: state.input.targetSec }));
    },

    /** Kesim: parçalar dikey kareye oturtulur, sesleri ayrı iz olur. Parmak izi aynı parça yeniden kesilmez. */
    clips: async (state) => {
      const cuts = state.footageCuts;
      if (!cuts) throw new LocalizedError(msg("err.missing", { what: "footageCuts" }));
      const { width, height, fps } = state.input;
      const assets = (state.footageAssets ??= { visual: {}, audio: {}, sig: {} });
      const byId = new Map(sourcesOf(state).map((s) => [s.id, s]));
      for (const c of cuts) {
        const src = byId.get(c.source)!;
        const sig = hash(JSON.stringify([src.key, c.kind, c.fromMs, c.toMs, c.speed, c.focusX, c.fit, c.audio, width, height, fps])).slice(0, 24);
        if (assets.sig[c.id] === sig) continue;
        const file = await local(state, src);
        const dir = `${prefix(state.id)}/cuts`;
        if (c.kind === "video") {
          // Geçiş payı (FOOTAGE.tailMs): parça sonrakinin geçişi boyunca oynamaya devam eder.
          const toMs = Math.min(src.durationMs, c.toMs + FOOTAGE.tailMs * c.speed);
          const video = await cutVideo(file, { fromMs: c.fromMs, toMs, focusX: c.focusX, fit: c.fit, width, height, fps, speed: c.speed });
          assets.visual[c.id] = `${dir}/${sig}.mp4`;
          await ctx.store.put(assets.visual[c.id]!, video, "video/mp4");
        } else {
          const still = await frameImage(file, { focusX: c.focusX, fit: c.fit, width, height });
          assets.visual[c.id] = `${dir}/${sig}.jpg`;
          await ctx.store.put(assets.visual[c.id]!, still, "image/jpeg");
        }
        if (c.audio !== "mute") {
          const audio = await extractAudio(file, { fromMs: c.fromMs, toMs: c.toMs, speed: c.speed });
          assets.audio[c.id] = `${dir}/${sig}.wav`;
          await ctx.store.put(assets.audio[c.id]!, audio, "audio/wav");
        } else delete assets.audio[c.id];
        assets.sig[c.id] = sig;
        await ctx.save(state);
        ctx.log(cutLog(c));
      }
    },

    /** Timeline: parçalar, anlatım, kaynak ses, altyazı ve ekran yazıları; sonra müzik ve efekt. */
    timeline: async (state) => {
      const { footagePlan: plan, footageCuts: cuts, footageAssets: assets } = state;
      if (!plan || !cuts || !assets) throw new LocalizedError(msg("err.missing", { what: "footagePlan/footageCuts/footageAssets" }));
      const timeline = footageTimeline({
        episodeId: state.id,
        lang: state.input.lang,
        fps: state.input.fps,
        width: state.input.width,
        height: state.input.height,
        plan,
        cuts,
        assets,
        voice: state.voice ?? {},
        scans: state.footageScan ?? {},
      });
      state.timeline = timeline;
      if (state.input.sfx !== false) await ctx.soundEffects(state, timeline);
      if (state.input.music !== false) await ctx.music(state, timeline);
      const sec = timeline.durationInFrames / timeline.fps;
      ctx.log(msg("log.timeline.done", { min: (sec / 60).toFixed(1), visuals: timeline.visuals.length }));
    },
  };
}

const cutLog = (c: FootageCut): Text =>
  msg("log.footage.cut", { id: c.id, source: c.source, from: (c.fromMs / 1000).toFixed(1), to: (c.toMs / 1000).toFixed(1), slow: c.speed < 1 ? ` ×${c.speed.toFixed(2)}` : "" });
