import { describe, expect, it } from "vitest";
import { beatSec, MotionFilm, MotionLook, MotionScene, PACE_BEATS, sceneContent, sceneFrames } from "../src/index.ts";

const scene = (over: Record<string, unknown>) => MotionScene.parse({ id: "m1", beats: 4, ...over });

describe("hareketli grafik filmi tarifi", () => {
  it("varsayılanlar: tempo adımı vuruş, sert kesme, sabit kamera, zemin, vurgusuz, boş anlatım", () => {
    const s = scene({ language: "kinetic", kinetic: { lines: ["Merhaba"], mode: "slam" } });
    expect([s.pace, s.transition, s.camera, s.ground, s.hit, s.narration]).toEqual(["beat", "cut", "still", "ground", "none", ""]);
    expect(PACE_BEATS).toEqual({ eighth: 0.5, beat: 1, half: 2, bar: 4 });
    expect(MotionLook.parse({ bpm: 120, palette: { ground: "#ffffff", ink: "#000000", accent: "#ff0000", alt: "#00ff00" }, type: "clear" })).toMatchObject({ images: [], sections: [] });
  });

  it("dil ile içerik uyuşmalı (veri: sayaçta sayı, grafikte en az iki nokta)", () => {
    expect(sceneContent(scene({ language: "kinetic" }))).toBe(false);
    expect(sceneContent(scene({ language: "kinetic", kinetic: { lines: ["a"], mode: "rise" } }))).toBe(true);
    expect(sceneContent(scene({ language: "data", data: { chart: "count", title: "t" } }))).toBe(false);
    expect(sceneContent(scene({ language: "data", data: { chart: "count", title: "t", count: { to: 5 } } }))).toBe(true);
    expect(sceneContent(scene({ language: "data", data: { chart: "bars", title: "t", points: [{ label: "a", value: 1 }] } }))).toBe(false);
    expect(sceneContent(scene({ language: "data", data: { chart: "line", title: "t", points: [{ label: "a", value: 1 }, { label: "b", value: 2 }] } }))).toBe(true);
    expect(sceneContent(scene({ language: "data" }))).toBe(false);
    expect(sceneContent(scene({ language: "diagram", diagram: { nodes: [{ id: "a", label: "A", col: 0, row: 0 }, { id: "b", label: "B", col: 1, row: 0 }] } }))).toBe(true);
    expect(sceneContent(scene({ language: "grid", grid: { cards: [{ title: "x" }] } }))).toBe(true);
    expect(sceneContent(scene({ language: "field", field: { kind: "sparks" } }))).toBe(true);
    expect(sceneContent(scene({ language: "object", object: { preset: "atom" } }))).toBe(true);
    expect(sceneContent(scene({ language: "object" }))).toBe(false);
  });

  it("sahne sınırları birikmiş vuruştan yuvarlanır: uzun filmde kayma birikmez", () => {
    expect(beatSec(120)).toBe(0.5);
    // 116 BPM'de vuruş 15,517 kare: tek tek yuvarlansaydı 10 sahnede 5 kare kayardı.
    const spans = sceneFrames(Array.from({ length: 10 }, () => ({ beats: 1 })), 116, 30);
    expect(spans.at(-1)!.fromFrame + spans.at(-1)!.frames).toBe(Math.round(10 * (60 / 116) * 30));
    expect(spans.map((s) => s.frames)).toContain(16);
    expect(spans.map((s) => s.frames)).toContain(15);
    expect(sceneFrames([{ beats: 0 }], 120, 30)).toEqual([{ fromFrame: 0, frames: 1 }]);
  });

  it("film şeması: tempo sınırda, sahne kimliği m<n>, renk #RRGGBB", () => {
    const film = { title: "T", bpm: 116, route: "hybrid", palette: { ground: "#ffffff", ink: "#000000", accent: "#ff0000", alt: "#00ff00" }, type: "clear", sections: [{ name: "hook", bars: 2, energy: 7 }], scenes: [{ id: "m1", language: "field", beats: 4, field: { kind: "starfield" } }] };
    expect(MotionFilm.safeParse(film).success).toBe(true);
    expect(MotionFilm.safeParse({ ...film, bpm: 200 }).success).toBe(false);
    expect(MotionFilm.safeParse({ ...film, scenes: [{ ...film.scenes[0], id: "s1" }] }).success).toBe(false);
    expect(MotionFilm.safeParse({ ...film, palette: { ...film.palette, ink: "black" } }).success).toBe(false);
  });
});
