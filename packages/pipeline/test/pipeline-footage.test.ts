import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FootageEditOut } from "@ys/agents";
import { approve, isApproved, type EpisodeInput } from "../src/index.ts";
import { callsOf, media, onAgent, render, resetFakes } from "./pipeline-fakes.ts";
import { harness, makeState } from "./pipeline-harness.ts";

vi.mock("@ys/agents", async (orig) => (await import("./pipeline-fakes.ts")).mockAgents(await orig()));
vi.mock("@ys/video/render", async () => (await import("./pipeline-fakes.ts")).renderModule());
vi.mock("../src/media.ts", async (orig) => {
  const f = await import("./pipeline-fakes.ts");
  return {
    ...(await orig<object>()),
    probeDurationMs: (...a: any[]) => f.media.probe(...a),
    normalizeClip: (...a: any[]) => f.media.normalize(...a),
    detectSilences: (...a: any[]) => f.media.silences(...a),
  };
});

/** ffmpeg adımları sahte: ölçüler dosya adından, çıktılar küçük baytlar. */
const ff = vi.hoisted(() => ({ cuts: [] as { file: string; o: Record<string, unknown> }[], audio: [] as Record<string, unknown>[], stills: 0 }));
vi.mock("../src/footage-media.ts", async (orig) => ({
  ...(await orig<object>()),
  probeMedia: async (file: string, kind: "video" | "image") =>
    kind === "image" ? { kind, durationMs: 0, width: 1200, height: 800, audio: false } : { kind, durationMs: file.includes("silent") ? 8000 : 20000, width: 1920, height: 1080, audio: !file.includes("silent") },
  sampleFrame: async () => new Uint8Array([1]),
  extractAudio: async (_file: string, o: Record<string, unknown> = {}) => {
    ff.audio.push(o);
    return new Uint8Array([2]);
  },
  cutVideo: async (file: string, o: Record<string, unknown>) => {
    ff.cuts.push({ file, o });
    return new Uint8Array([3]);
  },
  frameImage: async () => {
    ff.stills++;
    return new Uint8Array([4]);
  },
}));

const dir = mkdtempSync(join(tmpdir(), "ys-footage-test-"));
const file = (name: string, bytes: number[]) => {
  const path = join(dir, name);
  writeFileSync(path, new Uint8Array(bytes));
  return { name, path };
};
const FILES = [file("talk.mp4", [1, 1]), file("silent.mov", [2, 2]), file("photo.jpg", [3, 3])];

const input = (over: Partial<EpisodeInput> = {}): EpisodeInput => ({
  topic: "Gezi",
  lang: "tr",
  targetSec: 20,
  tier: "economy",
  aiClipRatio: 0,
  budgetUsd: 3,
  autoApprove: true,
  footage: { sources: [], narration: true, transcribe: true, texts: ["Kendi yazım"] },
  width: 1080,
  height: 1920,
  fps: 30,
  ...over,
});

const EDIT: FootageEditOut = {
  title: "Gezi Short",
  beats: [
    { narration: "Bu yaz yola çıktık.", mood: "warm", segments: [{ source: "f1", fromSec: 1, toSec: 4, focusX: 0.4, fit: "cover", audio: "ambient", why: "road" }, { source: "f3", fromSec: 0, toSec: 2, focusX: 0.5, fit: "contain", audio: "mute", why: "photo" }] },
    { narration: "", mood: "night", segments: [{ source: "f1", fromSec: 10, toSec: 13, focusX: 0.5, fit: "cover", audio: "original", why: "talk" }] },
    { narration: "Ve döndük.", mood: "day", segments: [{ source: "f2", fromSec: 0, toSec: 3, focusX: 0.6, fit: "cover", audio: "original", why: "silent" }] },
  ],
  overlays: [{ text: "Yola çıktık", style: "hook", beat: 1, position: "top" }],
};

