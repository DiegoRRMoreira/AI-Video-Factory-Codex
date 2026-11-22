import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_AUTO, STYLE_CUSTOM, STYLE_PACK_IDS } from "@ys/core";
import type { EpisodeInput, EpisodeState } from "@ys/pipeline/light";
import { FsAssetStore } from "@ys/storage";

/** FFmpeg çalıştırılmaz: sahte execFile istenen çıktı dosyasını yazar. */
const ffmpeg = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<object>()),
  execFile: (cmd: string, args: string[], cb: (e: Error | null, out: { stdout: string; stderr: string }) => void) => {
    ffmpeg.calls.push([cmd, ...args]);
    writeFileSync(args.at(-1)!, `sahte ${cmd}`);
    cb(null, { stdout: "", stderr: "" });
  },
}));
// @ys/pipeline'ın ağır kısmı (Remotion, Agent SDK) yüklenmez; CLI'ın kullandığı saf yardımcılar gerçektir.
vi.mock("@ys/pipeline", async () => ({
  ...(await import("@ys/pipeline/light")),
  ...(await import("../../../packages/pipeline/src/timing.ts")),
}));

const { episodeCommand, positive, renderDemo } = await import("../src/episode.ts");

type Pipeline = Parameters<typeof episodeCommand>[0];

const base = (over: Partial<EpisodeState> = {}): EpisodeState =>
  ({
    id: "e1",
    createdAt: "t",
    input: { topic: "Fatih", lang: "tr", targetSec: 180, tier: "economy", aiClipRatio: 0, budgetUsd: 10, width: 1920, height: 1080, fps: 30 },
    done: {},
    agentCostUsd: 0.12345,
    ...over,
  }) as EpisodeState;

/** Sahte pipeline: durumları bellekte tutar, çağrıları kaydeder. */
function fakePipeline(initial: EpisodeState[] = []) {
  const states = new Map(initial.map((s) => [s.id, structuredClone(s)]));
  const calls = { footage: [] as { input: EpisodeInput; files: { name: string; path: string }[] }[], create: [] as EpisodeInput[], run: [] as [string, unknown][], saved: [] as EpisodeState[], previewed: [] as string[], audited: [] as string[], youtube: [] as EpisodeInput[], shorts: [] as [string, string[], unknown][], motion: [] as { input: EpisodeInput; files: { name: string; path: string }[] }[] };
  const pipeline = {
    create: async (input: EpisodeInput) => {
      calls.create.push(input);
      const s = base({ id: `yeni-${calls.create.length}`, input });
      states.set(s.id, s);
      return s;
    },
    createYoutube: async (input: EpisodeInput) => {
      calls.youtube.push(input);
      return base({ id: "analiz-1", input });
    },
    createYoutubeShorts: async (id: string, picks: string[], opts: unknown) => {
      calls.shorts.push([id, picks, opts]);
      return picks.map((p) => {
        const s = base({ id: `short-${p}` });
        states.set(s.id, s);
        return s;
      });
    },
    createMotion: async (input: EpisodeInput, files: { name: string; path: string }[]) => {
      calls.motion.push({ input, files });
      return base({ id: "film-1", input });
    },
    createFootage: async (input: EpisodeInput, files: { name: string; path: string }[]) => {
      calls.footage.push({ input, files });
      return base({ id: "footage-1", input });
    },
    load: async (id: string) => {
      const s = states.get(id);
      if (!s) throw new Error(`Bölüm bulunamadı: ${id}`);
      return s;
    },
    save: async (s: EpisodeState) => {
      calls.saved.push(structuredClone(s));
      states.set(s.id, s);
    },
    run: async (id: string, opts: unknown) => {
      calls.run.push([id, opts]);
      return states.get(id)!;
    },
    previewConcept: async (id: string) => {
      calls.previewed.push(id);
      return states.get(id)!;
    },
    auditRender: async (id: string) => {
      calls.audited.push(id);
      return states.get(id)!;
    },
  };
  return { pipeline: pipeline as unknown as Pipeline, calls, states };
}

