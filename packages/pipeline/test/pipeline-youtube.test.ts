import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeShortsOut, YoutubeWindowInput, YoutubeWindowOut } from "@ys/agents";
import { isApproved, youtubeInput, type EpisodeInput, type YtInfo } from "../src/index.ts";
import { callsOf, media, onAgent, resetFakes } from "./pipeline-fakes.ts";
import { harness } from "./pipeline-harness.ts";

vi.mock("@ys/agents", async (orig) => (await import("./pipeline-fakes.ts")).mockAgents(await orig()));
vi.mock("@ys/video/render", async () => (await import("./pipeline-fakes.ts")).renderModule());
vi.mock("../src/media.ts", async (orig) => {
  const f = await import("./pipeline-fakes.ts");
  return { ...(await orig<object>()), probeDurationMs: (...a: any[]) => f.media.probe(...a), normalizeClip: (...a: any[]) => f.media.normalize(...a), detectSilences: (...a: any[]) => f.media.silences(...a) };
});

/** yt-dlp ve ffmpeg sahte: bilgi, indirme, altyazı, sahne kesimleri, kareler ve sessizlikler. */
const yt = vi.hoisted(() => ({
  info: {} as Record<string, unknown>,
  captions: undefined as string | undefined,
  scenes: [] as number[],
  downloads: 0,
  thumbs: 0,
  sheets: 0,
  silences: [] as { fromMs: number; toMs: number }[],
  silenceCalls: 0,
}));
vi.mock("../src/youtube-media.ts", async (orig) => ({
  ...(await orig<object>()),
  youtubeInfo: async () => yt.info,
  downloadVideo: async (_url: string, dir: string) => {
    yt.downloads++;
    const { mkdir: md, writeFile: wf } = await import("node:fs/promises");
    await md(dir, { recursive: true });
    const file = `${dir}/video.mp4`;
    await wf(file, "VIDEO");
    return file;
  },
  downloadCaptions: async () => yt.captions,
  detectScenes: async () => yt.scenes,
  thumbAt: async () => {
    yt.thumbs++;
    return new Uint8Array([7]);
  },
  contactSheet: async (frames: Uint8Array[]) => {
    yt.sheets++;
    return new Uint8Array([frames.length]);
  },
  longSilences: async () => {
    yt.silenceCalls++;
    return yt.silences;
  },
}));
const ff = vi.hoisted(() => ({ audio: [] as Record<string, unknown>[], cuts: [] as string[], audioTrack: true }));
vi.mock("../src/footage-media.ts", async (orig) => ({
  ...(await orig<object>()),
  probeMedia: async () => ({ kind: "video", durationMs: 900_000, width: 1920, height: 1080, audio: ff.audioTrack }),
  sampleFrame: async () => new Uint8Array([1]),
  extractAudio: async (_f: string, o: Record<string, unknown> = {}) => {
    ff.audio.push(o);
    return new Uint8Array([2]);
  },
  cutVideo: async (file: string) => {
    ff.cuts.push(file);
    return new Uint8Array([3]);
  },
  frameImage: async () => new Uint8Array([4]),
  posterFrame: async () => new Uint8Array([5]),
}));

const ID = "dQw4w9WgXcQ";
const json3 = JSON.stringify({
  events: [
    { tStartMs: 30_000, dDurationMs: 2000, segs: [{ utf8: "Bu" }, { utf8: " bir", tOffsetMs: 500 }, { utf8: " soru", tOffsetMs: 1000 }] },
    { tStartMs: 400_000, dDurationMs: 1000, segs: [{ utf8: "uzak" }] },
  ],
});
const INFO: YtInfo = { id: ID, title: "Uzun Sohbet", channel: "Kanal", duration: 900, width: 1920, height: 1080, language: "tr", subtitles: { tr: [] }, heatmap: [{ start_time: 0, end_time: 450, value: 0.2 }, { start_time: 450, end_time: 900, value: 0.9 }], chapters: [{ start_time: 0, end_time: 900, title: "Tek" }] };

