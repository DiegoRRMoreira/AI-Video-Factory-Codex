import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MotionFilm, sceneFrames } from "../packages/core/src/index.ts";
import { filmTimeline, normalizeFilm } from "../packages/pipeline/src/motion.ts";
import { lintFilm } from "../packages/video/src/motion-film/lint.ts";
import { renderStills } from "../packages/video/src/render.ts";

// Çevrimdışı örnek: yapay zeka çağrısı, kimlik bilgisi ve dış dosya yok. Hareketli grafik filminin bütün dillerini çizer.
// pnpm motion:film [klasör] [--portrait]
const output = resolve(process.argv[2] ?? "out/motion-film");
const portrait = process.argv.includes("--portrait");
const fps = 30;
await mkdir(resolve(output, "public"), { recursive: true });

const brief = "Relay cuts deploys from 40 minutes to 12 with a shared build cache; teams ship 70% faster.";
const raw = MotionFilm.parse({
  title: "Relay",
  bpm: 116,
  route: "hybrid",
  type: "clear",
  palette: { ground: "#f3efe6", ink: "#141414", accent: "#ff4f1f", alt: "#1e2a3a" },
  sections: [
    { name: "hook", bars: 2, energy: 7 },
    { name: "build", bars: 6, energy: 6 },
    { name: "peak", bars: 4, energy: 9 },
    { name: "stop", bars: 1, energy: 1 },
    { name: "resolve", bars: 4, energy: 4 },
  ],
  scenes: [
    { id: "m1", language: "kinetic", beats: 4, camera: "punch", hit: "impact", kinetic: { lines: ["Ship faster."], mode: "slam" } },
    { id: "m2", language: "kinetic", beats: 6, ground: "ink", transition: "flash", kinetic: { lines: ["Every deploy takes", "40 minutes"], mode: "words", highlight: "40 minutes" } },
    { id: "m3", language: "data", beats: 8, transition: "whip", data: { chart: "bars", title: "Deploy time (minutes)", points: [{ label: "Mon", value: 40 }, { label: "Tue", value: 38 }, { label: "Wed", value: 41 }, { label: "Thu", value: 12 }], highlight: 3, callout: "Shared cache" } },
    { id: "m4", language: "diagram", beats: 8, transition: "push", diagram: { title: "One cache for every build", nodes: [{ id: "commit", label: "Commit", col: 0, row: 0 }, { id: "cache", label: "Cache", col: 1, row: 1 }, { id: "build", label: "Build", col: 2, row: 0 }, { id: "deploy", label: "Deploy", col: 3, row: 1 }], edges: [{ from: "commit", to: "cache" }, { from: "cache", to: "build" }, { from: "build", to: "deploy", label: "12 min" }], highlight: "deploy" } },
    { id: "m5", language: "grid", beats: 4, ground: "accent", grid: { mode: "montage", cards: [{ title: "Tests" }, { title: "Lint" }, { title: "Preview" }, { title: "Rollback" }] } },
    { id: "m6", language: "data", beats: 6, transition: "flood", data: { chart: "count", title: "Teams ship faster", count: { to: 70, suffix: "%" } } },
    { id: "m7", language: "grid", beats: 8, pace: "half", grid: { title: "Everything in one place", cards: [{ title: "Cache", stat: "12 min" }, { title: "Logs", body: "Every build, searchable" }, { title: "Previews" }, { title: "Secrets" }, { title: "Rollbacks" }, { title: "Alerts" }] } },
    { id: "m8", language: "data", beats: 8, transition: "whip", data: { chart: "line", title: "Weekly deploys", points: [{ label: "W1", value: 6 }, { label: "W2", value: 9 }, { label: "W3", value: 14 }, { label: "W4", value: 22 }], highlight: 3, callout: "After Relay" } },
    { id: "m9", language: "field", beats: 4, transition: "iris", field: { kind: "starfield", title: "Build once." } },
    { id: "m10", language: "object", beats: 8, camera: "pull", transition: "flip", object: { preset: "crystal", title: "Relay", caption: "Ship faster." } },
    { id: "m11", language: "kinetic", beats: 6, kinetic: { lines: ["The end of waiting"], mode: "chapter", chapter: { index: 3, total: 3 } } },
  ],
});
const film = normalizeFilm(raw, { brief, images: 0, colors: [], targetSec: 60, fps });
const timeline = filmTimeline({ episodeId: "motion-film-preview", lang: "en", fps, width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080, film, images: [], voice: {}, captions: false });
await writeFile(resolve(output, "timeline.json"), JSON.stringify(timeline, null, 2));
console.log(JSON.stringify(lintFilm(film, fps), null, 2));
const spans = sceneFrames(film.scenes, film.bpm, fps);
const frames = Object.fromEntries(
  film.scenes.flatMap((s, i) => {
    const { fromFrame, frames: n } = spans[i]!;
    return [
      [`${s.id}-a`, fromFrame + 2],
      [`${s.id}-b`, fromFrame + Math.round(n * 0.45)],
      [`${s.id}-c`, fromFrame + n - 2],
    ];
  }),
);
console.log(await renderStills({ timeline, publicDir: resolve(output, "public"), frames, outDir: output, onWait: (pid) => console.log(`Waiting for render ${pid}`) }));