let out: string[] = [];
beforeEach(() => {
  out = [];
  ffmpeg.calls = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

it("audits an existing episode separately and reports incomplete measurements as an error", async () => {
  const state = base({ render: { path: "main.mp4", at: "t", audit: { status: "complete", at: "now", findingsCount: 1, findings: [], checks: [] } } });
  const h = fakePipeline([state]);
  await episodeCommand(h.pipeline, "audit", state.id, {});
  expect(h.calls.audited).toEqual([state.id]);
  expect(h.calls.run).toEqual([]);
  h.states.get(state.id)!.render!.audit!.status = "incomplete";
  await expect(episodeCommand(h.pipeline, "audit", state.id, {})).rejects.toThrow("Video denetimi tamamlanamadı");
  await expect(episodeCommand(h.pipeline, "audit", undefined, {})).rejects.toThrow("bölüm kimliği");
});

it("starts a script-only rewrite only on the explicit subcommand", async () => {
  const rewriteScript = vi.fn(async () => base());
  const pipeline = { rewriteScript } as unknown as Pipeline;
  await episodeCommand(pipeline, "rewrite-script", "e1", {});
  expect(rewriteScript).toHaveBeenCalledWith("e1");
  await expect(episodeCommand(pipeline, "rewrite-script", undefined, {})).rejects.toThrow("bölüm kimliği");
});

it("runs voice-only analysis and fails incomplete measurement without starting generation", async () => {
  const state = base({ voiceAudit: { status: "complete", at: "now", fingerprint: "f", scenes: 1, findingsCount: 1, findings: [] } });
  const auditVoice = vi.fn(async () => state), pipeline = { auditVoice } as unknown as Pipeline;
  await episodeCommand(pipeline, "audit-voice", state.id, {}); expect(auditVoice).toHaveBeenCalledWith(state.id);
  state.voiceAudit!.status = "incomplete";
  await expect(episodeCommand(pipeline, "audit-voice", state.id, {})).rejects.toThrow("Konuşma denetimi tamamlanamadı");
  await expect(episodeCommand(pipeline, "audit-voice", undefined, {})).rejects.toThrow("bölüm kimliği");
});

it("routes --short to the Short audit and checks its status instead of the main video", async () => {
  const state = base({ short: { path: "short.mp4", at: "t", title: "Short", scenes: [], sec: 6, audit: { status: "complete", at: "now", findingsCount: 1, findings: [], checks: [] } } });
  const auditRender = vi.fn(async (_id: string, _target?: string) => state);
  const pipeline = { auditRender } as unknown as Pipeline;
  await episodeCommand(pipeline, "audit", state.id, { short: true });
  expect(auditRender).toHaveBeenCalledWith(state.id, "short");
  state.short!.audit!.status = "incomplete";
  await expect(episodeCommand(pipeline, "audit", state.id, { short: true })).rejects.toThrow("Video denetimi tamamlanamadı");
});

it("compares an existing render without starting generation and fails visibly for incomplete results", async () => {
  const state = base({ render: { path: "main.mp4", at: "t", styleComparison: { status: "complete", at: "now", compared: 1, eligible: 1, excludedArchive: 0, findings: [] } } });
  const compareStyle = vi.fn(async () => state);
  const pipeline = { compareStyle } as unknown as Pipeline;
  await episodeCommand(pipeline, "compare-style", state.id, {});
  expect(compareStyle).toHaveBeenCalledWith(state.id);
  state.render!.styleComparison!.status = "incomplete";
  await expect(episodeCommand(pipeline, "compare-style", state.id, {})).rejects.toThrow("Stil karşılaştırması tamamlanamadı");
  await expect(episodeCommand(pipeline, "compare-style", undefined, {})).rejects.toThrow("bölüm kimliği");
});

describe("positive", () => {
  it("virgüllü ondalığı kabul eder, sıfır/negatif/sayı olmayanı reddeder", () => {
    expect(positive("--budget", "2,5")).toBe(2.5);
    expect(positive("--budget", 3)).toBe(3);
    for (const v of ["0", "-1", "$5", "abc", ""]) expect(() => positive("--budget", v)).toThrow("--budget pozitif bir sayı olmalı (ör. 2.5)");
  });
});

describe("YouTube analizi ve Short'ları", () => {
  it("new --youtube: adres doğrulanır, varsayılanlar ve bayraklar", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, { youtube: "https://youtu.be/dQw4w9WgXcQ" });
    expect(calls.youtube[0]).toEqual({
      topic: "YouTube",
      lang: "tr",
      targetSec: 60,
      tier: "economy",
      budgetUsd: 5,
      aiClipRatio: 0,
      autoApprove: true,
      captions: true,
      qa: true,
      youtube: { videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", count: 6, minSec: 20, maxSec: 60 },
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(out).toEqual(["analiz-1"]);
    await episodeCommand(pipeline, "new", undefined, { youtube: "dQw4w9WgXcQ", topic: " Sohbet ", count: "3", min: "30", max: "90", noTranscribe: true, manual: true, noQa: true, noCaptions: true, lang: "en", tier: "premium", budget: "1" });
    expect(calls.youtube[1]).toMatchObject({ topic: "Sohbet", lang: "en", tier: "premium", budgetUsd: 1, autoApprove: false, qa: false, captions: false, youtube: { count: 3, minSec: 30, maxSec: 90, transcribe: false } });
    await expect(episodeCommand(pipeline, "new", undefined, { youtube: "dQw4w9WgXcQ", count: "0" })).rejects.toThrow("--count pozitif");
    await expect(episodeCommand(pipeline, "new", undefined, { youtube: "vimeo.com/1" })).rejects.toThrow("Geçerli bir YouTube video adresi değil");
  });

  it("shorts: adaylardan bölümler; incelemesizse hemen çalışır; kullanım hatası", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "shorts", "analiz-1", { candidates: " c1, ,c3 ", noMusic: true });
    expect(calls.shorts[0]).toEqual(["analiz-1", ["c1", "c3"], { review: false, music: false }]);
    expect(calls.run.map((r) => r[0])).toEqual(["short-c1", "short-c3"]);
    expect(out.slice(0, 2)).toEqual(["short-c1", "short-c3"]);
    await episodeCommand(pipeline, "shorts", "analiz-1", { candidates: "c2", review: true });
    expect(calls.shorts[1]).toEqual(["analiz-1", ["c2"], { review: true, music: true }]);
    expect(calls.run).toHaveLength(2);
    await expect(episodeCommand(pipeline, "shorts", "analiz-1", {})).rejects.toThrow("Kullanım: episode shorts");
    await expect(episodeCommand(pipeline, "shorts", undefined, { candidates: "c1" })).rejects.toThrow("Kullanım: episode shorts");
  });

  it("show analiz raporunu, adayların yerini ve üretilen Short'ları yazar", async () => {
    const report = {
      scenes: [{}],
      cuts: [],
      moments: [],
      candidates: [
        { id: "c1", title: "Soru", hook: "", why: "", score: 9, mood: "warm", durationMs: 25_000, segments: [{ fromMs: 30_000, toMs: 55_000, focusX: 0.5, fit: "cover" }] },
        { id: "c2", title: "Final", hook: "", why: "", score: 6, mood: "warm", durationMs: 40_000, segments: [{ fromMs: 3_800_000, toMs: 3_840_000, focusX: 0.5, fit: "cover" }] },
      ],
    };
    const state = base({ id: "analiz-1", youtube: { report, shorts: [{ candidate: "c2", episodeId: "short-x" }] } as never });
    const { pipeline } = fakePipeline([state, base({ id: "bos", youtube: { report: { ...report, candidates: [] } } as never })]);
    await episodeCommand(pipeline, "show", "analiz-1", {});
    expect(out).toContain("Analiz:  1 sahne, 0 kesim önerisi, 2 Short adayı");
    expect(out).toContain("  c1 [9/10] Soru (25 sn: 0:30–0:55)");
    expect(out).toContain("  c2 [6/10] Final (40 sn: 1:03:20–1:04:00) → short-x");
    expect(out).toContain("  Short üret: pnpm ys episode shorts analiz-1 --candidates c1");
    out = [];
    await episodeCommand(pipeline, "show", "bos", {});
    expect(out.some((l) => l.startsWith("  Short üret"))).toBe(false);
  });
});

describe("episode new --film", () => {
  it("yatay film: varsayılan 30 sn, anlatım kapalı; renkler kırpılır, görseller dosya olarak gider", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, { film: true, topic: "  Hızlı derleme ", color: [" #2563eb ", "  "], asset: ["logo.png", "ekran.jpg"] });
    expect(calls.motion[0]).toEqual({
      input: {
        topic: "Hızlı derleme",
        lang: "tr",
        targetSec: 30,
        tier: "economy",
        budgetUsd: 5,
        aiClipRatio: 0,
        voiceId: undefined,
        autoApprove: true,
        captions: true,
        qa: true,
        motion: { colors: ["#2563eb"], images: [], narration: false },
        width: 1920,
        height: 1080,
        fps: 30,
      },
      files: [
        { name: "logo.png", path: "logo.png" },
        { name: "ekran.jpg", path: "ekran.jpg" },
      ],
    });
    expect(out).toEqual(["film-1"]);
  });

  it("dikey, anlatımlı, bütün bayraklar; görselsiz ve renksiz; brif zorunlu", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, { film: true, topic: "Brif", vertical: true, narration: true, sec: "45.4", lang: "en", tier: "premium", budget: "2", voice: "v", manual: true, noCaptions: true, noQa: true });
    expect(calls.motion[0]).toEqual({
      input: expect.objectContaining({ targetSec: 45, lang: "en", tier: "premium", budgetUsd: 2, voiceId: "v", autoApprove: false, captions: false, qa: false, width: 1080, height: 1920, motion: { colors: [], images: [], narration: true } }),
      files: [],
    });
    await expect(episodeCommand(pipeline, "new", undefined, { film: true })).rejects.toThrow("--topic gerekli");
    await expect(episodeCommand(pipeline, "new", undefined, { film: true, topic: "   " })).rejects.toThrow("--topic gerekli");
    await expect(episodeCommand(pipeline, "new", undefined, { film: true, topic: "x", sec: "0" })).rejects.toThrow("--sec pozitif");
  });

  it("show film özetini, temsili veri işaretini ve denetim bulgularını yazar; zamanlanmış film önce gelir", async () => {
    const scene = (id: string, over: object = {}) => ({ id, language: "kinetic", beats: 4, pace: "beat", transition: "cut", camera: "still", ground: "ground", hit: "none", narration: "", kinetic: { lines: ["Hızlı"], mode: "slam" }, ...over });
    const film = { title: "F", bpm: 120, route: "hybrid", type: "clear", palette: { ground: "#ffffff", ink: "#000000", accent: "#2563eb", alt: "#dbeafe" }, sections: [{ name: "hook", bars: 1, energy: 7 }, { name: "resolve", bars: 1, energy: 3 }], scenes: [scene("m1")] };
    const timed = { ...film, scenes: [scene("m1", { beats: 8, transition: "whip", camera: "punch" }), scene("m2", { language: "data", illustrative: true, kinetic: undefined, data: { chart: "count", title: "Hız", points: [], count: { to: 9, from: 0, decimals: 0, prefix: "", suffix: "×" } } })] };
    const lint = [
      { kind: "gap", sceneId: "m1", atSec: 1.5, detail: "boş" },
      { kind: "hook", atSec: 0, detail: "kanca yok" },
    ];
    const { pipeline } = fakePipeline([base({ id: "film", motionFilm: film, motionTimed: timed, motionLint: lint } as never), base({ id: "taslak", motionFilm: film } as never)]);
    await episodeCommand(pipeline, "show", "film", {});
    expect(out).toContain("Film:    2 sahne, 120 BPM, 6.0 sn; ritim: hook 1 · resolve 1");
    expect(out).toContain("  m1 8 vuruş whip/punch: kinetic: Hızlı");
    expect(out).toContain("  m2 4 vuruş cut/still [temsili veri]: data: Hız");
    expect(out).toContain("  ⚠ gap m1 @1.5s: boş");
    expect(out).toContain("  ⚠ hook @0s: kanca yok");
    out = [];
    await episodeCommand(pipeline, "show", "taslak", {});
    expect(out).toContain("Film:    1 sahne, 120 BPM, 2.0 sn; ritim: hook 1 · resolve 1");
    expect(out.some((l) => l.includes("⚠"))).toBe(false);
  });
});

