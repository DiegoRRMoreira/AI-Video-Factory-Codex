import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { youtubeAnalyst, youtubeCurator, type YoutubeWindowOut } from "@ys/agents";
import { errorText, LocalizedError, msg, type WordTiming } from "@ys/core";
import { getJson, putJson } from "@ys/storage";
import type { FootageContext } from "./footage-stages.ts";
import { extractAudio, probeMedia } from "./footage-media.ts";
import { STAGES, type EpisodeState, type Stage } from "./state.ts";
import {
  heatmapIn,
  heatPeaks,
  mergeWindows,
  metaOf,
  normalizeCandidates,
  parseJson3,
  pickCaptions,
  planWindows,
  sceneFrameTimes,
  scenesFrom,
  sheetsOf,
  YOUTUBE,
  youtubeMaxMs,
} from "./youtube.ts";
import { contactSheet, detectScenes, downloadCaptions, downloadVideo, longSilences, thumbAt, youtubeInfo } from "./youtube-media.ts";

type StageFn = (state: EpisodeState, opts: { signal?: AbortSignal }) => Promise<void>;

/** Kütüphane anahtarının paylaşılan yerel kopyası (analiz ve ondan türeyen Short'lar aynı dosyayı kullanır). */
export const libraryFile = (workDir: string, key: string) => resolve(workDir, "_library", ...key.split("/"));

const hash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 16);
/** Pencerenin parmak izi: aralığı ve kareleri aynıysa önceki analizi geçerlidir. */
const sigOf = (w: { fromMs: number; toMs: number; frames: { atMs: number }[] }) => hash(JSON.stringify([w.fromMs, w.toMs, w.frames.map((f) => f.atMs)]));
/** Kare yakalama sırasında kaç karede bir kaydedilir (yarıda kalan iş baştan başlamasın). */
const SAVE_EVERY = 25;

/**
 * YouTube analiz bölümünün aşamaları: story indirir ve ölçer, script analiz eder; diğer bütün aşamalar boştur (analiz
 * bölümü render etmez, Short'lar ayrı footage bölümleridir).
 */
