import { Timeline, VectorAsset, VectorShot, type BenchmarkSampleProvenance } from "@ys/core";
import type { BenchShot } from "./benchmark.ts";
import type { EpisodeState } from "./state.ts";

export const BENCHMARK_SUPPLEMENT = "fixture-e-text-v2";

// Özgün, sessiz test sahneleri: metin/kadraj örneğidir; konuşma veya kültürel uyarlama kanıtı değildir.
export function benchmarkSupplement(): { states: Record<string, EpisodeState>; shots: BenchShot[] } {
  const states: Record<string, EpisodeState> = {};
  const first: BenchShot[] = [], second: BenchShot[] = [];
  const stage = VectorAsset.parse({ id: "stage", kind: "background", width: 1920, height: 1080,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><path fill="#F3F0E6" d="M0 0H1920V1080H0Z"/><path d="M0 800H1920" stroke="#567060" stroke-width="4"/></svg>', meta: { floorY: 800 } });
  const parcel = VectorAsset.parse({ id: "parcel", kind: "prop", width: 200, height: 160,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160"><rect x="8" y="8" width="184" height="144" rx="12" fill="#28718B" stroke="#16261E" stroke-width="8"/><path d="M100 12V148M12 65H188" stroke="#F3F0E6" stroke-width="8"/><circle cx="145" cy="110" r="14" fill="#F0BE55"/></svg>', meta: { grounded: true, realHeight: .6 } });
  for (const lang of ["tr", "en"] as const) for (const portrait of [false, true]) {
    const id = `corpus-text-${lang}-${portrait ? "portrait" : "landscape"}`;
    const width = portrait ? 1080 : 1920, height = portrait ? 1920 : 1080;
    const title = lang === "tr" ? "Çığ ve ışık" : "Avalanche and light", hold = lang === "tr" ? "İşaret burada" : "Marker stays";
    const provenance: BenchmarkSampleProvenance = { kind: "synthetic", languageScope: "on-screen-text",
      purpose: "A marker travels to its landing position in the first two seconds, then holds; the next shot keeps a readable localized title. Silent test inputs; no speech alignment or editorial approval.",
      coverageTargets: ["readable-text", "intentional-hold", ...portrait ? ["portrait" as const] : []] };
    const shots: NonNullable<EpisodeState["shots"]> = [0, 1].map((index) => ({
      id: `s${index + 1}-sh1`, sceneId: `s${index + 1}`, kind: "still_motion", startMs: index * 4000, endMs: (index + 1) * 4000,
      description: index ? "The marker holds its landing position under the localized title." : "The marker moves horizontally, lands after two seconds, and holds.",
      imagePrompt: "", motionPrompt: "", camera: "static",
      vector: VectorShot.parse({ background: "stage", camera: { zoomFrom: 1, zoomTo: 1, panX: 0 },
        layers: [{ asset: "parcel", x: index ? 1070 : 850, y: 800, height: 180, anims: index ? [] : [{ type: "move", toX: 1070, start: 0, end: .5 }] }],
        texts: [{ text: index ? hold : title, x: 960, y: 180, style: "title", color: "#16261E" }] }),
    }));
    const timeline = Timeline.parse({ episodeId: id, lang, fps: 30, width, height, durationInFrames: 240,
      palette: ["#F3F0E6", "#16261E", "#28718B", "#F0BE55"], vectorAssets: { stage, parcel },
      visuals: shots.map((shot, index) => ({ shotId: shot.id, kind: "motion_graphic", assetUrl: "", fromFrame: index * 120, durationInFrames: 120, enter: false, vector: shot.vector, stylePack: "paper-poster" })),
      captions: [], speech: [], audio: [] });
    states[id] = { id, createdAt: "2026-11-17T00:00:00.000Z", input: { topic: "Synthetic localized title and crop verification", lang, width, height, fps: 30,
      targetSec: 8, tier: "economy", budgetUsd: 0, aiClipRatio: 0, motionMode: "vector", stylePack: "paper-poster", captions: false, music: false, sfx: false, short: false },
      done: {}, agentCostUsd: 0, shots, timeline };
    first.push({ episode: id, shot: shots[0]!.id, category: "scene", provenance });
    second.push({ episode: id, shot: shots[1]!.id, category: "scene", provenance });
  }
  // İlk dört klip dört dil/tuval hücresini de kapsar; kategori kotası seçiminde kaybolmaz.
  return { states, shots: [...first, ...second] };
}