describe("episode new --footage", () => {
  it("dikey footage bölümü: varsayılan 30 sn, anlatım ve döküm açık, yazılar kırpılır", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, { footage: ["a.mp4", "b.jpg"], overlay: [" Bir ", "  "] });
    expect(calls.footage[0]).toEqual({
      input: {
        topic: "Short",
        lang: "tr",
        targetSec: 30,
        tier: "economy",
        budgetUsd: 5,
        aiClipRatio: 0,
        voiceId: undefined,
        autoApprove: true,
        captions: true,
        qa: true,
        footage: { sources: [], narration: true, transcribe: true, texts: ["Bir"] },
        width: 1080,
        height: 1920,
        fps: 30,
      },
      files: [
        { name: "a.mp4", path: "a.mp4" },
        { name: "b.jpg", path: "b.jpg" },
      ],
    });
    expect(out).toEqual(["footage-1"]);
  });

  it("bütün footage bayrakları", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, { footage: ["a.mp4"], sec: "45.4", topic: " Tatil ", lang: "en", tier: "premium", budget: "2", voice: "v", manual: true, noCaptions: true, noNarration: true, noTranscribe: true, noQa: true });
    expect(calls.footage[0]!.input).toMatchObject({ qa: false, topic: "Tatil", lang: "en", targetSec: 45, tier: "premium", budgetUsd: 2, voiceId: "v", autoApprove: false, captions: false, footage: { narration: false, transcribe: false, texts: [] } });
    await expect(episodeCommand(pipeline, "new", undefined, { footage: ["a.mp4"], sec: "0" })).rejects.toThrow("--sec pozitif");
  });
});

