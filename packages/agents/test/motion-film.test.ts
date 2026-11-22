import { describe, expect, it } from "vitest";
import { MOTION_FILM_POLICY } from "../src/motion-design.ts";
import { AgentError, MotionFilmOut, motionDirector, toOutputSchema, type MotionDirectInput, type QueryFn } from "../src/index.ts";

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
  const text = async () => {
    const p = seen.params!.prompt;
    if (typeof p === "string") return { text: p, images: 0 };
    const out: { type: string; text?: string }[] = [];
    for await (const m of p) out.push(...m.message.content);
    return { text: out.find((c) => c.type === "text")!.text!, images: out.filter((c) => c.type === "image").length };
  };
  return { queryFn, seen, text };
}

const base: MotionDirectInput = { brief: "Relay: deploys 40 → 12 min", lang: "en", targetSec: 30, tall: false, narration: false, colors: [], images: [] };
const FILM = {
  title: "R",
  bpm: 120,
  route: "hybrid",
  palette: { ground: "#ffffff", ink: "#000000", accent: "#ff0000", alt: "#00ff00" },
  type: "clear",
  sections: [{ name: "hook", bars: 1, energy: 7 }],
  scenes: [{ id: "m1", language: "kinetic", beats: 4, kinetic: { lines: ["Go"], mode: "slam" } }],
} as const;

describe("film yönetmeni", () => {
  it("anlatımsız, renksiz, görselsiz yatay film: ilkeler sistemde, brif ve hedef istemde", async () => {
    const { queryFn, seen, text } = capture();
    await expect(motionDirector(base, { queryFn })).rejects.toThrow(AgentError);
    const system = String((seen.params!.options as { systemPrompt?: unknown }).systemPrompt ?? JSON.stringify(seen.params!.options));
    expect(system).toContain("horizontal 16:9");
    expect(system).toContain(MOTION_FILM_POLICY.slice(0, 60));
    const { text: prompt, images } = await text();
    expect(images).toBe(0);
    expect(prompt).toContain("Brief: Relay: deploys 40 → 12 min");
    expect(prompt).toContain("Target length: about 30 s (10-180 s allowed)");
    expect(prompt).toContain("Narration is OFF");
    expect(prompt).toContain("No brand colours given");
    expect(prompt).toContain("No images supplied");
    expect(prompt).not.toContain("Revise this film");
  });

  it("anlatımlı dikey film: renkler, görseller sırayla, düzeltme notları ve önceki film", async () => {
    const { queryFn, seen, text } = capture();
    const img = { data: new Uint8Array([1]), mimeType: "image/png" };
    await expect(
      motionDirector({ ...base, lang: "tr", tall: true, narration: true, colors: ["#2563eb"], images: [{ name: "logo.png", image: img }, { name: "shot.png", image: img }], revise: { film: FILM as never, notes: ["m1 at 0s: hook: nothing new"] } }, { queryFn }),
    ).rejects.toThrow(AgentError);
    const system = JSON.stringify(seen.params!.options);
    expect(system).toContain("vertical 9:16");
    const { text: prompt, images } = await text();
    expect(images).toBe(2);
    expect(prompt).toContain("Narration is ON: give each scene a \"narration\" sentence in tr");
    expect(prompt).toContain("Brand colours (use them; the accent must be one of them): #2563eb.");
    expect(prompt).toContain("0: logo.png\n1: shot.png");
    expect(prompt).toContain("- m1 at 0s: hook: nothing new");
    expect(prompt).toContain('"title":"R"');
  });

  it("çıktı şeması temsili veri işaretini modelden istemez ve draft-07'ye çevrilir", () => {
    expect(MotionFilmOut.safeParse(FILM).success).toBe(true);
    const schema = JSON.stringify(toOutputSchema(MotionFilmOut));
    expect(schema).not.toContain("illustrative");
    expect(schema).toContain("Rhythm sheet");
  });
});