export function youtubeStages(ctx: FootageContext): Record<Stage, StageFn> {
  const noop: StageFn = async () => {};
  const stages = Object.fromEntries(STAGES.map((s) => [s, noop])) as Record<Stage, StageFn>;

  /** İndirilmiş videonun yerel yolu: yoksa depodan bir kez kopyalanır. */
  const videoFile = async (key: string): Promise<string> => {
    const file = libraryFile(ctx.workDir, key);
    if (existsSync(file)) return file;
    const bytes = await ctx.store.get(key);
    if (!bytes) throw new LocalizedError(msg("err.store.missing", { key }));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return file;
  };

  const wordsOf = async (state: EpisodeState): Promise<WordTiming[]> => {
    const key = state.youtube?.transcript?.key;
    return key ? ((await getJson<WordTiming[]>(ctx.store, key)) ?? []) : [];
  };

  stages.story = async (state, opts) => {
    const input = state.input.youtube!;
    const yt = (state.youtube ??= {});
    const base = `library/youtube/${input.videoId}`;

    // 1. Bilgi: süre sınırı, altyazı seçimi.
    if (!yt.meta) {
      const info = await youtubeInfo(input.url);
      const meta = metaOf(info, input.videoId);
      if (meta.durationMs > youtubeMaxMs()) throw new LocalizedError(msg("err.youtube.long", { min: Math.round(meta.durationMs / 60_000), max: Math.round(youtubeMaxMs() / 60_000) }));
      yt.meta = meta;
      yt.captions = pickCaptions(info, state.input.lang) ?? null;
      await ctx.save(state);
      ctx.log(msg("log.youtube.meta", { title: meta.title, min: (meta.durationMs / 60_000).toFixed(1), captions: yt.captions ? `${yt.captions.lang}${yt.captions.auto ? " (auto)" : ""}` : "-" }));
    }

    // 2. Video: kütüphanede varsa yeniden indirilmez.
    if (!yt.video) {
      const key = `${base}/video.mp4`;
      const file = libraryFile(ctx.workDir, key);
      if (!(await ctx.store.list(key)).includes(key)) {
        ctx.log(msg("log.youtube.download", { id: input.videoId }));
        const tmp = `${file}.download`;
        const got = await downloadVideo(input.url, tmp);
        const bytes = new Uint8Array(await readFile(got));
        await ctx.store.put(key, bytes, "video/mp4");
        await mkdir(dirname(file), { recursive: true });
        await rename(got, file);
        await rm(tmp, { recursive: true, force: true });
      }
      const info = await probeMedia(await videoFile(key), "video");
      yt.video = { key, durationMs: info.durationMs, width: info.width, height: info.height, audio: info.audio };
      await ctx.save(state);
    }
    const file = await videoFile(yt.video.key);

    // 3. Döküm: altyazı, yoksa (açıksa) konuşma tanıma.
    if (!yt.transcript) {
      let words: WordTiming[] = [];
      let source: "manual" | "auto" | "stt" | "none" = "none";
      if (yt.captions) {
        const text = await downloadCaptions(input.url, yt.captions);
        words = text ? parseJson3(text) : [];
        if (words.length) source = yt.captions.auto ? "auto" : "manual";
      }
      if (!words.length && input.transcribe !== false && yt.video.audio) {
        try {
          const wav = await extractAudio(file, { stt: true });
          const res = await ctx.gateway.generate(
            { capability: "stt", quality: "standard", language: yt.meta.language ?? state.input.lang, durationSec: yt.video.durationMs / 1000, refs: [{ role: "source_audio", bytes: wav, mimeType: "audio/wav" }] },
            ctx.runOptions(state, "story", opts.signal, input.videoId),
          );
          words = res.words ?? [];
          if (words.length) source = "stt";
        } catch (e) {
          if (opts.signal?.aborted) throw e;
          ctx.log(msg("log.youtube.sttSkipped", { error: errorText(e) }));
        }
      }
      const key = words.length ? `${base}/words-${source === "stt" ? "stt" : yt.captions!.lang}.json` : undefined;
      if (key) await putJson(ctx.store, key, words);
      yt.transcript = { ...(key ? { key } : {}), source, words: words.length };
      await ctx.save(state);
      ctx.log(msg("log.youtube.transcript", { source, words: words.length }));
    }

    // 4. Sahneler ve kareler (kaldığı yerden sürer).
    if (!yt.scenes) {
      yt.scenes = scenesFrom(await detectScenes(file), yt.video.durationMs);
      yt.frames = [];
      await ctx.save(state);
    }
    const want = yt.scenes.flatMap((s, i) => sceneFrameTimes(s).map((atMs) => ({ atMs, scene: i + 1 })));
    const have = new Set(yt.frames!.map((f) => f.atMs));
    const todo = want.filter((f) => !have.has(f.atMs));
    for (const [n, f] of todo.entries()) {
      opts.signal?.throwIfAborted();
      const key = `assets/youtube/${state.id}/frames/${f.atMs}.jpg`;
      await ctx.store.put(key, await thumbAt(file, f.atMs), "image/jpeg");
      yt.frames!.push({ ...f, key });
      if ((n + 1) % SAVE_EVERY === 0) await ctx.save(state);
    }
    if (todo.length) {
      yt.frames!.sort((a, b) => a.atMs - b.atMs);
      await ctx.save(state);
      ctx.log(msg("log.youtube.scenes", { scenes: yt.scenes.length, frames: yt.frames!.length }));
    }

    // 5. Uzun sessizlikler.
    if (!yt.silences) {
      yt.silences = yt.video.audio ? await longSilences(file, yt.video.durationMs) : [];
      await ctx.save(state);
    }
  };

  stages.script = async (state, opts) => {
    const input = state.input.youtube!;
    const yt = state.youtube!;
    const meta = yt.meta!;
    if (!yt.scenes || !yt.frames || !yt.silences) throw new LocalizedError(msg("err.missing", { what: "youtube scenes" }));
    const words = await wordsOf(state);
    const windows = planWindows(yt.scenes, yt.frames);
    const shortSec = { min: input.minSec, max: input.maxSec };
    const outs: (YoutubeWindowOut | undefined)[] = windows.map((w) => yt.windows?.find((x) => x.sig === sigOf(w))?.out);

    const analyse = async (i: number) => {
      const w = windows[i]!;
      const sheets = await Promise.all(
        sheetsOf(w.frames).map(async (cells) => {
          const frames = await Promise.all(
            cells.map(async (c) => {
              const data = await ctx.store.get(c.key);
              if (!data) throw new LocalizedError(msg("err.store.missing", { key: c.key }));
              return data;
            }),
          );
          return { image: { data: await contactSheet(frames), mimeType: "image/jpeg" }, cells: cells.map((c) => ({ atSec: c.atMs / 1000, scene: c.scene })) };
        }),
      );
      const out = await ctx.agent(
        state,
        "script",
        youtubeAnalyst(
          {
            lang: state.input.lang,
            title: meta.title,
            fromSec: w.fromMs / 1000,
            toSec: w.toMs / 1000,
            durationSec: meta.durationMs / 1000,
            sheets,
            words: words.filter((x) => x.endMs > w.fromMs && x.startMs < w.toMs),
            heatmap: heatmapIn(meta.heatmap, w.fromMs, w.toMs),
            chapters: meta.chapters.filter((c) => c.toMs > w.fromMs && c.fromMs < w.toMs).map((c) => ({ fromSec: c.fromMs / 1000, title: c.title })),
            silences: yt.silences!.filter((s) => s.toMs > w.fromMs && s.fromMs < w.toMs).map((s) => ({ fromSec: s.fromMs / 1000, toSec: s.toMs / 1000 })),
            shortSec,
          },
          ctx.agentDeps(),
        ),
      );
      outs[i] = out;
      const sig = sigOf(w);
      yt.windows = [...(yt.windows ?? []).filter((x) => x.sig !== sig), { sig, out }];
      await ctx.save(state);
      ctx.log(msg("log.youtube.window", { n: i + 1, of: windows.length, moments: out.moments.length, cuts: out.cuts.length }));
    };

    // Pencereler ikişer ikişer; biri düşerse diğerleri biter, sonuçları kayıtlı kalır, hata yeniden fırlatılır.
    const todo = outs.flatMap((o, i) => (o ? [] : [i]));
    let failure: unknown;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(YOUTUBE.concurrency, todo.length) }, async () => {
        while (next < todo.length && !failure) {
          const i = todo[next++]!;
          try {
            opts.signal?.throwIfAborted();
            await analyse(i);
          } catch (e) {
            failure ??= e;
          }
        }
      }),
    );
    if (failure) throw failure;

    const merged = mergeWindows(outs as YoutubeWindowOut[], yt.frames, meta.durationMs);
    const picked = await ctx.agent(
      state,
      "script",
      youtubeCurator(
        {
          lang: state.input.lang,
          title: meta.title,
          durationSec: meta.durationMs / 1000,
          count: input.count,
          shortSec,
          moments: merged.moments,
          scenes: merged.scenes.map((s) => ({ fromSec: s.fromSec, toSec: s.toSec, summary: s.summary, energy: s.energy })),
          cuts: merged.cuts,
          heatmapPeaks: heatPeaks(meta.heatmap),
        },
        ctx.agentDeps(),
      ),
    );
    yt.report = { ...merged, candidates: normalizeCandidates(picked, meta, words, input) };
    state.story = { title: meta.title, logline: state.input.topic, premise: "", hook: yt.report.candidates[0]?.hook ?? "", beats: [] };
    ctx.log(msg("log.youtube.report", { scenes: merged.scenes.length, cuts: merged.cuts.length, candidates: yt.report.candidates.length }));
  };

  return stages;
}