describe("episode new", () => {
  it("varsayılanlarla oluşturur ve kimliği basar", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, { topic: "Kuşatma", series: "   " });
    expect(calls.create[0]).toEqual({
      topic: "Kuşatma",
      lang: "tr",
      targetSec: 180,
      tier: "economy",
      budgetUsd: 10,
      aiClipRatio: 0,
      motionMode: undefined,
      styleHint: undefined,
      voiceId: undefined,
      autoApprove: true,
      qa: true,
      realism: true,
      sideViews: false,
      reverseViews: true,
      setDressing: true,
      captions: true,
      lineStyle: undefined,
      stylePack: STYLE_AUTO,
      series: undefined,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(out).toEqual(["yeni-1"]);
  });

  it("tüm bayraklar", async () => {
    const { pipeline, calls } = fakePipeline();
    await episodeCommand(pipeline, "new", undefined, {
      topic: "T",
      lang: "en",
      minutes: "1,5",
      budget: "4",
      tier: "premium",
      clips: "0.5",
      motion: "vector",
      style: "noir",
      voice: "v1",
      manual: true,
      noQa: true,
      noRealism: true,
      sideViews: true,
      noCaptions: true,
      presenter: " abcdef ",
      with: "x1, ,x2",
      line: "ink",
      stylePack: STYLE_PACK_IDS[0],
      series: " Seri ",
      vertical: true,
    });
    expect(calls.create[0]).toMatchObject({ lang: "en", targetSec: 90, budgetUsd: 4, tier: "premium", aiClipRatio: 0.5, motionMode: "vector", styleHint: "noir", voiceId: "v1", autoApprove: false, qa: false, realism: false, sideViews: true, captions: false, presenter: "abcdef", bankCast: ["x1", "x2"], lineStyle: "ink", stylePack: STYLE_PACK_IDS[0], series: "Seri", width: 1080, height: 1920 });
    await episodeCommand(pipeline, "new", undefined, { topic: "T", stylePack: STYLE_CUSTOM, motion: "still" });
    expect(calls.create[1]).toMatchObject({ stylePack: STYLE_CUSTOM, motionMode: "still" });
    await episodeCommand(pipeline, "new", undefined, { topic: "T", stylePack: STYLE_AUTO, motion: "animated" });
    await episodeCommand(pipeline, "new", undefined, { topic: "T", motion: "mixed" });
    expect(calls.create.map((c) => c.motionMode)).toEqual(["vector", "still", "animated", "mixed"]);
  });

  it("geçersiz girdiler bölüm oluşturmadan reddedilir", async () => {
    const { pipeline, calls } = fakePipeline();
    const bad: [Record<string, unknown>, string | RegExp][] = [
      [{}, "--topic gerekli"],
      [{ topic: "T", minutes: "0" }, "--minutes pozitif"],
      [{ topic: "T", budget: "abc" }, "--budget pozitif"],
      [{ topic: "T", clips: "1.5" }, "--clips 0 ile 1 arasında olmalı"],
      [{ topic: "T", clips: "-0.1" }, "--clips 0 ile 1 arasında olmalı"],
      [{ topic: "T", clips: "x" }, "--clips 0 ile 1 arasında olmalı"],
      [{ topic: "T", motion: "uçan" }, "--motion animated|mixed|still|vector"],
      [{ topic: "T", stylePack: "yok" }, /^--style-pack auto\|custom\|/],
      [{ topic: "T", line: "kalın" }, /./],
      [{ topic: "T", tier: "bedava" }, /./],
    ];
    for (const [args, error] of bad) await expect(episodeCommand(pipeline, "new", undefined, args)).rejects.toThrow(error);
    expect(calls.create).toHaveLength(0);
  });
});

