import { afterEach, describe, expect, it } from "vitest";
import type { YoutubeShortsOut, YoutubeWindowOut } from "@ys/agents";
import type { WordTiming } from "@ys/core";
import {
  candidatePlan,
  candidateWords,
  heatmapIn,
  heatPeaks,
  mergeWindows,
  metaOf,
  normalizeCandidates,
  parseJson3,
  parseYoutubeUrl,
  pickCaptions,
  planWindows,
  sceneFrameTimes,
  scenesFrom,
  sheetsOf,
  YOUTUBE,
  youtubeInput,
  youtubeMaxMs,
  type YoutubeCandidate,
  type YoutubeFrame,
  type YoutubeMeta,
} from "../src/youtube.ts";
import type { FootageSource } from "../src/footage.ts";

afterEach(() => {
  delete process.env.YS_YOUTUBE_MAX_MIN;
});

describe("YouTube adresi", () => {
  it("watch, shorts, live, embed, youtu.be, şemasız ve çıplak kimlik kanonik adrese çevrilir", () => {
    const want = { videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
    for (const raw of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1",
      "http://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "youtube.com/shorts/dQw4w9WgXcQ?feature=share",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=x",
      "  dQw4w9WgXcQ  ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    ])
      expect(parseYoutubeUrl(raw), raw).toEqual(want);
  });

  it("başka site, bozuk adres, kimliksiz yol ve oynatma listesi reddedilir", () => {
    for (const raw of ["https://vimeo.com/123", "https://evil.com/watch?v=dQw4w9WgXcQ", "ftp://youtube.com/watch?v=dQw4w9WgXcQ", "http://[::1", "https://www.youtube.com/watch", "https://www.youtube.com/playlist?list=PL1", "https://www.youtube.com/shorts/short", "-o /etc/passwd", "https://youtu.be/", "https://www.youtube.com/"])
      expect(parseYoutubeUrl(raw), raw).toBeUndefined();
  });

  it("youtubeInput sayıları sınırlar; geçersiz adres çevrilebilir hata", () => {
    expect(youtubeInput({ url: "dQw4w9WgXcQ" })).toEqual({ videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", count: 6, minSec: 20, maxSec: 60 });
    expect(youtubeInput({ url: "dQw4w9WgXcQ", count: 99, minSec: 5, maxSec: 999, transcribe: false })).toMatchObject({ count: 12, minSec: 15, maxSec: 180, transcribe: false });
    expect(youtubeInput({ url: "dQw4w9WgXcQ", count: 0, minSec: 90, maxSec: 30 })).toMatchObject({ count: 1, minSec: 90, maxSec: 90 });
    expect(() => youtubeInput({ url: "nope" })).toThrow("Geçerli bir YouTube video adresi değil: nope");
  });

  it("en uzun süre ortamdan okunur", () => {
    expect(youtubeMaxMs()).toBe(90 * 60_000);
    process.env.YS_YOUTUBE_MAX_MIN = "120";
    expect(youtubeMaxMs()).toBe(120 * 60_000);
    process.env.YS_YOUTUBE_MAX_MIN = "abc";
    expect(youtubeMaxMs()).toBe(90 * 60_000);
  });
});

describe("bilgi ve altyazı", () => {
  it("metaOf: alanlar, bölümler ve grafik; eksikler varsayılanla; canlı ve süresiz reddedilir", () => {
    const meta = metaOf(
      { title: "T", uploader: "U", duration: 100.5, width: 1920, height: 1080, language: "tr", description: "d", chapters: [{ start_time: 0, end_time: 200, title: "Giriş" }, {}], heatmap: [{ start_time: 0, end_time: 10, value: 1.4 }, {}] },
      "abcdefghijk",
    );
    expect(meta).toEqual({
      videoId: "abcdefghijk",
      title: "T",
      channel: "U",
      durationMs: 100500,
      width: 1920,
      height: 1080,
      language: "tr",
      description: "d",
      chapters: [{ fromMs: 0, toMs: 100500, title: "Giriş" }, { fromMs: 0, toMs: 0, title: "" }],
      heatmap: [{ fromMs: 0, toMs: 10000, value: 1 }, { fromMs: 0, toMs: 0, value: 0 }],
    });
    expect(metaOf({ duration: 5, channel: "C", chapters: null, heatmap: null, language: null }, "x")).toEqual({ videoId: "x", title: "x", channel: "C", durationMs: 5000, width: 0, height: 0, description: "", chapters: [], heatmap: [] });
    expect(metaOf({ duration: 5 }, "x").channel).toBe("");
    expect(() => metaOf({ duration: 5, is_live: true }, "x")).toThrow("Canlı yayın");
    expect(() => metaOf({}, "x")).toThrow("Canlı yayın");
  });

  it("pickCaptions: önce videonun dilinde elle, sonra bölüm dilinde elle, sonra özgün otomatik", () => {
    expect(pickCaptions({ language: "en-US", subtitles: { "en-GB": [], tr: [], live_chat: [] } }, "tr")).toEqual({ lang: "en-GB", auto: false });
    expect(pickCaptions({ language: "en", subtitles: { en: [] } }, "tr")).toEqual({ lang: "en", auto: false });
    expect(pickCaptions({ language: "de", subtitles: { tr: [] }, automatic_captions: { "de-orig": [] } }, "tr")).toEqual({ lang: "tr", auto: false });
    expect(pickCaptions({ language: "de", automatic_captions: { tr: [], "de-orig": [], de: [] } }, "tr")).toEqual({ lang: "de-orig", auto: true });
    expect(pickCaptions({ language: "de", automatic_captions: { tr: [], de: [] } }, "tr")).toEqual({ lang: "de", auto: true });
    // Dil biliniyor ama özgün otomatik yok: çeviri alınmaz.
    expect(pickCaptions({ language: "de", automatic_captions: { tr: [] } }, "tr")).toBeUndefined();
    // Dil bilinmiyor: -orig varsa o, yoksa bölüm dilinde otomatik.
    expect(pickCaptions({ automatic_captions: { "fr-orig": [], tr: [] } }, "tr")).toEqual({ lang: "fr-orig", auto: true });
    expect(pickCaptions({ automatic_captions: { tr: [] } }, "tr-TR")).toEqual({ lang: "tr", auto: true });
    expect(pickCaptions({ subtitles: null, automatic_captions: null }, "tr")).toBeUndefined();
    expect(pickCaptions({}, "tr")).toBeUndefined();
  });

  it("parseJson3: otomatik altyazının parça zamanları, elle yazılmışın satırı harf sayısıyla bölünür", () => {
    const auto = JSON.stringify({
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Merhaba" }, { utf8: " dünya", tOffsetMs: 800 }] },
        { tStartMs: 3000, aAppend: 1, segs: [{ utf8: "\n" }] },
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Merhaba" }] },
        { tStartMs: 2500, dDurationMs: 1000 },
        { tStartMs: 5000, dDurationMs: 1000, segs: [{}, { utf8: "son" }, { utf8: "söz" }] },
      ],
    });
    expect(parseJson3(auto)).toEqual([
      { text: "Merhaba", startMs: 1000, endMs: 1800 },
      { text: "dünya", startMs: 1800, endMs: 3000 },
      { text: "son", startMs: 5000, endMs: 5000 },
      { text: "söz", startMs: 5000, endMs: 6000 },
    ]);
    const manual = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "ab  abc\nd" }] }, { segs: [{ utf8: "x" }] }] });
    expect(parseJson3(manual)).toEqual([
      { text: "ab", startMs: 0, endMs: 0 },
      { text: "x", startMs: 0, endMs: 0 },
      { text: "abc", startMs: 333, endMs: 833 },
      { text: "d", startMs: 833, endMs: 1000 },
    ]);
    expect(parseJson3("bozuk")).toEqual([]);
    expect(parseJson3("{}")).toEqual([]);
  });
});

