import { describe, expect, it } from "vitest";
import type { FootageEditOut } from "@ys/agents";
import {
  beatStarts,
  fitCuts,
  FOOTAGE,
  footageTimeline,
  frameTimes,
  normalizePlan,
  overlayTimes,
  posterMs,
  sourceWords,
  type FootageCut,
  type FootageInput,
  type FootagePlan,
  type FootageSource,
} from "../src/footage.ts";

const video = (id: string, sec: number, audio = true): FootageSource => ({ id, key: `k/${id}.mp4`, name: `${id}.mp4`, ext: "mp4", kind: "video", durationMs: sec * 1000, width: 1920, height: 1080, audio });
const image = (id: string): FootageSource => ({ id, key: `k/${id}.jpg`, name: `${id}.jpg`, ext: "jpg", kind: "image", durationMs: 0, width: 1200, height: 800, audio: false });
const input = (sources: FootageSource[], extra: Partial<FootageInput> = {}): FootageInput => ({ sources, narration: true, transcribe: true, texts: [], ...extra });
const seg = (source: string, fromSec: number, toSec: number, audio: "original" | "ambient" | "mute" = "ambient") => ({ source, fromSec, toSec, focusX: 0.5, fit: "cover" as const, audio, why: `${source} ${fromSec}` });

describe("frameTimes", () => {
  it("videoya süresine göre 2–12 kare, resme tek kare; kareler aralıkların ortasından", () => {
    const t = frameTimes([video("f1", 2), video("f2", 10), video("f3", 100), image("f4")]);
    expect(t.f1).toEqual([500, 1500]);
    expect(t.f2).toEqual([1250, 3750, 6250, 8750]);
    expect(t.f3).toHaveLength(FOOTAGE.framesMax);
    expect(t.f4).toEqual([0]);
  });

  it("toplam kare bütçeyi aşarsa kaynak başına oranlanır, en az 2 kalır", () => {
    const many = Array.from({ length: 6 }, (_, i) => video(`f${i + 1}`, 60));
    const t = frameTimes(many);
    const total = Object.values(t).reduce((n, a) => n + a.length, 0);
    expect(total).toBeLessThanOrEqual(FOOTAGE.frameBudget);
    expect(t.f1!.length).toBe(Math.floor(12 * (40 / 72)));
    const crowd = frameTimes(Array.from({ length: 30 }, (_, i) => video(`f${i + 1}`, 60)));
    expect(crowd.f1).toHaveLength(FOOTAGE.framesMin);
  });
});

