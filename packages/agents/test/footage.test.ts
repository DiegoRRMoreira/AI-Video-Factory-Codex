import { describe, expect, it } from "vitest";
import { AgentError, FootageCheckOut, FootageEditOut, footageEditor, footageInspector, toOutputSchema, transcriptLines, type FootageEditInput, type QueryFn } from "../src/index.ts";

type Params = { prompt: string | AsyncIterable<{ message: { content: { type: string; text?: string }[] } }>; options: Record<string, unknown> };

/** Sahte Claude: istemi kaydeder, sonuçsuz biter (çağrı AgentError ile düşer; yalnız istem denetlenir). */
function capture() {
  const seen: { params?: Params } = {};
  const queryFn = ((p: Params) => {
    seen.params = p;
    return (async function* () {
      yield { type: "result", subtype: "error_max_turns", duration_ms: 1, total_cost_usd: 0 };
    })();
  }) as unknown as QueryFn;
  const parts = async () => {
    const out: { type: string; text?: string }[] = [];
    for await (const m of seen.params!.prompt as AsyncIterable<{ message: { content: { type: string; text?: string }[] } }>) out.push(...m.message.content);
    return out;
  };
  return { queryFn, seen, parts };
}

const img = { data: new Uint8Array([1]), mimeType: "image/jpeg" };
const base: FootageEditInput = {
  brief: "Bisiklet turu",
  lang: "tr",
  targetSec: 30,
  narration: true,
  texts: ["Kendi yazım"],
  sources: [
    { id: "f1", name: "yol.mp4", kind: "video", durationSec: 12.3, width: 1920, height: 1080, audio: true, frames: [{ atSec: 1, image: img }, { atSec: 5.5, image: img }], words: [{ text: "Selam", startMs: 0, endMs: 400 }, { text: "millet", startMs: 450, endMs: 900 }, { text: "bakın", startMs: 2500, endMs: 2900 }] },
    { id: "f2", name: "sessiz.mov", kind: "video", durationSec: 4, width: 1080, height: 1920, audio: false, frames: [{ atSec: 2, image: img }] },
    { id: "f3", name: "kare.jpg", kind: "image", durationSec: 0, width: 800, height: 600, audio: false, frames: [{ atSec: 0, image: img }] },
    { id: "f4", name: "konusmasiz.mp4", kind: "video", durationSec: 3, width: 640, height: 360, audio: true, frames: [], words: [] },
  ],
};

describe("kurgu ajanı", () => {
  it("kareleri sırayla gönderir; kaynakları, dökümü, hedefi ve kullanıcının yazılarını anlatır", async () => {
    const { queryFn, seen, parts } = capture();
    await expect(footageEditor(base, { queryFn })).rejects.toThrow(AgentError);
    const content = await parts();
    expect(content.filter((c) => c.type === "image")).toHaveLength(4);
    const text = content.find((c) => c.type === "text")!.text!;
    expect(text).toContain("Brief: Bisiklet turu\nLanguage: tr\nTarget length: 30 s");
    expect(text).toContain(`f1 "yol.mp4": video, 1920×1080, 12.3 s, has sound\n  frames: images 1–2 at 1.0s, 5.5s\n  speech:\n  [0.0–0.9] Selam millet\n  [2.5–2.9] bakın`);
    expect(text).toContain(`f2 "sessiz.mov": video, 1080×1920, 4.0 s, silent\n  frames: images 3–3 at 2.0s`);
    expect(text).toContain(`f3 "kare.jpg": image, 800×600\n  frames: images 4–4 at 0.0s`);
    expect(text).toContain(`f4 "konusmasiz.mp4": video, 640×360, 3.0 s, has sound\n  frames: none\n  speech: none detected`);
    expect(text).toContain("Narration is ON");
    expect(text).toMatch(/about \d+ words in total/);
    expect(text).toContain("- Kendi yazım");
    expect(String(seen.params!.options.systemPrompt)).toContain("vertical 9:16 Short");
  });

  it("anlatım kapalı ve yazı yoksa öyle söyler", async () => {
    const { queryFn, parts } = capture();
    await expect(footageEditor({ ...base, narration: false, texts: [], sources: [base.sources[1]!] }, { queryFn })).rejects.toThrow(AgentError);
    const text = (await parts()).find((c) => c.type === "text")!.text!;
    expect(text).toContain("Narration is OFF");
    expect(text).toContain("The user gave no on-screen texts.");
  });

  it("döküm satırları boşlukta bölünür; boş döküm boş", () => {
    expect(transcriptLines([])).toBe("");
    expect(transcriptLines([{ text: "a", startMs: 0, endMs: 100 }, { text: "b", startMs: 900, endMs: 1000 }], 700)).toBe("  [0.0–0.1] a\n  [0.9–1.0] b");
  });

  it("çıktı şeması: vuruş başına 1–4 parça, odak 0–1", () => {
    const schema = toOutputSchema(FootageEditOut) as { required: string[] };
    expect(schema.required).toEqual(["title", "beats", "overlays"]);
    const segment = { source: "f1", fromSec: 0, toSec: 2, focusX: 0.5, fit: "cover", audio: "mute", why: "x" };
    const beat = { narration: "", mood: "day", segments: [segment] };
    expect(FootageEditOut.safeParse({ title: "t", beats: [beat], overlays: [] }).success).toBe(true);
    expect(FootageEditOut.safeParse({ title: "t", beats: [{ ...beat, segments: [] }], overlays: [] }).success).toBe(false);
    expect(FootageEditOut.safeParse({ title: "t", beats: [{ ...beat, segments: [{ ...segment, focusX: 2 }] }], overlays: [] }).success).toBe(false);
  });
});

describe("kadraj denetçisi", () => {
  it("kaynak ve dikey kareleri çiftler hâlinde gönderir; parçaları sırayla anlatır", async () => {
    const { queryFn, seen, parts } = capture();
    const one = { data: new Uint8Array([1]), mimeType: "image/jpeg" }, two = { data: new Uint8Array([2]), mimeType: "image/jpeg" };
    await expect(footageInspector([{ id: "b1-sh1", why: "road", cut: two, source: one }, { id: "b1-sh2", why: "", cut: two, source: one }], { queryFn })).rejects.toThrow(AgentError);
    const content = await parts();
    expect(content.filter((c) => c.type === "image")).toHaveLength(4);
    const text = content.find((c) => c.type === "text")!.text!;
    expect(text).toContain("1. b1-sh1: road (images 1–2)");
    expect(text).toContain("2. b1-sh2: no description (images 3–4)");
    expect(String(seen.params!.options.systemPrompt)).toContain("first the SOURCE frame, then the VERTICAL frame");
    expect(FootageCheckOut.safeParse({ parts: [{ id: "a", evidence: "e", verdict: "cut", focusX: 0.5, fit: "cover" }] }).success).toBe(false);
  });
});