/** STT isteği kelime döndürür; diğerleri sahte geçidin olağan dosyası. */
function withStt(h: ReturnType<typeof harness>, words = [{ text: "Merhaba", startMs: 10500, endMs: 11000 }]) {
  const original = h.gateway.generate.getMockImplementation()!;
  h.gateway.generate.mockImplementation(async (req, run) => {
    if (req.capability !== "stt") return original(req, run);
    h.gateway.requests.push({ req, run });
    return { files: [{ key: "assets/stt/x.json", mimeType: "application/json" }], words, providerId: "stt:fake", cacheHit: false };
  });
}

beforeEach(() => {
  resetFakes();
  media.probe.mockImplementation(async () => 2000);
  media.silences.mockImplementation(async () => []);
  ff.cuts = [];
  ff.audio = [];
  ff.stills = 0;
  onAgent("footageEditor", () => EDIT);
});

describe("footage bölümü oluşturma", () => {
  it("dosyalar bölümün klasörüne içerik adresiyle eklenir; aynı dosya iki kez eklenmez", async () => {
    const h = harness();
    const state = await h.pipeline.createFootage(input(), [...FILES, file("again.mp4", [1, 1])]);
    expect(state.input.footage!.sources.map((s) => [s.id, s.name, s.kind, s.audio, s.durationMs])).toEqual([
      ["f1", "talk.mp4", "video", true, 20000],
      ["f2", "silent.mov", "video", false, 8000],
      ["f3", "photo.jpg", "image", false, 0],
    ]);
    expect(state.input.footage!.sources[0]!.key).toMatch(new RegExp(`^assets/footage/${state.id}/src/[0-9a-f]{24}\\.mp4$`));
    expect((await h.load(state.id)).input.footage!.texts).toEqual(["Kendi yazım"]);
  });

  it("desteklenmeyen tür reddedilir ve yüklenenler silinir; süre ve dosya sayısı denetlenir", async () => {
    const h = harness();
    await expect(h.pipeline.createFootage(input(), [FILES[0]!, file("anim.gif", [9])])).rejects.toThrow("Desteklenmeyen dosya türü: anim.gif");
    expect(await h.store.list("assets/footage/")).toEqual([]);
    expect(await h.store.list("episodes/")).toEqual([]);
    await expect(h.pipeline.createFootage(input({ targetSec: 5 }), FILES)).rejects.toThrow("15–180");
    await expect(h.pipeline.createFootage(input({ targetSec: 200 }), FILES)).rejects.toThrow("15–180");
    await expect(h.pipeline.createFootage(input(), [])).rejects.toThrow("en az bir video");
  });
});

describe("Stüdyo'dan yüklenenler", () => {
  it("ilk aşama bekleyen dosyaları ölçüp bölüme alır, bekleme alanından siler; eksik dosya hatadır", async () => {
    const h = harness();
    h.store.map.set("uploads/footage/aaaaaaaaaaaaaaaaaaaaaaaa.mp4", new Uint8Array([1, 2]));
    h.store.map.set("uploads/footage/bbbbbbbbbbbbbbbbbbbbbbbb.jpg", new Uint8Array([3]));
    const state = makeState(
      { ...input(), footage: { sources: [], narration: true, transcribe: false, texts: [], pending: [{ key: "uploads/footage/aaaaaaaaaaaaaaaaaaaaaaaa.mp4", name: "yol.mp4" }, { key: "uploads/footage/bbbbbbbbbbbbbbbbbbbbbbbb.jpg", name: "foto.jpg" }] } },
    );
    const id = await h.seed(state);
    const done = await h.pipeline.run(id, { only: "story" });
    expect(done.input.footage!.pending).toBeUndefined();
    expect(done.input.footage!.sources.map((s) => [s.id, s.name, s.kind])).toEqual([
      ["f1", "yol.mp4", "video"],
      ["f2", "foto.jpg", "image"],
    ]);
    expect(await h.store.list("uploads/")).toEqual([]);
    expect(Object.keys(done.footageScan!)).toEqual(["f1", "f2"]);

    const missing = harness();
    const id2 = await missing.seed(makeState({ ...input(), footage: { sources: [], narration: true, transcribe: false, texts: [], pending: [{ key: "uploads/footage/cccccccccccccccccccccccc.mp4", name: "x.mp4" }] } }));
    await expect(missing.pipeline.run(id2, { only: "story" })).rejects.toThrow("uploads/footage/cccccccccccccccccccccccc.mp4");
  });
});