describe("normalizePlan", () => {
  const sources = [video("f1", 20), video("f2", 10, false), image("f3")];
  const out = (beats: FootageEditOut["beats"], overlays: FootageEditOut["overlays"] = []): FootageEditOut => ({ title: " Başlık ", beats, overlays });

  it("kaynağa sığdırır, kısa ve bilinmeyen parçayı atar, sessiz kaynağı susturur, anlatımlı vuruşta konuşmayı kısar", () => {
    const plan = normalizePlan(
      out([
        { narration: " Merhaba ", mood: "warm", segments: [seg("f1", -1, 4, "original"), seg("f9", 0, 2), seg("f1", 5, 5.5), seg("f2", 2, 30, "original")] },
        { narration: "", mood: "night", segments: [seg("f3", 0, 0.2, "original"), seg("f3", 0, 2.5), seg("f1", 10, 14, "original")] },
      ]),
      input(sources),
    );
    expect(plan.title).toBe("Başlık");
    expect(plan.beats[0]).toEqual({
      id: "b1",
      narration: "Merhaba",
      mood: "warm",
      segments: [
        { source: "f1", fromMs: 0, toMs: 4000, focusX: 0.5, fit: "cover", audio: "ambient", why: "f1 -1" },
        { source: "f2", fromMs: 2000, toMs: 10000, focusX: 0.5, fit: "cover", audio: "mute", why: "f2 2" },
      ],
    });
    expect(plan.beats[1]!.segments.map((s) => [s.fromMs, s.toMs, s.audio])).toEqual([
      [0, FOOTAGE.imageMs, "mute"],
      [0, 2500, "mute"],
      [10000, 14000, "original"],
    ]);
  });

  it("anlatım kapalıysa metin silinir; boş kalan vuruş atlanır, yazının vuruşu yeniden numaralanır", () => {
    const plan = normalizePlan(
      out(
        [
          { narration: "silinir", mood: "day", segments: [seg("f9", 0, 2)] },
          { narration: "bu da", mood: "day", segments: [seg("f1", 0, 3, "original")] },
        ],
        [
          { text: "Kanca", style: "hook", beat: 2, position: "top" },
          { text: "yok", style: "label", beat: 1, position: "top" },
          { text: "  ", style: "label", beat: 2, position: "top" },
        ],
      ),
      input(sources, { narration: false }),
    );
    expect(plan.beats).toHaveLength(1);
    expect(plan.beats[0]!.narration).toBe("");
    expect(plan.beats[0]!.segments[0]!.audio).toBe("original");
    expect(plan.overlays).toEqual([{ text: "Kanca", style: "hook", beat: "b1", position: "top" }]);
  });

  it("kullanıcının kurguda olmayan yazıları vuruşlara sırayla dağıtılır", () => {
    const beats = Array.from({ length: 4 }, () => ({ narration: "", mood: "day" as const, segments: [seg("f1", 0, 2)] }));
    const plan = normalizePlan(out(beats, [{ text: "Bir", style: "title", beat: 1, position: "center" }]), input(sources, { texts: ["Bir", " İki ", "Üç", " "] }));
    expect(plan.overlays).toEqual([
      { text: "Bir", style: "title", beat: "b1", position: "center" },
      { text: "İki", style: "label", beat: "b2", position: "top" },
      { text: "Üç", style: "label", beat: "b4", position: "top" },
    ]);
  });

  it("hiç parça kalmazsa hata", () => {
    expect(() => normalizePlan(out([{ narration: "", mood: "day", segments: [seg("f9", 0, 3)] }]), input(sources))).toThrow("Kurgu boş");
  });
});

const plan = (beats: FootagePlan["beats"], overlays: FootagePlan["overlays"] = []): FootagePlan => ({ title: "T", beats, overlays });
const s = (source: string, fromMs: number, toMs: number, audio: "original" | "ambient" | "mute" = "mute") => ({ source, fromMs, toMs, focusX: 0.4, fit: "contain" as const, audio, why: "w" });

