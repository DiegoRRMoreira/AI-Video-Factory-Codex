import { describe, expect, it } from "vitest";
import { editFootagePlan, editNarration, newEpisodeState, normalizePlan, planScript, readPlanEdit, type EpisodeState, type FootagePlan } from "../src/index.ts";

const sources = [
  { id: "f1", key: "k/f1.mp4", name: "yol.mp4", ext: "mp4", kind: "video" as const, durationMs: 20000, width: 1920, height: 1080, audio: true },
  { id: "f2", key: "k/f2.jpg", name: "foto.jpg", ext: "jpg", kind: "image" as const, durationMs: 0, width: 800, height: 600, audio: false },
];
const plan: FootagePlan = {
  title: "Gezi",
  beats: [
    { id: "b1", narration: "Eski anlatım.", mood: "warm", segments: [{ source: "f1", fromMs: 1000, toMs: 4000, focusX: 0.3, fit: "cover", audio: "ambient", why: "yol" }] },
    { id: "b2", narration: "", mood: "night", segments: [{ source: "f1", fromMs: 5000, toMs: 8000, focusX: 0.5, fit: "cover", audio: "original", why: "konuşma" }, { source: "f2", fromMs: 0, toMs: 2000, focusX: 0.5, fit: "contain", audio: "mute", why: "foto" }] },
  ],
  overlays: [{ text: "Kanca", style: "hook", beat: "b1", position: "top" }],
};

function footageState(over: Partial<EpisodeState> = {}): EpisodeState {
  const state = newEpisodeState({ topic: "t", lang: "tr", targetSec: 30, tier: "economy", aiClipRatio: 0, budgetUsd: 1, width: 1080, height: 1920, fps: 30, footage: { sources, narration: true, transcribe: true, texts: ["Benim yazım"] } });
  return { ...state, footagePlan: structuredClone(plan), script: planScript(plan), done: { story: "t", script: "t" }, ...over };
}