describe("episode run, show, preview", () => {
  it("run aşama bayraklarını doğrular ve iletir", async () => {
    const { pipeline, calls } = fakePipeline([base()]);
    await episodeCommand(pipeline, "run", "e1", { until: "script", from: "style", only: undefined });
    expect(calls.run[0]).toEqual(["e1", { until: "script", from: "style", only: undefined }]);
    await episodeCommand(pipeline, "run", "e1", { only: "concept" });
    expect(calls.run[1]).toEqual(["e1", { until: undefined, from: undefined, only: "concept" }]);
    await expect(episodeCommand(pipeline, "run", "e1", { until: "bitiş" })).rejects.toThrow(/^Geçersiz aşama: bitiş \(style, story/);
    await expect(episodeCommand(pipeline, "run", undefined, {})).rejects.toThrow("bölüm kimliği gerekli");
  });

  it("show özet basar: başlık, bekleme, kadro adayları, çekimler, video", async () => {
    const full = base({
      story: { title: "Kuşatma" } as EpisodeState["story"],
      done: { style: "t", story: "t" },
      waitingFor: "concept",
      cast: { characters: [{ id: "c1", name: "Fatih" }], locations: [{ id: "l1", name: "Sur" }, { id: "l2", name: "Saray" }] } as unknown as EpisodeState["cast"],
      concept: { candidates: { c1: [{ key: "a", mimeType: "x" }, { key: "b", mimeType: "x" }], l1: [{ key: "c", mimeType: "x" }] }, selected: { c1: { key: "b", mimeType: "x" }, l1: { key: "yabancı", mimeType: "x" } } },
      shots: [{ id: "sh1" }, { id: "sh2" }] as EpisodeState["shots"],
      keyframes: { sh1: { key: "k", mimeType: "x" } },
      render: { path: "out/video.mp4" } as EpisodeState["render"],
    });
    full.input.motionMode = "vector";
    const { pipeline } = fakePipeline([full]);
    await episodeCommand(pipeline, "show", "e1", {});
    expect(out).toEqual([
      "Bölüm:   e1",
      "Konu:    Fatih (tr, 180 sn, economy, vector)",
      "Başlık:  Kuşatma",
      expect.stringMatching(/^Aşamalar: ✓style ✓story ·script/),
      "⏸ Onay bekleniyor: concept  →  pnpm ys episode approve e1 concept",
      "  c1 Fatih: 2 aday, seçili #1",
      "  l1 Sur: 1 aday",
      "  l2 Saray: 0 aday",
      "Çekim:   2 (1 keyframe, 0 klip)",
      "Ajan maliyeti: $0.1235",
      "Video:   out/video.mp4",
    ]);
  });

  it("show en kısa özet: hareket modu yoksa karışık; konsepti olmayan kadro", async () => {
    const { pipeline } = fakePipeline([base({ cast: { characters: [{ id: "c1", name: "A" }], locations: [] } as unknown as EpisodeState["cast"], shots: [] })]);
    await episodeCommand(pipeline, "show", "e1", {});
    expect(out).toEqual(["Bölüm:   e1", "Konu:    Fatih (tr, 180 sn, economy, mixed)", expect.stringMatching(/^Aşamalar: ·style/), "  c1 A: 0 aday", "Çekim:   0 (0 keyframe, 0 klip)", "Ajan maliyeti: $0.1235"]);
    await expect(episodeCommand(pipeline, "show", undefined, {})).rejects.toThrow("bölüm kimliği gerekli");
  });

  it("preview seçilen referanslarla deneme karesi ister", async () => {
    const { pipeline, calls } = fakePipeline([base()]);
    await episodeCommand(pipeline, "preview", "e1", {});
    expect(calls.previewed).toEqual(["e1"]);
    expect(out[0]).toBe("Bölüm:   e1");
    await expect(episodeCommand(pipeline, "preview", undefined, {})).rejects.toThrow("bölüm kimliği gerekli");
  });

  it("render barajda bekliyorsa hangi sahnelerin tuttuğunu yazar (12 Kas: 8 barajı otomatik onayı da durdurur)", async () => {
    const checks = { off_story: { evidence: "Ada at her desk, as narrated", verdict: "pass" as const } };
    const waiting = base({
      waitingFor: "preview",
      shots: [{ id: "a1", sceneId: "s1" }, { id: "a2", sceneId: "s1" }, { id: "b1", sceneId: "s2" }, { id: "c1", sceneId: "s3" }, { id: "d1", sceneId: "s4" }] as EpisodeState["shots"],
      draftReview: { at: "t", rubric: 1, lessons: [], avg: 7, revisedScenes: [], shots: { a1: { score: 6, issues: [], checks }, b1: { score: 10, issues: [], checks }, d1: { score: 5, issues: [], checks } } },
    });
    const { pipeline } = fakePipeline([waiting]);
    await episodeCommand(pipeline, "show", "e1", {});
    expect(out).toContain("⏸ Onay bekleniyor: preview  →  pnpm ys episode approve e1 preview");
    expect(out).toContain("  8 barajını geçemeyen sahneler: s1 (en kötü 6/10, 1 kare denetlenemedi), s3 (denetlenemedi), s4 (en kötü 5/10)");
    // Başka bir kapıda beklerken baraj satırı yazılmaz.
    out.length = 0;
    const { pipeline: other } = fakePipeline([{ ...waiting, waitingFor: "concept" }]);
    await episodeCommand(other, "show", "e1", {});
    expect(out.some((l) => l.includes("barajını"))).toBe(false);
    // Barajı geçen bölümde de yazılmaz.
    out.length = 0;
    const { pipeline: clean } = fakePipeline([{ ...waiting, draftReview: { ...waiting.draftReview!, shots: { a1: { score: 9, issues: [], checks }, a2: { score: 8, issues: [], checks }, b1: { score: 10, issues: [], checks }, c1: { score: 10, issues: [], checks }, d1: { score: 8, issues: [], checks } } } }]);
    await episodeCommand(clean, "show", "e1", {});
    expect(out.some((l) => l.includes("barajını"))).toBe(false);
  });

  it("bilinmeyen alt komut kullanımı gösterir", async () => {
    const { pipeline } = fakePipeline();
    await expect(episodeCommand(pipeline, undefined, undefined, {})).rejects.toThrow("Kullanım: episode new|run|show|preview|approve|select");
  });
});

describe("episode approve ve select", () => {
  it("approve kapıyı onaylar ve kaydeder; kullanım hatası", async () => {
    const { pipeline, calls } = fakePipeline([base({ script: { scenes: [] } as unknown as EpisodeState["script"], waitingFor: "script" })]);
    await episodeCommand(pipeline, "approve", "e1", { gate: "script" });
    expect(calls.saved[0]!.approvals?.script).toBeDefined();
    expect(calls.saved[0]!.waitingFor).toBeUndefined();
    for (const [id, gate] of [[undefined, "script"], ["e1", "render"], ["e1", undefined]] as const) {
      await expect(episodeCommand(pipeline, "approve", id, { gate })).rejects.toThrow("Kullanım: episode approve <id> script|concept");
    }
    await expect(episodeCommand(pipeline, "approve", "e1", { gate: "concept" })).resolves.toBeUndefined();
    await expect(episodeCommand(pipeline, "approve", "e1", { gate: "preview" })).resolves.toBeUndefined();
  });

  it("select adayı seçer; biçim hatası", async () => {
    const cands = [{ key: "a", mimeType: "x" }, { key: "b", mimeType: "x" }];
    const { pipeline, calls } = fakePipeline([base({ concept: { candidates: { c1: cands }, selected: {} } })]);
    await episodeCommand(pipeline, "select", "e1", { pick: "c1=1" });
    expect(calls.saved[0]!.concept!.selected.c1?.key).toBe("b");
    for (const [id, pick] of [[undefined, "c1=1"], ["e1", "c1"], ["e1", "=1"], ["e1", undefined]] as const) {
      await expect(episodeCommand(pipeline, "select", id, { pick })).rejects.toThrow("Kullanım: episode select <id> <varlık>=<sıra>");
    }
  });
});

describe("renderDemo", () => {
  it("FFmpeg test görselleri ve sesiyle sahte bölüm kurar, render'a kadar çalıştırır ve geçici klasörü siler", async () => {
    const store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-demo-store-")));
    const { pipeline, calls } = fakePipeline();
    await renderDemo(pipeline, store);

    expect(ffmpeg.calls).toHaveLength(5);
    expect(ffmpeg.calls.every((c) => c[0] === "ffmpeg")).toBe(true);
    const tmp = dirname(ffmpeg.calls[0]!.at(-1)!);
    expect(existsSync(tmp)).toBe(false);
    for (const key of ["demo/kf0.png", "demo/kf1.png", "demo/kf2.png", "demo/voice-s1.mp3", "demo/voice-s2.mp3"]) {
      expect(new TextDecoder().decode((await store.get(key))!)).toBe("sahte ffmpeg");
    }

    expect(calls.create[0]).toMatchObject({ topic: "render demo", tier: "ultra", budgetUsd: 0 });
    const saved = calls.saved[0]!;
    expect(saved.approvals).toEqual({ script: "demo", concept: "demo" });
    expect(Object.keys(saved.done)).toEqual(["style", "story", "script", "cast", "concept", "voice", "shots", "keyframes", "clips"]);
    expect(saved.shots!.map((s) => [s.id, s.startMs, s.endMs])).toEqual([
      ["shot0", 0, 2200],
      ["shot1", 2200, 4400],
      ["shot2", 4400, 9800],
    ]);
    expect(saved.voice!.s2).toMatchObject({ durationMs: 5000, estimatedTiming: true });
    expect(saved.voice!.s1!.words!.length).toBeGreaterThan(5);
    expect(calls.run).toEqual([["yeni-1", { until: "render" }]]);
    expect(out[0]).toBe("Bölüm:   yeni-1");
  });

  it("hata olsa da geçici klasör silinir", async () => {
    const store = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-demo-store-")));
    const { pipeline } = fakePipeline();
    (pipeline as unknown as { create: () => Promise<never> }).create = async () => {
      throw new Error("oluşturulamadı");
    };
    await expect(renderDemo(pipeline, store)).rejects.toThrow("oluşturulamadı");
    expect(existsSync(dirname(ffmpeg.calls[0]!.at(-1)!))).toBe(false);
  });
});
