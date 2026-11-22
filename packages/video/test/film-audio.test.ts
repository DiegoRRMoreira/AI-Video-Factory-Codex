import { Timeline, type MotionSection } from "@ys/core";
import { describe, expect, it } from "vitest";
import { cutLook, cutsOf, cutStyle, FILM_CUT } from "../src/cut.ts";
import { MUSIC_RATE } from "../src/music.ts";
import { grooveOf, SCORE, scoreTrack } from "../src/motion-film/score.ts";
import { filmSounds } from "../src/motion-film/sounds.ts";
import { FILM } from "../src/motion-film/timing.ts";
import { mixSfx, sfxEvents, synth, SFX_RATE } from "../src/sfx.ts";
import { bars, count, diagram, field, grid, kinetic, line, object, PALETTE } from "./film-fixture.ts";

const FPS = 30;
const land = Math.round(FILM.enterSec * FPS * 0.6);
const sounds = (events: { sound: string }[]) => events.map((e) => e.sound);

describe("film sahnesinin sesleri", () => {
  it("sahne vurgusu kesmede; riser kesmeye biter, filmin başında çalmaz", () => {
    expect(filmSounds(field({ hit: "riser" }), 60, 120, 120, FPS)[0]).toEqual({ frame: 30, sound: "riser", frames: 30 });
    expect(filmSounds(field({ hit: "riser" }), 10, 120, 120, FPS)[0]).toEqual({ frame: 0, sound: "riser", frames: 10 });
    expect(filmSounds(field({ hit: "riser" }), 0, 120, 120, FPS)).toEqual([]);
    expect(filmSounds(field({ hit: "impact" }), 5, 120, 120, FPS)).toEqual([{ frame: 5, sound: "impact" }, { frame: 5, sound: "subdrop", gain: 0.7 }]);
    expect(filmSounds(field({ hit: "pop" }), 5, 120, 120, FPS)).toEqual([{ frame: 5, sound: "pop" }]);
    expect(filmSounds(field({ hit: "none" }), 5, 120, 120, FPS)).toEqual([]);
    expect(filmSounds(object({ transition: "whip" }), 5, 120, 120, FPS)).toEqual([{ frame: 5, sound: "whoosh", pitch: 1.5, gain: 0.8 }]);
    expect(filmSounds(object({ transition: "push" }), 5, 120, 120, FPS)[0]).toMatchObject({ sound: "whoosh", pitch: 0.8 });
  });

  it("öğelerin inişleri: slam/bölüm gövdesi, kelime ve çubuk tıkı, not pop'u, sayaç tıkları ve zil", () => {
    expect(filmSounds(kinetic("slam"), 0, 240, 120, FPS)).toEqual([
      { frame: land, sound: "thud", gain: 0.8 },
      { frame: 15 + land, sound: "tick", gain: 0.8 },
    ]);
    expect(sounds(filmSounds(kinetic("chapter"), 0, 240, 120, FPS))).toEqual(["thud", "tick", "tick"]);
    expect(filmSounds(kinetic("words"), 0, 240, 120, FPS).map((e) => e.frame)).toEqual([0, 15, 30, 45, 60]);
    expect(sounds(filmSounds(kinetic("rise"), 0, 240, 120, FPS))).toEqual(["tick", "tick"]);
    expect(sounds(filmSounds(bars(), 0, 240, 120, FPS))).toEqual(["tick", "tick", "tick", "pop"]);
    expect(sounds(filmSounds(line({ data: { chart: "line", title: "t", points: [{ label: "a", value: 1 }, { label: "b", value: 2 }] } }), 0, 240, 120, FPS))).toEqual(["tick", "tick"]);
    const c = filmSounds(count(), 0, 240, 120, FPS);
    expect(c.at(-1)).toEqual({ frame: 15 + Math.round(FILM.countSec * FPS), sound: "ding" });
    expect(c.filter((e) => e.sound === "tick").length).toBeGreaterThan(5);
  });

  it("diyagramda düğüm pop'u, bağ tıkı; montajda her kesmede vuruş, ızgarada kart inişi; alan sessiz", () => {
    expect(sounds(filmSounds(diagram(), 0, 240, 120, FPS))).toEqual(["pop", "pop", "tick", "pop", "tick"]);
    const montage = filmSounds(grid("montage"), 0, 240, 120, FPS);
    expect(montage).toEqual([
      { frame: 15, sound: "hit", pitch: 1.04, gain: 0.45 },
      { frame: 30, sound: "hit", pitch: 1.08, gain: 0.45 },
    ]);
    expect(filmSounds(grid("grid"), 0, 240, 120, FPS).every((e) => e.sound === "thud")).toBe(true);
    expect(filmSounds(field(), 0, 240, 120, FPS)).toEqual([]);
  });

  it("yeni sentez sesleri duyulur ve kazanç izde uygulanır", () => {
    for (const sound of ["hit", "thud", "impact", "subdrop", "riser"] as const) {
      const s = synth({ frame: 0, sound, frames: 30 }, FPS, 1);
      expect(s.length).toBeGreaterThan(0);
      expect(Math.max(...s.map(Math.abs))).toBeGreaterThan(0.05);
    }
    // Uzunluğu verilmeyen riser bir saniye sürer; çok kısası 0,2 sn'ye çıkar.
    expect(synth({ frame: 0, sound: "riser" }, FPS, 1).length).toBe(SFX_RATE);
    expect(synth({ frame: 0, sound: "riser", frames: 1 }, FPS, 1).length).toBe(Math.round(0.2 * SFX_RATE));
    const full = mixSfx([{ frame: 0, sound: "hit" }], 30, FPS);
    const half = mixSfx([{ frame: 0, sound: "hit", gain: 0.3 }], 30, FPS);
    const peak = (a: Int16Array) => Math.max(...a.map(Math.abs));
    expect(peak(half)).toBeLessThan(peak(full));
  });

  it("timeline: film sahnesi görünümle sese döner, görünümsüz film sahnesi sessiz", () => {
    const visual = { shotId: "m1", assetUrl: "", kind: "motion_graphic", fromFrame: 0, durationInFrames: 120, film: field({ hit: "hit" }) };
    const look = { bpm: 120, palette: PALETTE, type: "clear" };
    expect(sfxEvents(Timeline.parse({ episodeId: "e", lang: "en", durationInFrames: 120, visuals: [visual], audio: [], motion: look }))).toEqual([{ frame: 0, sound: "hit" }]);
    expect(sfxEvents(Timeline.parse({ episodeId: "e", lang: "en", durationInFrames: 120, visuals: [visual], audio: [] }))).toEqual([]);
  });
});