describe("footage hattı", () => {
  it("tarama → kurgu → ses → zamanlama → kesim → timeline → render; konsept ve kare aşamaları boş", async () => {
    const h = harness();
    withStt(h);
    const { id } = await h.pipeline.createFootage(input(), FILES);
    for (const k of (await h.load(id)).input.footage!.sources.map((s) => s.key)) expect(h.store.map.has(k)).toBe(true);
    onAgent("packager", () => ({ title: "P", thumbnailText: "T", description: "D", chapters: [], tags: [], hashtags: [], short: { from: "b1", to: "b1", title: "S" } }));
    const state = await h.pipeline.run(id);

    // Tarama: videoya kareler ve (sesliyse) döküm; resim tek kare.
    expect(Object.keys(state.footageScan!)).toEqual(["f1", "f2", "f3"]);
    expect(state.footageScan!.f1!.words).toEqual([{ text: "Merhaba", startMs: 10500, endMs: 11000 }]);
    expect(state.footageScan!.f2!.words).toBeUndefined();
    expect(state.footageScan!.f3!.frames).toHaveLength(1);
    const stt = h.gateway.requests.filter((r) => r.req.capability === "stt");
    expect(stt).toHaveLength(1);
    expect(stt[0]!.req).toMatchObject({ language: "tr", durationSec: 20, refs: [{ role: "source_audio", mimeType: "audio/wav" }] });
    expect(ff.audio[0]).toEqual({ stt: true });

    // Kurgu ajanı kareleri ve dökümü görür; kullanıcının yazısı eklenir; anlatımlı vuruşta konuşma kısılır.
    const call = callsOf("footageEditor")[0]!.args[0] as { sources: { frames: unknown[]; words?: unknown[] }[]; texts: string[]; targetSec: number };
    expect(call.sources.map((s) => s.frames.length)).toEqual([8, 4, 1]);
    expect(call.sources[0]!.words).toHaveLength(1);
    expect(call).toMatchObject({ texts: ["Kendi yazım"], targetSec: 20 });
    expect(state.footagePlan!.overlays.map((o) => o.text)).toEqual(["Yola çıktık", "Kendi yazım"]);
    expect(state.script!.scenes.map((s) => [s.id, s.narration])).toEqual([
      ["b1", "Bu yaz yola çıktık."],
      ["b2", ""],
      ["b3", "Ve döndük."],
    ]);
    expect(state.story!.title).toBe("Gezi Short");

    // Ses yalnız anlatımlı vuruşlara.
    expect(h.gateway.requests.filter((r) => r.req.capability.startsWith("tts")).map((r) => r.req.text)).toEqual(["Bu yaz yola çıktık.", "Ve döndük."]);
    expect(Object.keys(state.voice!)).toEqual(["b1", "b3"]);

    // Çekimler ve kesim: video parçası "footage", resim "still_motion"; sessiz parça sessiz.
    expect(state.shots!.map((s) => [s.id, s.kind])).toEqual([
      ["b1-sh1", "footage"],
      ["b1-sh2", "still_motion"],
      ["b2-sh1", "footage"],
      ["b3-sh1", "footage"],
    ]);
    expect(ff.cuts).toHaveLength(3);
    expect(ff.cuts[0]!.o).toMatchObject({ focusX: 0.4, fit: "cover", width: 1080, height: 1920, fps: 30 });
    // Geçiş payı kadar uzun kesilir.
    expect(ff.cuts[0]!.o.toMs).toBe(state.footageCuts![0]!.toMs + 700);
    expect(ff.stills).toBe(1);
    expect(Object.keys(state.footageAssets!.audio)).toEqual(["b1-sh1", "b2-sh1"]);

    // Timeline: kaynak ses, altyazıda anlatım ve korunan konuşma, yazılar, müzik ve efekt.
    const t = state.timeline!;
    expect([t.width, t.height]).toEqual([1080, 1920]);
    expect(t.audio.map((a) => a.role)).toEqual(["voice", "voice", "source", "source", "sfx", "music"]);
    expect(t.captions.map((w) => w.text)).toContain("Merhaba");
    expect(t.overlays!.map((o) => [o.text, o.anim])).toEqual([
      ["Yola çıktık", "kinetic"],
      ["Kendi yazım", "typewriter"],
    ]);
    // Footage parçası yeniden kodlanmaz; resim ve sesler olduğu gibi indirilir.
    expect(media.normalize).not.toHaveBeenCalled();
    expect(render.episode).toHaveBeenCalledTimes(1);
    expect(state.done.review).toBeTruthy();
    // Dikey bölümde ayrı Short yok.
    expect(state.short).toBeUndefined();
  });

  it("onaylı akış: kurgu onayında durur, konsept kapısı yok, önizleme onayında durur", async () => {
    const h = harness();
    withStt(h);
    const { id } = await h.pipeline.createFootage(input({ autoApprove: false }), FILES);
    let state = await h.pipeline.run(id);
    expect(state.waitingFor).toBe("script");
    expect(isApproved(state, "concept")).toBe(true);
    approve(state, "script");
    await h.pipeline.save(state);
    state = await h.pipeline.run(id);
    expect(state.waitingFor).toBe("preview");
    expect(state.done.clips).toBeTruthy();
    expect(isApproved(makeState(), "concept")).toBe(false);
  });

  it("döküm düşerse kurgu karelerle sürer; kapalıysa ya da sessizse istenmez; taranmış kaynak yeniden taranmaz", async () => {
    const h = harness();
    const original = h.gateway.generate.getMockImplementation()!;
    h.gateway.generate.mockImplementation(async (req, run) => {
      if (req.capability === "stt") throw new Error("kota bitti");
      return original(req, run);
    });
    const { id } = await h.pipeline.createFootage(input(), FILES);
    let state = await h.pipeline.run(id, { only: "story" });
    expect(state.footageScan!.f1!.words).toBeUndefined();
    expect(h.logs.some((l) => l.includes("konuşma dökümü atlandı (f1): kota bitti"))).toBe(true);
    const frames = state.footageScan!.f1!.frames;
    state = await h.pipeline.run(id, { only: "story" });
    expect(state.footageScan!.f1!.frames).toEqual(frames);

    const off = harness();
    const created = await off.pipeline.createFootage(input({ footage: { sources: [], narration: false, transcribe: false, texts: [] } }), FILES);
    await off.pipeline.run(created.id, { only: "story" });
    expect(off.gateway.requests.filter((r) => r.req.capability === "stt")).toHaveLength(0);
  });

  it("döküm sırasında iptal edilirse aşama düşer", async () => {
    const h = harness();
    const controller = new AbortController();
    h.gateway.generate.mockImplementation(async () => {
      controller.abort();
      throw new Error("iptal");
    });
    const { id } = await h.pipeline.createFootage(input(), FILES);
    await expect(h.pipeline.run(id, { only: "story", signal: controller.signal })).rejects.toThrow("iptal");
  });

  it("kesim parmak izi aynıysa yeniden kesilmez; sese dönen parça sessizleşince ses anahtarı silinir; müzik ve efekt kapatılabilir", async () => {
    const h = harness();
    withStt(h);
    const { id } = await h.pipeline.createFootage(input({ sfx: false, music: false }), FILES);
    let state = await h.pipeline.run(id, { until: "timeline" });
    expect(ff.cuts).toHaveLength(3);
    expect(state.timeline!.audio.map((a) => a.role)).toEqual(["voice", "voice", "source", "source"]);
    state = await h.pipeline.run(id, { only: "clips" });
    expect(ff.cuts).toHaveLength(3);
    state.footageCuts![0]!.audio = "mute";
    await h.pipeline.save(state);
    state = await h.pipeline.run(id, { only: "clips" });
    expect(ff.cuts).toHaveLength(4);
    expect(state.footageAssets!.audio["b1-sh1"]).toBeUndefined();
  });

  it("eksik girdiler: kurgusuz zamanlama, kesimsiz kesim, varlıksız timeline, depoda olmayan kare ve kaynak", async () => {
    const h = harness();
    withStt(h);
    const { id } = await h.pipeline.createFootage(input(), FILES);
    await expect(h.pipeline.run(id, { only: "shots" })).rejects.toThrow("footagePlan");
    await expect(h.pipeline.run(id, { only: "clips" })).rejects.toThrow("footageCuts");
    await expect(h.pipeline.run(id, { only: "timeline" })).rejects.toThrow("footagePlan/footageCuts/footageAssets");
    let state = await h.pipeline.run(id, { only: "story" });
    h.store.map.delete(state.footageScan!.f1!.frames[0]!.key);
    await expect(h.pipeline.run(id, { only: "script" })).rejects.toThrow(state.footageScan!.f1!.frames[0]!.key);

    const other = harness();
    const created = await other.pipeline.createFootage(input(), FILES);
    other.store.map.delete(created.input.footage!.sources[0]!.key);
    await expect(other.pipeline.run(created.id, { only: "story" })).rejects.toThrow(created.input.footage!.sources[0]!.key);
    state = await h.load(id);
    expect(state.lastError?.stage).toBe("script");
  });

  it("seyrek durum: kelimesiz döküm, taranmamış kaynak, sessiz bölüm; kısa kaynak yavaşlatılır", async () => {
    const h = harness();
    const original = h.gateway.generate.getMockImplementation()!;
    h.gateway.generate.mockImplementation(async (req, run) => (req.capability === "stt" ? { files: [{ key: "assets/stt/y.json", mimeType: "application/json" }], providerId: "stt:fake", cacheHit: false } : original(req, run)));
    const { id } = await h.pipeline.createFootage(input({ targetSec: 15 }), FILES);
    let state = await h.pipeline.run(id, { only: "story" });
    expect(state.footageScan!.f1!.words).toEqual([]);
    delete state.footageScan;
    await h.pipeline.save(state);
    onAgent("footageEditor", () => ({ title: "", beats: [{ narration: "", mood: "day", segments: [{ source: "f2", fromSec: 0, toSec: 8, focusX: 0.5, fit: "cover", audio: "mute", why: "x" }] }], overlays: [] }));
    state = await h.pipeline.run(id, { only: "script" });
    expect((callsOf("footageEditor")[0]!.args[0] as { sources: { frames: unknown[] }[] }).sources[0]!.frames).toEqual([]);
    expect(state.story!.title).toBe("Gezi");
    for (const stage of ["shots", "clips", "timeline"] as const) state = await h.pipeline.run(id, { only: stage });
    expect(state.footageCuts![0]!.speed).toBe(0.6);
    expect(h.logs.some((l) => l.includes("×0.60"))).toBe(true);
    expect(state.timeline!.captions).toEqual([]);
  });

  it("anlatımsız sahne seslendirilmez (vektör olmayan bölümde de)", async () => {
    const h = harness();
    const state = makeState({}, { script: { scenes: [{ id: "s1", beatId: "b", narration: "  ", visualIntent: "", emotion: "", location: "" }] } as never });
    const id = await h.seed(state);
    await h.pipeline.run(id, { only: "voice" });
    expect(h.gateway.requests).toHaveLength(0);
  });
});
