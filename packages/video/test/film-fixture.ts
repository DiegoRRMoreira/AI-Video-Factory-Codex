import { MotionFilm, MotionScene, type MotionPalette } from "@ys/core";

// Hareketli grafik filmi testlerinin ortak örnekleri: her dil ve kip için kısa sahneler.
export const PALETTE: MotionPalette = { ground: "#f3efe6", ink: "#141414", accent: "#ff4f1f", alt: "#1e2a3a" };

export const sc = (over: Record<string, unknown>): MotionScene => MotionScene.parse({ id: "m1", beats: 8, ...over });

export const kinetic = (mode: "slam" | "rise" | "words" | "chapter", over: Record<string, unknown> = {}) =>
  sc({ language: "kinetic", kinetic: { lines: ["Ship faster now", "40 minutes"], mode, highlight: "40 minutes", ...(mode === "chapter" ? { chapter: { index: 2, total: 5 } } : {}) }, ...over });

export const bars = (over: Record<string, unknown> = {}) =>
  sc({ language: "data", data: { chart: "bars", title: "Deploy time", unit: "min", points: [{ label: "A", value: 40 }, { label: "B", value: -5 }, { label: "C", value: 12.5 }], highlight: 2, callout: "Cache", source: "Internal" }, ...over });

export const line = (over: Record<string, unknown> = {}) =>
  sc({ language: "data", data: { chart: "line", title: "Weekly", unit: "%", points: [{ label: "W1", value: 6 }, { label: "W2", value: 9 }, { label: "W3", value: 22 }], highlight: 2, callout: "After" }, ...over });

export const count = (over: Record<string, unknown> = {}) =>
  sc({ language: "data", data: { chart: "count", title: "Faster", count: { to: 70, suffix: "%" } }, ...over });

export const diagram = (over: Record<string, unknown> = {}) =>
  sc({
    language: "diagram",
    diagram: {
      title: "Flow",
      nodes: [
        { id: "a", label: "Commit", col: 0, row: 0 },
        { id: "b", label: "Shared Cache", col: 1, row: 1 },
        { id: "c", label: "Deploy", col: 2, row: 0 },
      ],
      edges: [
        { from: "a", to: "b", label: "push" },
        { from: "b", to: "c" },
        { from: "a", to: "zz" },
      ],
      highlight: "c",
    },
    ...over,
  });

export const grid = (mode: "grid" | "montage", over: Record<string, unknown> = {}) =>
  sc({ language: "grid", grid: { mode, title: "All in one", cards: [{ title: "Cache", stat: "12", image: 0 }, { title: "Logs", body: "Every build" }, { title: "Alerts on every deploy" }] }, ...over });

export const field = (over: Record<string, unknown> = {}) => sc({ language: "field", field: { kind: "starfield", title: "Build once", subtitle: "Ship everywhere" }, ...over });

export const object = (over: Record<string, unknown> = {}) => sc({ language: "object", object: { preset: "crystal", title: "Relay", caption: "Ship faster" }, ...over });

export const film = (scenes: MotionScene[], over: Record<string, unknown> = {}): MotionFilm =>
  MotionFilm.parse({
    title: "Relay",
    bpm: 120,
    route: "hybrid",
    palette: PALETTE,
    type: "clear",
    sections: [{ name: "build", bars: 8, energy: 6 }],
    scenes: scenes.map((s, i) => ({ ...s, id: `m${i + 1}` })),
    ...over,
  });