const input = (over: Partial<EpisodeInput> = {}): EpisodeInput & { youtube: ReturnType<typeof youtubeInput> } => ({
  topic: "Uzun Sohbet",
  lang: "tr",
  targetSec: 60,
  tier: "economy",
  aiClipRatio: 0,
  budgetUsd: 3,
  width: 1080,
  height: 1920,
  fps: 30,
  youtube: youtubeInput({ url: `https://youtu.be/${ID}`, count: 3, minSec: 20, maxSec: 60 }),
  ...over,
});

const windowOut = (w: YoutubeWindowInput): YoutubeWindowOut => ({
  scenes: [{ fromSec: w.fromSec, toSec: w.toSec, summary: `sahne ${w.fromSec}`, people: "", onScreenText: "", energy: 3, quality: "good" }],
  cuts: [{ fromSec: w.fromSec, toSec: w.fromSec + 5, reason: "intro_outro", note: "giriş" }],
  moments: [{ fromSec: w.fromSec + 20, toSec: w.fromSec + 50, title: `an ${w.fromSec}`, hook: "Kanca", why: "tek başına", score: 7, focusX: 0.4, fit: "cover" }],
});
const PICK: YoutubeShortsOut = {
  candidates: [
    { title: "Soru", hook: "Bunu bilmiyordun", why: "soru-cevap", score: 9, mood: "warm", segments: [{ fromSec: 30.2, toSec: 55, focusX: 0.4, fit: "cover" }] },
    { title: "Final", hook: "", why: "kapanış", score: 6, mood: "dramatic", segments: [{ fromSec: 800, toSec: 840, focusX: 0.6, fit: "contain" }] },
  ],
};

beforeEach(() => {
  resetFakes();
  media.probe.mockImplementation(async () => 2000);
  media.silences.mockImplementation(async () => []);
  Object.assign(yt, { info: { ...INFO }, captions: json3, scenes: [120_000, 300_000, 700_000], downloads: 0, thumbs: 0, sheets: 0, silences: [{ fromMs: 100_000, toMs: 103_000 }], silenceCalls: 0 });
  ff.audio = [];
  ff.cuts = [];
  ff.audioTrack = true;
  onAgent("youtubeAnalyst", (w: YoutubeWindowInput) => windowOut(w));
  onAgent("youtubeCurator", () => PICK);
});