describe("sahneler ve pencereler", () => {
  it("scenesFrom: kısa sahne sonrakine (sondaki öncekine) katılır; sınır dışı ve yinelenen kesimler atılır", () => {
    expect(scenesFrom([5000, 5000, 5800, 0, 20000, 99999, 29500], 30000)).toEqual([
      { fromMs: 0, toMs: 5000 },
      { fromMs: 5000, toMs: 20000 },
      { fromMs: 20000, toMs: 30000 },
    ]);
    expect(scenesFrom([400], 1000)).toEqual([{ fromMs: 0, toMs: 1000 }]);
    expect(scenesFrom([], 30000)).toEqual([{ fromMs: 0, toMs: 30000 }]);
  });

  it("sceneFrameTimes: ortası, uzun sahnede eşit aralıklı ek kareler", () => {
    expect(sceneFrameTimes({ fromMs: 0, toMs: 4000 })).toEqual([2000]);
    expect(sceneFrameTimes({ fromMs: 10_000, toMs: 70_000 })).toEqual([20_000, 40_000, 60_000]);
  });

  it("planWindows: sahneler pencereyi doldurur, uzun sahne kendi penceresi, fazla kare seyreltilir", () => {
    const scenes = [
      { fromMs: 0, toMs: 200_000 },
      { fromMs: 200_000, toMs: 350_000 },
      { fromMs: 350_000, toMs: 400_000 },
      { fromMs: 400_000, toMs: 1_200_000 },
    ];
    const frames: YoutubeFrame[] = [
      { atMs: 1000, scene: 1, key: "a" },
      { atMs: 300_000, scene: 2, key: "b" },
      ...Array.from({ length: 60 }, (_, i) => ({ atMs: 400_000 + i * 10_000, scene: 4, key: `k${i}` })),
    ];
    const w = planWindows(scenes, frames);
    expect(w.map((x) => [x.fromMs, x.toMs, x.frames.length])).toEqual([
      [0, 350_000, 2],
      [350_000, 400_000, 0],
      [400_000, 1_200_000, YOUTUBE.windowFrames],
    ]);
    expect(w[2]!.frames[1]!.key).toBe("k1");
    expect(w[2]!.frames.at(-1)!.key).toBe("k58");
  });

  it("sheetsOf 12'lik sayfalar; heatmapIn gruplar; heatPeaks en yüksekleri zaman sırasıyla verir", () => {
    expect(sheetsOf(Array.from({ length: 25 }, (_, i) => i)).map((s) => s.length)).toEqual([12, 12, 1]);
    const heat = Array.from({ length: 100 }, (_, i) => ({ fromMs: i * 1000, toMs: (i + 1) * 1000, value: i / 100 }));
    const inside = heatmapIn(heat, 10_000, 60_000);
    expect(inside.length).toBeLessThanOrEqual(YOUTUBE.heatPoints);
    expect(inside[0]).toEqual({ atSec: 11.5, value: (0.1 + 0.11 + 0.12) / 3 });
    expect(heatmapIn(heat, 500_000, 600_000)).toEqual([]);
    expect(heatPeaks(heat).map((p) => p.atSec)).toEqual([92.5, 93.5, 94.5, 95.5, 96.5, 97.5, 98.5, 99.5]);
  });
});