describe("film geçişleri", () => {
  const v = (shotId: string, transition?: string) => ({ shotId, ...(transition ? { film: { transition } } : {}) });
  it("film sahnesi kendi geçişini taşır: whip/push/iris Episode'da, ötekiler sert kesme; yön dönüşümlü", () => {
    const cuts = cutsOf([v("m1", "whip"), v("m2", "whip"), v("m3", "push"), v("m4", "iris"), v("m5", "flash"), v("m6", "cut")], "x");
    expect(cuts).toEqual([
      undefined,
      { kind: "whip", frames: FILM_CUT.whip, dir: 1 },
      { kind: "push", frames: FILM_CUT.push, dir: -1 },
      { kind: "iris", frames: FILM_CUT.iris, dir: 1 },
      undefined,
      undefined,
    ]);
  });

  it("savrulma yandan gelir, yatay bulanıklığı whip-pan-cut gibi en çok 16 px; içinden geçiş büyükten oturur", () => {
    const whip = { kind: "whip" as const, frames: 8, dir: -1 as const };
    expect(cutStyle(whip, 0.5)).toEqual({ transform: "translateX(-50%)" });
    expect(cutLook(whip, 0.5, 0.3, 1920, 1080).sigmaX).toBe(FILM_CUT.whipBlur);
    const push = { kind: "push" as const, frames: 9, dir: 1 as const };
    expect(cutStyle(push, 0.25)).toEqual({ opacity: 0.5, transform: "scale(1.45)" });
    expect(cutLook(push, 0.5, 0.3, 1920, 1080).style.filter).toMatch(/^blur\(/);
    expect(cutLook(push, 0.5, 0.0001, 1920, 1080).style.filter).toBeUndefined();
  });
});

describe("filmin müziği", () => {
  const tl = (sections: MotionSection[], sec: number, words: { startMs: number; endMs: number }[] = []) =>
    Timeline.parse({
      episodeId: "e",
      lang: "en",
      durationInFrames: sec * FPS,
      visuals: [],
      audio: [],
      speech: words.map((w) => ({ text: "x", ...w })),
      motion: { bpm: 120, palette: PALETTE, type: "clear", sections },
    });
  const rms = (s: Int16Array, a: number, b: number) => {
    let sum = 0;
    for (let i = Math.round(a * MUSIC_RATE); i < Math.round(b * MUSIC_RATE); i++) sum += (s[i]! / 32767) ** 2;
    return Math.sqrt(sum / ((b - a) * MUSIC_RATE));
  };

  it("doku bölümün adından ve enerjisinden", () => {
    expect(grooveOf({ name: "stop", bars: 1, energy: 9 })).toMatchObject({ kick: [], hats: 0, bass: 0, pad: false });
    expect(grooveOf({ name: "resolve", bars: 1, energy: 6 })).toMatchObject({ kick: [0, 2], hats: 2, crash: true });
    expect(grooveOf({ name: "resolve", bars: 1, energy: 3 })).toMatchObject({ kick: [0], hats: 0 });
    expect(grooveOf({ name: "peak", bars: 1, energy: 9 })).toMatchObject({ kick: [0, 1, 2, 3], snare: [1, 3], hats: 4, bass: 2 });
    expect(grooveOf({ name: "peak", bars: 1, energy: 6 }).hats).toBe(2);
    expect(grooveOf({ name: "hook", bars: 1, energy: 8 })).toMatchObject({ kick: [0, 1, 2, 3], snare: [1, 3], bass: 2, pad: false });
    expect(grooveOf({ name: "hook", bars: 1, energy: 4 })).toMatchObject({ kick: [0, 2], snare: [], bass: 1, pad: true });
    expect(grooveOf({ name: "build", bars: 1, energy: 7 })).toMatchObject({ kick: [0, 1, 2, 3], hats: 2, bass: 2 });
    expect(grooveOf({ name: "build", bars: 1, energy: 3 })).toMatchObject({ kick: [0, 2.5], hats: 0, bass: 1 });
  });

  it("ritim çizelgesinde çalar: duruş sessiz, sonraki bölüme ters zil; aynı girdi aynı iz", () => {
    // 120 BPM: ölçü 2 sn. kanca 1, duruş 1, zirve 2 ölçü (8 sn).
    const sections: MotionSection[] = [{ name: "hook", bars: 1, energy: 7 }, { name: "stop", bars: 1, energy: 0 }, { name: "peak", bars: 2, energy: 9 }];
    const a = scoreTrack(tl(sections, 8), "seed");
    expect(a.sections).toEqual(["hook", "stop", "peak"]);
    expect(a.samples.length).toBe(8 * MUSIC_RATE);
    expect(rms(a.samples, 2.3, 3.4)).toBeLessThan(rms(a.samples, 0.2, 1.8) / 5);
    // Duruşun son vuruşunda ters zil kabarır.
    expect(rms(a.samples, 3.6, 4)).toBeGreaterThan(rms(a.samples, 2.3, 3.4));
    expect(scoreTrack(tl(sections, 8), "seed").samples).toEqual(a.samples);
  });

  it("çizelge yoksa tek kurulum bölümü; anlatımda kısılır; çizelge filmden uzunsa kesilir", () => {
    const plain = scoreTrack(tl([], 6), "s");
    expect(plain.sections).toEqual(["build"]);
    const ducked = scoreTrack(tl([], 6, [{ startMs: 2000, endMs: 4000 }]), "s");
    expect(rms(ducked.samples, 2.5, 3.5)).toBeLessThan(rms(plain.samples, 2.5, 3.5) * 0.6);
    expect(scoreTrack(tl([{ name: "build", bars: 20, energy: 6 }], 4), "s").samples.length).toBe(4 * MUSIC_RATE);
    expect(SCORE.rms).toBeGreaterThan(0);
    // Bölüm sonunda dolgu: sonraki bölüm duruş değilse son vuruşta trampet koşusu.
    const fill = scoreTrack(tl([{ name: "hook", bars: 1, energy: 4 }, { name: "build", bars: 1, energy: 3 }], 4), "s");
    expect(rms(fill.samples, 1.5, 2)).toBeGreaterThan(rms(fill.samples, 1, 1.5) * 0.5);
  });

  it("sessiz çizelge (yalnız duruş) sessiz iz verir", () => {
    const silent = scoreTrack(tl([{ name: "stop", bars: 2, energy: 0 }], 4), "s");
    expect(silent.samples.every((x) => x === 0)).toBe(true);
  });
});