describe("fitCuts", () => {
  const sources = [video("f1", 30), video("f2", 4), image("f3")];

  it("anlatımsız: vuruşlar kurgudaki oranla hedefe ölçeklenir; video kısalır, resim istenen kadar kalır", () => {
    const cuts = fitCuts(plan([{ id: "b1", narration: "", mood: "day", segments: [s("f1", 0, 10000), s("f3", 0, 2000)] }, { id: "b2", narration: "", mood: "day", segments: [s("f1", 10000, 18000)] }]), sources, {}, 10000);
    expect(cuts.map((c) => [c.id, c.startMs, c.durMs, c.fromMs, c.toMs, c.speed])).toEqual([
      ["b1-sh1", 0, 5000, 0, 5000, 1],
      ["b1-sh2", 5000, 1000, 0, 1000, 1],
      ["b2-sh1", 6000, 4000, 10000, 14000, 1],
    ]);
    expect(beatStarts(cuts)).toEqual({ b1: 0, b2: 6000 });
  });

  it("vuruş uzayınca video önce ileri, sonra geri uzar, yetmezse yavaşlar; konuşan parça kendi uzunluğunda", () => {
    const cuts = fitCuts(
      plan([
        { id: "b1", narration: "", mood: "day", segments: [s("f1", 25000, 28000), s("f2", 1000, 3000), s("f1", 0, 2000, "original")] },
      ]),
      sources,
      {},
      14000,
    );
    // Vuruş 14 sn; konuşan parça 2 sn, kalan 12 sn iki esnek parçaya 3:2.
    expect(cuts.map((c) => [c.durMs, c.fromMs, c.toMs, Number(c.speed.toFixed(3))])).toEqual([
      [7200, 22800, 30000, 1],
      [4800, 0, 4000, 0.833],
      [2000, 0, 2000, 1],
    ]);
  });

  it("yavaşlatma da yetmezse son kare donar: parça kısalmaz, sonraki anlatımlı vuruş öncekinin sesinden sonra başlar", () => {
    const cuts = fitCuts(
      plan([
        { id: "b1", narration: "uzun", mood: "day", segments: [s("f2", 0, 4000)] },
        { id: "b2", narration: "sonra", mood: "day", segments: [s("f1", 0, 2000)] },
      ]),
      sources,
      { b1: 10000, b2: 1000 },
      5000,
    );
    expect(cuts[0]).toMatchObject({ speed: FOOTAGE.minSpeed, durMs: 10300, holdMs: 10300 - Math.round(4000 / FOOTAGE.minSpeed), fromMs: 0, toMs: 4000 });
    expect(cuts[1]!.startMs).toBeGreaterThanOrEqual(10000);
  });

  it("anlatımı olan vuruşta kaynak konuşması ortam sesine iner ve esner", () => {
    const cuts = fitCuts(plan([{ id: "b1", narration: "x", mood: "day", segments: [s("f1", 0, 2000, "original")] }]), sources, { b1: 5700 }, 1000);
    expect(cuts[0]).toMatchObject({ audio: "ambient", durMs: 6000, fromMs: 0, toMs: 6000 });
  });

  it("yalnız konuşan parçalardan oluşan vuruş, parçaların toplamı kadar sürer", () => {
    const cuts = fitCuts(plan([{ id: "b1", narration: "", mood: "day", segments: [s("f1", 0, 3000, "original")] }, { id: "b2", narration: "", mood: "day", segments: [s("f1", 3000, 6000)] }]), sources, {}, 60000);
    expect(cuts.map((c) => [c.startMs, c.durMs])).toEqual([
      [0, 3000],
      // Kalan 57 sn'ye 30 sn'lik kaynak 0.6 hızla 50 sn yeter, son 7 sn son kare durur.
      [3000, 57000],
    ]);
    expect(cuts[1]).toMatchObject({ speed: FOOTAGE.minSpeed, holdMs: 7000 });
  });
});

describe("posterMs", () => {
  const hook = { text: "K", style: "hook" as const, fromFrame: 0, durationInFrames: 105, position: "top" as const, anim: "kinetic" as const };
  const v = (fromFrame: number, durationInFrames: number) => ({ shotId: `v${fromFrame}`, assetUrl: "x", kind: "footage" as const, fromFrame, durationInFrames, ambience: "none" as const, playbackRate: 1 });

  it("kanca tam açıkken (bitişinden 0,4 sn önce); kanca yoksa üçte bir", () => {
    expect(posterMs({ fps: 30, durationInFrames: 450, visuals: [v(0, 450)], overlays: [{ ...hook, style: "label" }, hook] })).toBe(3100);
    expect(posterMs({ fps: 30, durationInFrames: 450, visuals: [], overlays: [{ ...hook, durationInFrames: 6 }] })).toBe(0);
    expect(posterMs({ fps: 30, durationInFrames: 450, visuals: [] })).toBe(5000);
  });

  it("geçişe düşen an: geçiş bitince, kancaya sığmıyorsa geçişten hemen önce", () => {
    // 3,1 sn ikinci çekimin 0,1 sn'sine düşer; 3,7 kancanın (3,2'ye kadar) dışında: geçişten önce 2,9.
    expect(posterMs({ fps: 30, durationInFrames: 450, visuals: [v(0, 90), v(90, 360)], overlays: [hook] })).toBe(2900);
    // Geçiş bitişi kancaya sığıyor: 2,5 + 0,7 = 3,2 sn.
    expect(posterMs({ fps: 30, durationInFrames: 450, visuals: [v(0, 75), v(75, 375)], overlays: [hook] })).toBe(3200);
    // Kancasız: üçte birdeki geçiş.
    expect(posterMs({ fps: 30, durationInFrames: 450, visuals: [v(0, 150), v(150, 300)] })).toBe(5700);
  });
});