describe("YouTube analizi", () => {
  it("indirir, altyazıyı döker, sahneleri ölçer, pencereleri analiz eder ve adayları sıralar; sonraki aşamalar boş", async () => {
    const h = harness();
    const { id } = await h.pipeline.createYoutube(input());
    const state = await h.pipeline.run(id);
    const y = state.youtube!;
    expect(y.meta).toMatchObject({ title: "Uzun Sohbet", channel: "Kanal", durationMs: 900_000, language: "tr" });
    expect(y.captions).toEqual({ lang: "tr", auto: false });
    expect(y.video).toEqual({ key: `library/youtube/${ID}/video.mp4`, durationMs: 900_000, width: 1920, height: 1080, audio: true });
    expect(h.store.map.has(`library/youtube/${ID}/video.mp4`)).toBe(true);
    expect(existsSync(join(h.workDir, "_library", "library", "youtube", ID, "video.mp4"))).toBe(true);
    expect(y.transcript).toEqual({ key: `library/youtube/${ID}/words-tr.json`, source: "manual", words: 4 });
    expect(y.scenes!.map((s) => [s.fromMs, s.toMs])).toEqual([
      [0, 120_000],
      [120_000, 300_000],
      [300_000, 700_000],
      [700_000, 900_000],
    ]);
    // Sahne başına kare (uzun sahnede her 20 sn), hepsi depoda.
    expect(y.frames!.length).toBe(6 + 9 + 20 + 10);
    expect(y.frames!.every((f) => h.store.map.has(f.key) && f.key.startsWith(`assets/youtube/${id}/frames/`))).toBe(true);
    expect(y.silences).toEqual([{ fromMs: 100_000, toMs: 103_000 }]);

    // Pencereler: 0-300 sn (iki sahne), 300-700, 700-900.
    const calls = callsOf("youtubeAnalyst").map((c) => c.args[0] as YoutubeWindowInput);
    expect(calls.map((c) => [c.fromSec, c.toSec, c.sheets.length])).toEqual([
      [0, 300, 2],
      [300, 700, 2],
      [700, 900, 1],
    ]);
    expect(calls[0]!.words.map((w) => w.text)).toEqual(["Bu", "bir", "soru"]);
    expect(calls[0]!.sheets[0]!.cells[0]).toEqual({ atSec: 10, scene: 1 });
    expect(calls[0]!.silences).toEqual([{ fromSec: 100, toSec: 103 }]);
    expect(calls[0]!.chapters).toEqual([{ fromSec: 0, title: "Tek" }]);
    expect(calls[0]!.heatmap.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ lang: "tr", title: "Uzun Sohbet", durationSec: 900, shortSec: { min: 20, max: 60 } });

    const cur = callsOf("youtubeCurator")[0]!.args[0] as { moments: unknown[]; scenes: unknown[]; cuts: unknown[]; heatmapPeaks: unknown[]; count: number };
    expect([cur.moments.length, cur.scenes.length, cur.cuts.length, cur.count]).toEqual([3, 3, 3, 3]);
    expect(cur.heatmapPeaks).toEqual([{ atSec: 225, value: 0.2 }, { atSec: 675, value: 0.9 }]);

    const report = y.report!;
    expect(report.candidates.map((c) => [c.id, c.title, c.segments[0]!.fromMs, c.segments[0]!.toMs])).toEqual([
      ["c1", "Soru", 30_000, 55_000],
      ["c2", "Final", 800_000, 840_000],
    ]);
    expect(report.scenes[0]!.frameKey).toBe(y.frames![0]!.key);
    expect(state.story!.hook).toBe("Bunu bilmiyordun");
    // Analiz bölümü seslendirmez, render etmez; bütün kapılar geçer.
    expect(h.gateway.requests.filter((r) => r.req.capability.startsWith("tts"))).toHaveLength(0);
    expect(state.render).toBeUndefined();
    expect(isApproved(state, "preview")).toBe(true);
    expect(h.logs.some((l) => l.includes("rapor: 3 sahne, 3 kesim önerisi, 2 Short adayı"))).toBe(true);
  });

  it("yarıda kalan analiz kaldığı yerden sürer: biten pencereler yeniden sorulmaz, video yeniden inmez", async () => {
    const h = harness();
    const { id } = await h.pipeline.createYoutube(input());
    let fail = true;
    onAgent("youtubeAnalyst", (w: YoutubeWindowInput) => {
      if (w.fromSec === 700 && fail) throw new Error("kota bitti");
      return windowOut(w);
    });
    await expect(h.pipeline.run(id)).rejects.toThrow("kota bitti");
    const half = await h.load(id);
    expect(half.youtube!.windows!.length).toBe(2);
    expect(half.youtube!.report).toBeUndefined();
    fail = false;
    const before = callsOf("youtubeAnalyst").length;
    const thumbs = yt.thumbs;
    const done = await h.pipeline.run(id);
    expect(callsOf("youtubeAnalyst").length - before).toBe(1);
    expect(yt.downloads).toBe(1);
    expect(yt.thumbs).toBe(thumbs);
    expect(done.youtube!.report!.candidates).toHaveLength(2);
  });

  it("kütüphanede olan video indirilmez; yerel kopyası yoksa depodan yazılır", async () => {
    const h = harness();
    h.store.map.set(`library/youtube/${ID}/video.mp4`, new TextEncoder().encode("CACHED"));
    const { id } = await h.pipeline.createYoutube(input());
    await h.pipeline.run(id, { only: "story" });
    expect(yt.downloads).toBe(0);
    expect(existsSync(join(h.workDir, "_library", "library", "youtube", ID, "video.mp4"))).toBe(true);
  });

  it("altyazı yoksa konuşma tanıma; o da düşerse döküm yok; kapalıysa hiç denenmez; sessiz videoda sessizlik ölçülmez", async () => {
    const stt = harness();
    const original = stt.gateway.generate.getMockImplementation()!;
    stt.gateway.generate.mockImplementation(async (req, run) => {
      if (req.capability !== "stt") return original(req, run);
      stt.gateway.requests.push({ req, run });
      return { files: [], words: [{ text: "merhaba", startMs: 1000, endMs: 1500 }], providerId: "stt:fake", cacheHit: false };
    });
    yt.info = { ...INFO, subtitles: {}, language: undefined };
    const a = await stt.pipeline.createYoutube(input());
    const one = await stt.pipeline.run(a.id, { only: "story" });
    expect(one.youtube!.captions).toBeNull();
    expect(one.youtube!.transcript).toEqual({ key: `library/youtube/${ID}/words-stt.json`, source: "stt", words: 1 });
    expect(stt.gateway.requests.find((r) => r.req.capability === "stt")!.req).toMatchObject({ language: "tr", durationSec: 900 });

    // Altyazı var ama boş: tanıma da kelime döndürmezse döküm yok.
    const empty = harness();
    const original2 = empty.gateway.generate.getMockImplementation()!;
    empty.gateway.generate.mockImplementation(async (req, run) => (req.capability === "stt" ? { files: [], providerId: "stt:fake", cacheHit: false } : original2(req, run)));
    yt.info = { ...INFO };
    yt.captions = '{"events":[]}';
    const b = await empty.pipeline.createYoutube(input());
    expect((await empty.pipeline.run(b.id, { only: "story" })).youtube!.transcript).toEqual({ source: "none", words: 0 });

    const failing = harness();
    failing.gateway.generate.mockImplementation(async () => {
      throw new Error("kota");
    });
    yt.captions = undefined;
    const c = await failing.pipeline.createYoutube(input());
    expect((await failing.pipeline.run(c.id, { only: "story" })).youtube!.transcript).toEqual({ source: "none", words: 0 });
    expect(failing.logs.some((l) => l.includes("konuşma tanıma atlandı: kota"))).toBe(true);

    const off = harness();
    const d = await off.pipeline.createYoutube(input({ youtube: { ...input().youtube, transcribe: false } }));
    await off.pipeline.run(d.id, { only: "story" });
    expect(off.gateway.requests.filter((r) => r.req.capability === "stt")).toHaveLength(0);

    ff.audioTrack = false;
    const silent = harness();
    const e = await silent.pipeline.createYoutube(input());
    const calls = yt.silenceCalls;
    const mute = await silent.pipeline.run(e.id, { only: "story" });
    expect(mute.youtube!.silences).toEqual([]);
    expect(yt.silenceCalls).toBe(calls);
    expect(silent.gateway.requests.filter((r) => r.req.capability === "stt")).toHaveLength(0);
  });

  it("çok uzun video indirilmeden reddedilir; çalışma iptal edilirse kare yakalama durur", async () => {
    const h = harness();
    yt.info = { ...INFO, duration: 2 * 3600 };
    const { id } = await h.pipeline.createYoutube(input());
    await expect(h.pipeline.run(id)).rejects.toThrow("Video 120 dk; en çok 90 dk analiz edilir");
    expect(yt.downloads).toBe(0);

    yt.info = { ...INFO };
    const g = harness();
    const s = await g.pipeline.createYoutube(input());
    const abort = new AbortController();
    abort.abort();
    await expect(g.pipeline.run(s.id, { only: "story", signal: abort.signal })).rejects.toThrow();
  });

  it("story yeniden çalışınca her şey kayıttan gelir; yerel kopya ve depo kaydı yoksa hata", async () => {
    const h = harness();
    const { id } = await h.pipeline.createYoutube(input());
    await h.pipeline.run(id, { only: "story" });
    const counts = [yt.downloads, yt.thumbs, yt.silenceCalls];
    await h.pipeline.run(id, { only: "story" });
    expect([yt.downloads, yt.thumbs, yt.silenceCalls]).toEqual(counts);
    const { rm } = await import("node:fs/promises");
    await rm(join(h.workDir, "_library"), { recursive: true, force: true });
    h.store.map.delete(`library/youtube/${ID}/video.mp4`);
    await expect(h.pipeline.run(id, { only: "story" })).rejects.toThrow(`library/youtube/${ID}/video.mp4`);
  });

  it("otomatik altyazı; konuşma tanıma sırasında iptal hatası yutulmaz; aday çıkmazsa kanca boş; kayıtlı döküm silinmişse kelimesiz", async () => {
    const h = harness();
    yt.info = { ...INFO, subtitles: {}, automatic_captions: { tr: [] } };
    const { id } = await h.pipeline.createYoutube(input());
    onAgent("youtubeCurator", () => ({ candidates: [] }));
    const done = await h.pipeline.run(id);
    expect(done.youtube!.transcript!.source).toBe("auto");
    expect(h.logs.some((l) => l.includes("altyazı: tr (auto)"))).toBe(true);
    expect(done.youtube!.report!.candidates).toEqual([]);
    expect(done.story!.hook).toBe("");
    h.store.map.delete(done.youtube!.transcript!.key!);
    const before = callsOf("youtubeAnalyst").length;
    const again = await h.load(id);
    delete again.youtube!.windows;
    await h.pipeline.save(again);
    await h.pipeline.run(id, { only: "script" });
    expect((callsOf("youtubeAnalyst")[before]!.args[0] as YoutubeWindowInput).words).toEqual([]);

    const stop = harness();
    yt.info = { ...INFO, subtitles: {} };
    const abort = new AbortController();
    stop.gateway.generate.mockImplementation(async () => {
      abort.abort();
      throw new Error("iptal");
    });
    const s = await stop.pipeline.createYoutube(input());
    await expect(stop.pipeline.run(s.id, { only: "story", signal: abort.signal })).rejects.toThrow("iptal");
  });

  it("kayıtlı sahneler olmadan analiz edilemez; eksik kare depoda yoksa hata", async () => {
    const h = harness();
    const { id } = await h.pipeline.createYoutube(input());
    await h.pipeline.run(id, { only: "story" });
    const state = await h.load(id);
    delete state.youtube!.silences;
    await h.pipeline.save(state);
    await expect(h.pipeline.run(id, { only: "script" })).rejects.toThrow("youtube scenes");
    const again = await h.load(id);
    again.youtube!.silences = [];
    await h.pipeline.save(again);
    h.store.map.delete(again.youtube!.frames![0]!.key);
    await expect(h.pipeline.run(id, { only: "script" })).rejects.toThrow(again.youtube!.frames![0]!.key);
  });

  it("dökümü olmayan analiz kelimesiz ilerler", async () => {
    const h = harness();
    yt.captions = undefined;
    const { id } = await h.pipeline.createYoutube(input({ youtube: { ...input().youtube, transcribe: false } }));
    const done = await h.pipeline.run(id);
    expect((callsOf("youtubeAnalyst")[0]!.args[0] as YoutubeWindowInput).words).toEqual([]);
    expect(done.youtube!.report!.candidates[0]!.segments[0]!.fromMs).toBe(30_200);
  });
});