describe("elle kurgu düzenlemesi", () => {
  it("planScript vuruş başına sahne kurar", () => {
    expect(planScript(plan).scenes.map((s) => [s.id, s.narration, s.visualIntent, s.emotion])).toEqual([
      ["b1", "Eski anlatım.", "yol", "warm"],
      ["b2", "", "konuşma; foto", "night"],
    ]);
  });

  it("readPlanEdit ajan biçimine çevirir: anlatım senaryodan, aralık sn, odak sınırda, yazı vuruş sırasıyla", () => {
    const raw = { ...structuredClone(plan), beats: [plan.beats[1], { ...plan.beats[0], segments: [{ ...plan.beats[0]!.segments[0], focusX: 3, fromMs: -5, why: 7 }] }] };
    const out = readPlanEdit(raw, { b1: "Yeni anlatım." });
    expect(out.beats.map((b) => b.narration)).toEqual(["", "Yeni anlatım."]);
    expect(out.beats[1]!.segments[0]).toEqual({ source: "f1", fromSec: 0, toSec: 4, focusX: 1, fit: "cover", audio: "ambient", why: "" });
    expect(out.overlays).toEqual([{ text: "Kanca", style: "hook", beat: 2, position: "top" }]);
    expect(readPlanEdit({ ...plan, title: 5 }, {}).title).toBe("");
    expect(readPlanEdit({ ...plan, beats: [{ ...plan.beats[0], narration: 5 }] }, {}).beats[0]!.narration).toBe("");
  });

  it("bozuk biçim reddedilir", () => {
    const seg = plan.beats[0]!.segments[0]!;
    const beat = (over: object) => ({ ...plan, beats: [{ ...plan.beats[0], ...over }] });
    for (const raw of [
      null,
      [],
      { ...plan, beats: [] },
      { ...plan, beats: "x" },
      { ...plan, overlays: "x" },
      { ...plan, beats: Array.from({ length: 21 }, () => plan.beats[0]) },
      { ...plan, overlays: Array.from({ length: 13 }, () => plan.overlays[0]) },
      { ...plan, beats: [null] },
      beat({ id: 5 }),
      beat({ mood: "happy" }),
      beat({ segments: [] }),
      beat({ segments: "x" }),
      beat({ segments: Array.from({ length: 9 }, () => seg) }),
      beat({ segments: [null] }),
      beat({ segments: [{ ...seg, source: 1 }] }),
      beat({ segments: [{ ...seg, fromMs: "1" }] }),
      beat({ segments: [{ ...seg, toMs: Number.NaN }] }),
      beat({ segments: [{ ...seg, focusX: undefined }] }),
      beat({ segments: [{ ...seg, fit: "zoom" }] }),
      beat({ segments: [{ ...seg, audio: "loud" }] }),
      { ...plan, overlays: [null] },
      { ...plan, overlays: [{ ...plan.overlays[0], text: 1 }] },
      { ...plan, overlays: [{ ...plan.overlays[0], style: "x" }] },
      { ...plan, overlays: [{ ...plan.overlays[0], position: "x" }] },
      { ...plan, overlays: [{ ...plan.overlays[0], beat: "b9" }] },
      { ...plan, overlays: [{ ...plan.overlays[0], beat: 1 }] },
    ]) expect(() => readPlanEdit(raw, {}), JSON.stringify(raw)?.slice(0, 80)).toThrow("Geçersiz");
  });

  it("düzenleme kuralları uygular, vuruşları yeniden numaralar, senaryoyu kurar; silinen kullanıcı yazısı geri gelmez", () => {
    const state = footageState({ voice: { b1: { key: "v", mimeType: "audio/mpeg", durationMs: 1, words: [], estimatedTiming: false } }, footageCuts: [] });
    const raw = { ...structuredClone(plan), beats: [plan.beats[1], plan.beats[0]], overlays: [] };
    editFootagePlan(state, raw);
    expect(state.footagePlan!.beats.map((b) => [b.id, b.mood, b.narration])).toEqual([
      ["b1", "night", ""],
      ["b2", "warm", "Eski anlatım."],
    ]);
    expect(state.footagePlan!.overlays).toEqual([]);
    expect(state.script!.scenes.map((s) => s.id)).toEqual(["b1", "b2"]);
    expect(state.voice).toBeUndefined();
    expect(state.footageCuts).toBeUndefined();
    expect(state.done).toEqual({ story: "t", script: "t" });
    // Ajanın kurgusunda eksik kullanıcı yazısı eklenir; elle düzenlemede eklenmez.
    expect(normalizePlan({ title: "", beats: [{ narration: "", mood: "day", segments: [{ source: "f1", fromSec: 0, toSec: 2, focusX: 0.5, fit: "cover", audio: "mute", why: "" }] }], overlays: [] }, state.input.footage!).overlays).toHaveLength(1);
  });

  it("onaylı ya da kurgusuz bölümde düzenlenmez", () => {
    expect(() => editFootagePlan(footageState({ approvals: { script: "t" } }), plan)).toThrow("Senaryo onaylandı");
    expect(() => editFootagePlan(footageState({ footagePlan: undefined }), plan)).toThrow("Önce senaryo");
    const plain = footageState();
    delete plain.input.footage;
    expect(() => editFootagePlan(plain, plan)).toThrow("Önce senaryo");
    expect(() => editFootagePlan(footageState({ script: undefined }), plan)).not.toThrow();
  });

  it("anlatım düzenlemesi kurgudaki vuruşa da yazılır", () => {
    const state = footageState();
    editNarration(state, "b1", "Yeni metin.");
    expect(state.footagePlan!.beats[0]!.narration).toBe("Yeni metin.");
    const plain = footageState({ footagePlan: undefined });
    editNarration(plain, "b1", "Başka.");
    expect(plain.script!.scenes[0]!.narration).toBe("Başka.");
  });
});