describe("sourceWords ve overlayTimes", () => {
  const cut = (over: Partial<FootageCut>): FootageCut => ({ id: "b1-sh1", beat: "b1", source: "f1", kind: "video", fromMs: 1000, toMs: 3000, speed: 1, holdMs: 0, startMs: 5000, durMs: 2000, focusX: 0.5, fit: "cover", audio: "original", why: "", ...over });

  it("yalnız tam sesle çalan parçanın içindeki kelimeler, bölüm zamanına taşınır (yavaşlatma ölçeklenir)", () => {
    const words = [
      { text: "önce", startMs: 500, endMs: 900 },
      { text: "içinde", startMs: 1200, endMs: 1600 },
      { text: "taşan", startMs: 2800, endMs: 3200 },
    ];
    expect(sourceWords([cut({}), cut({ id: "b1-sh2", audio: "ambient" }), cut({ id: "b2-sh1", source: "f2", startMs: 0, speed: 0.5 })], { f1: { frames: [], words }, f2: { frames: [] } })).toEqual([{ text: "içinde", startMs: 5200, endMs: 5600 }]);
    expect(sourceWords([cut({ speed: 0.5 })], { f1: { frames: [], words } })).toEqual([{ text: "içinde", startMs: 5400, endMs: 6200 }]);
  });

  it("kanca baştan, çağrı vuruş sonunda, diğerleri vuruş başında; vuruşu aşmaz; vuruşu olmayan yazı atılır", () => {
    const cuts = [cut({ beat: "b1", startMs: 0, durMs: 6000 }), cut({ id: "b2-sh1", beat: "b2", startMs: 6000, durMs: 2000 })];
    const p = plan([], [
      { text: "Kanca", style: "hook", beat: "b1", position: "top" },
      { text: "Etiket", style: "label", beat: "b2", position: "center" },
      { text: "Abone ol", style: "cta", beat: "b2", position: "bottom" },
      { text: "Yok", style: "title", beat: "b9", position: "top" },
    ]);
    expect(overlayTimes(p, cuts, 30)).toEqual([
      { text: "Kanca", style: "hook", fromFrame: 0, durationInFrames: 105, position: "top", anim: "kinetic" },
      { text: "Etiket", style: "label", fromFrame: 180, durationInFrames: 60, position: "center", anim: "typewriter" },
      { text: "Abone ol", style: "cta", fromFrame: 180, durationInFrames: 60, position: "bottom", anim: "pop" },
    ]);
    expect(overlayTimes(plan([], [{ text: "x", style: "title", beat: "b1", position: "top" }]), [cut({ durMs: 10 })], 30)).toEqual([]);
  });
});