describe("adaydan Short", () => {
  async function analysed() {
    const h = harness();
    const { id } = await h.pipeline.createYoutube(input({ qa: false }));
    await h.pipeline.run(id);
    return { h, id };
  }

  it("seçilen adaylar footage bölümü olur: kütüphanedeki video, adayın dökümü ve kareleri, kurgu; onaylı ya da incelemeli", async () => {
    const { h, id } = await analysed();
    const analysis = await h.load(id);
    // Bir kare depoda yoksa atlanır.
    const firstInRange = analysis.youtube!.frames!.find((f) => f.atMs >= 30_000 && f.atMs < 55_000)!;
    h.store.map.delete(firstInRange.key);
    const [a] = await h.pipeline.createYoutubeShorts(id, ["c1"]);
    const [b] = await h.pipeline.createYoutubeShorts(id, ["c2"], { review: true, music: false });
    expect(a!.input).toMatchObject({ topic: "Soru", targetSec: 25, width: 1080, height: 1920, fromYoutube: { analysis: id, candidate: "c1", url: `https://www.youtube.com/watch?v=${ID}` } });
    expect(a!.input.youtube).toBeUndefined();
    expect(a!.input.music).toBeUndefined();
    expect(b!.input.music).toBe(false);
    expect(a!.input.footage!.sources).toEqual([{ id: "f1", key: `library/youtube/${ID}/video.mp4`, name: "Uzun Sohbet.mp4", ext: "mp4", kind: "video", durationMs: 900_000, width: 1920, height: 1080, audio: true }]);
    expect(a!.footageScan!.f1!.words!.map((w) => w.text)).toEqual(["Bu", "bir", "soru"]);
    expect(a!.footageScan!.f1!.frames.every((f) => f.key.startsWith(`assets/footage/${a!.id}/frames/`) && h.store.map.has(f.key))).toBe(true);
    expect(a!.footagePlan!.beats[0]!.segments[0]).toMatchObject({ fromMs: 30_000, toMs: 55_000, audio: "original" });
    expect(a!.footagePlan!.overlays).toEqual([{ text: "Bunu bilmiyordun", style: "hook", beat: "b1", position: "top" }]);
    expect(a!.approvals?.script).toBeDefined();
    expect(b!.approvals).toBeUndefined();
    expect((await h.load(id)).youtube!.shorts).toEqual([
      { candidate: "c1", episodeId: a!.id },
      { candidate: "c2", episodeId: b!.id },
    ]);

    // Onaylı Short önizleme kapısına kadar gider; kaynak paylaşılan yerel kopyadan kesilir.
    const run = await h.pipeline.run(a!.id);
    expect(run.footageCuts!.map((c) => [c.fromMs, c.toMs, c.audio])).toEqual([[30_000, 55_000, "original"]]);
    expect(ff.cuts.every((f) => f.includes(join("_library", "library", "youtube", ID)))).toBe(true);
    expect(run.timeline!.captions.length).toBeGreaterThan(0);
    expect(run.render).toBeUndefined();
  });

  it("analizi bitmemiş bölüm ve bilinmeyen aday reddedilir", async () => {
    const h = harness();
    const { id } = await h.pipeline.createYoutube(input());
    await expect(h.pipeline.createYoutubeShorts(id, ["c1"])).rejects.toThrow("biten bir YouTube analizi yok");
    const done = await analysed();
    await expect(done.h.pipeline.createYoutubeShorts(done.id, ["c9"])).rejects.toThrow("böyle bir aday yok: c9");
  });

  it("döküm dosyası silinmiş, başlıksız aday, karesiz analiz: Short yine açılır", async () => {
    const { h, id } = await analysed();
    const state = await h.load(id);
    h.store.map.delete(state.youtube!.transcript!.key!);
    state.youtube!.report!.candidates[0]!.title = "";
    delete state.youtube!.frames;
    await h.pipeline.save(state);
    const [s] = await h.pipeline.createYoutubeShorts(id, ["c1"]);
    expect(s!.input.topic).toBe("Uzun Sohbet");
    expect(s!.footageScan!.f1).toEqual({ frames: [], words: [] });
  });

  it("dökümü olmayan analizden Short kelimesiz açılır", async () => {
    const h = harness();
    yt.captions = undefined;
    const { id } = await h.pipeline.createYoutube(input({ youtube: { ...input().youtube, transcribe: false } }));
    await h.pipeline.run(id);
    const [s] = await h.pipeline.createYoutubeShorts(id, ["c1"]);
    expect(s!.footageScan!.f1!.words).toEqual([]);
  });
});