describe("adaylar", () => {
  const meta: YoutubeMeta = { videoId: "v", title: "T", channel: "", durationMs: 600_000, width: 1920, height: 1080, description: "", chapters: [], heatmap: [] };
  const words: WordTiming[] = [
    { text: "bir", startMs: 9_800, endMs: 10_400 },
    { text: "iki", startMs: 39_700, endMs: 40_500 },
  ];
  const seg = (fromSec: number, toSec: number) => ({ fromSec, toSec, focusX: 0.4, fit: "cover" as const });
  const cand = (score: number, segments: ReturnType<typeof seg>[], over: Partial<YoutubeShortsOut["candidates"][number]> = {}): YoutubeShortsOut["candidates"][number] => ({ title: ` t${score} `, hook: " kanca ", why: " neden ", score, mood: "warm", segments, ...over });
  const limits = { count: 6, minSec: 20, maxSec: 60 };

  it("kenarlar kelime sınırına oturur, yakın parçalar birleşir, kısa parça atılır; puana göre sıralanır", () => {
    const out = normalizeCandidates({ candidates: [cand(5, [seg(100, 130)]), cand(8, [seg(10, 25), seg(25.2, 40), seg(50, 50.5)])] }, meta, words, limits);
    expect(out.map((c) => [c.id, c.title, c.hook, c.why, c.score])).toEqual([
      ["c1", "t8", "kanca", "neden", 8],
      ["c2", "t5", "kanca", "neden", 5],
    ]);
    expect(out[0]!.segments).toEqual([{ fromMs: 9_800, toMs: 40_500, focusX: 0.4, fit: "cover" }]);
    expect(out[0]!.durationMs).toBe(30_700);
  });

  it("uzun aday sondan kırpılır (çok kısalan son parça atılır); kısa aday ileri, video biterse geri uzar; olmazsa atılır", () => {
    const long = normalizeCandidates({ candidates: [cand(9, [seg(100, 150), seg(200, 215)])] }, meta, [], limits)[0]!;
    expect(long.segments).toEqual([
      { fromMs: 100_000, toMs: 150_000, focusX: 0.4, fit: "cover" },
      { fromMs: 200_000, toMs: 210_000, focusX: 0.4, fit: "cover" },
    ]);
    const cut = normalizeCandidates({ candidates: [cand(9, [seg(100, 159.5), seg(200, 210)])] }, meta, [], limits)[0]!;
    expect(cut.segments).toEqual([{ fromMs: 100_000, toMs: 159_500, focusX: 0.4, fit: "cover" }]);
    expect(normalizeCandidates({ candidates: [cand(9, [seg(100, 110)])] }, meta, [], limits)[0]!.segments).toEqual([{ fromMs: 100_000, toMs: 120_000, focusX: 0.4, fit: "cover" }]);
    expect(normalizeCandidates({ candidates: [cand(9, [seg(590, 598)])] }, meta, [], limits)[0]!.segments).toEqual([{ fromMs: 580_000, toMs: 600_000, focusX: 0.4, fit: "cover" }]);
    const tiny = { ...meta, durationMs: 10_000 };
    expect(normalizeCandidates({ candidates: [cand(9, [seg(1, 8)])] }, tiny, [], limits)).toEqual([]);
    expect(normalizeCandidates({ candidates: [cand(9, [seg(700, 800)])] }, meta, [], limits)).toEqual([]);
  });

  it("örtüşen düşük puanlı aday atılır; sayı sınırı", () => {
    const out = normalizeCandidates({ candidates: [cand(9, [seg(100, 130)]), cand(7, [seg(110, 140)]), cand(6, [seg(200, 230)]), cand(5, [seg(300, 330)])] }, meta, [], { ...limits, count: 2 });
    expect(out.map((c) => c.score)).toEqual([9, 6]);
    // Eşit puanda seçicinin sırası korunur.
    expect(normalizeCandidates({ candidates: [cand(6, [seg(200, 230)], { title: "ilk" }), cand(6, [seg(300, 330)], { title: "ikinci" })] }, meta, [], limits).map((c) => c.title)).toEqual(["ilk", "ikinci"]);
  });

  it("mergeWindows: sırala, videoya sınırla, boşları at, sahneye kare bağla", () => {
    const out = (scenes: Partial<YoutubeWindowOut["scenes"][number]>[], extra: Partial<YoutubeWindowOut> = {}): YoutubeWindowOut => ({
      scenes: scenes.map((s) => ({ fromSec: 0, toSec: 1, summary: "s", people: "", onScreenText: "", energy: 3, quality: "good", ...s })),
      cuts: [],
      moments: [],
      ...extra,
    });
    const merged = mergeWindows(
      [out([{ fromSec: 60, toSec: 70, summary: "b" }], { cuts: [{ fromSec: 5, toSec: 4, reason: "filler", note: "x" }] }), out([{ fromSec: 0, toSec: 10, summary: "a" }, { fromSec: 590, toSec: 700, summary: "c" }])],
      [{ atMs: 5000, scene: 1, key: "f5" }],
      600_000,
    );
    expect(merged.scenes.map((s) => [s.summary, s.fromSec, s.toSec, s.frameKey])).toEqual([
      ["a", 0, 10, "f5"],
      ["b", 60, 70, undefined],
      ["c", 590, 600, undefined],
    ]);
    expect(merged.cuts).toEqual([]);
    expect(merged.moments).toEqual([]);
  });

  it("candidatePlan dörtlük vuruşlar, özgün ses, kanca yazısı; candidateWords parçalara düşen kelimeler", () => {
    const source: FootageSource = { id: "f1", key: "library/youtube/v/video.mp4", name: "T.mp4", ext: "mp4", kind: "video", durationMs: 600_000, width: 1920, height: 1080, audio: true };
    const c: YoutubeCandidate = { id: "c1", title: "Başlık", hook: "Kanca", why: "w", score: 8, mood: "warm", durationMs: 25_000, segments: Array.from({ length: 5 }, (_, i) => ({ fromMs: i * 10_000, toMs: i * 10_000 + 5000, focusX: 0.3, fit: "cover" as const })) };
    const plan = candidatePlan(c, source);
    expect(plan.title).toBe("Başlık");
    expect(plan.beats.map((b) => [b.id, b.segments.length, b.narration, b.mood])).toEqual([
      ["b1", 4, "", "warm"],
      ["b2", 1, "", "warm"],
    ]);
    expect(plan.beats[0]!.segments[0]).toEqual({ source: "f1", fromMs: 0, toMs: 5000, focusX: 0.3, fit: "cover", audio: "original", why: "Başlık" });
    expect(plan.overlays).toEqual([{ text: "Kanca", style: "hook", beat: "b1", position: "top" }]);
    expect(candidatePlan({ ...c, hook: "" }, source).overlays).toEqual([]);
    const ws: WordTiming[] = [
      { text: "a", startMs: 3500, endMs: 3900 },
      { text: "b", startMs: 5800, endMs: 6100 },
      { text: "c", startMs: 7000, endMs: 7500 },
    ];
    expect(candidateWords(ws, { ...c, segments: [{ fromMs: 0, toMs: 5000, focusX: 0.5, fit: "cover" }] }).map((w) => w.text)).toEqual(["a", "b"]);
  });
});