describe("footageTimeline", () => {
  it("parçalar, anlatım, kaynak ses, altyazı ve yazılar", () => {
    const p = plan(
      [
        { id: "b1", narration: "Merhaba dünya", mood: "warm", segments: [] },
        { id: "b2", narration: "", mood: "night", segments: [] },
        { id: "b3", narration: "yok", mood: "day", segments: [] },
      ],
      [{ text: "Kanca", style: "hook", beat: "b1", position: "top" }],
    );
    const cuts: FootageCut[] = [
      { id: "b1-sh1", beat: "b1", source: "f1", kind: "video", fromMs: 0, toMs: 2000, speed: 1, holdMs: 0, startMs: 0, durMs: 2000, focusX: 0.5, fit: "cover", audio: "ambient", why: "" },
      { id: "b1-sh2", beat: "b1", source: "f3", kind: "image", fromMs: 0, toMs: 1000, speed: 1, holdMs: 0, startMs: 2000, durMs: 1000, focusX: 0.5, fit: "contain", audio: "mute", why: "" },
      { id: "b2-sh1", beat: "b2", source: "f1", kind: "video", fromMs: 5000, toMs: 7000, speed: 1, holdMs: 0, startMs: 3000, durMs: 2000, focusX: 0.5, fit: "cover", audio: "original", why: "" },
      { id: "b2-sh2", beat: "b2", source: "f2", kind: "image", fromMs: 0, toMs: 500, speed: 1, holdMs: 0, startMs: 5000, durMs: 500, focusX: 0.5, fit: "cover", audio: "ambient", why: "" },
    ];
    const t = footageTimeline({
      episodeId: "e1",
      lang: "tr",
      fps: 30,
      width: 1080,
      height: 1920,
      plan: p,
      cuts,
      assets: { visual: { "b1-sh1": "v1.mp4", "b1-sh2": "v2.jpg", "b2-sh1": "v3.mp4", "b2-sh2": "v4.jpg" }, audio: { "b1-sh1": "a1.wav", "b2-sh1": "a3.wav" } },
      voice: { b1: { key: "voice.mp3", durationMs: 2500, words: [{ text: "Merhaba", startMs: 0, endMs: 600 }, { text: "dünya", startMs: 700, endMs: 1200 }] }, b3: { key: "x.mp3", durationMs: 1, words: [] } },
      scans: { f1: { frames: [], words: [{ text: "Selam", startMs: 5500, endMs: 6000 }] } },
    });
    expect(t).toMatchObject({ episodeId: "e1", lang: "tr", fps: 30, width: 1080, height: 1920, durationInFrames: 165, vectorAssets: {}, palette: [], lineStyle: "outline", texture: "none" });
    expect(t.visuals.map((v) => [v.shotId, v.kind, v.assetUrl, v.fromFrame, v.durationInFrames, v.mood, v.motion?.panX])).toEqual([
      ["b1-sh1", "footage", "v1.mp4", 0, 60, "warm", undefined],
      ["b1-sh2", "still_motion", "v2.jpg", 60, 30, "warm", -0.3],
      ["b2-sh1", "footage", "v3.mp4", 90, 60, "night", undefined],
      ["b2-sh2", "still_motion", "v4.jpg", 150, 15, "night", -0.3],
    ]);
    expect(t.visuals[1]!.motion).toMatchObject({ type: "ken_burns", zoomFrom: 1, zoomTo: FOOTAGE.zoom });
    expect(t.audio).toEqual([
      { role: "voice", assetUrl: "voice.mp3", fromFrame: 0, durationInFrames: 75, volume: 1 },
      { role: "source", assetUrl: "a1.wav", fromFrame: 0, durationInFrames: 60, volume: FOOTAGE.ambientVolume },
      { role: "source", assetUrl: "a3.wav", fromFrame: 90, durationInFrames: 60, volume: 1 },
    ]);
    expect(t.captions.map((w) => [w.text, w.startMs])).toEqual([
      ["Merhaba", 0],
      ["dünya", 700],
      ["Selam", 3500],
    ]);
    expect(t.speech).toEqual(t.captions);
    expect(t.overlays).toEqual([{ text: "Kanca", style: "hook", fromFrame: 0, durationInFrames: 90, position: "top", anim: "kinetic" }]);
  });

  it("boş kesimde en az bir kare; ilk sıradaki resim sağa kayar", () => {
    const t = footageTimeline({ episodeId: "e", lang: "tr", fps: 30, width: 1080, height: 1920, plan: plan([]), cuts: [], assets: { visual: {}, audio: {} }, voice: {}, scans: {} });
    expect(t.durationInFrames).toBe(1);
    const still: FootageCut = { id: "b1-sh1", beat: "b1", source: "f3", kind: "image", fromMs: 0, toMs: 2000, speed: 1, holdMs: 0, startMs: 0, durMs: 2000, focusX: 0.5, fit: "cover", audio: "mute", why: "" };
    const one = footageTimeline({ episodeId: "e", lang: "tr", fps: 30, width: 1080, height: 1920, plan: plan([]), cuts: [still], assets: { visual: { "b1-sh1": "s.jpg" }, audio: {} }, voice: {}, scans: {} });
    expect(one.visuals[0]!.motion?.panX).toBe(0.3);
  });
});
