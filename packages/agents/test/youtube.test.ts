import { describe, expect, it } from "vitest";
import { AgentError, toOutputSchema, YoutubeShortsOut, youtubeAnalyst, youtubeCurator, YoutubeWindowOut, type QueryFn, type YoutubeWindowInput } from "../src/index.ts";

type Params = { prompt: string | AsyncIterable<{ message: { content: { type: string; text?: string }[] } }>; options: Record<string, unknown> };

/** Sahte Claude: istemi kaydeder, sonuçsuz biter (yalnız istem denetlenir). */
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
    const parts: { type: string; text?: string }[] = [];
    for await (const m of p) parts.push(...m.message.content);
    return { text: parts.find((c) => c.type === "text")!.text!, images: parts.filter((c) => c.type === "image").length };
  };
  return { queryFn, seen, text };
}

const img = { data: new Uint8Array([1]), mimeType: "image/jpeg" };
const base: YoutubeWindowInput = {
  lang: "tr",
  title: "Uzun Sohbet",
  fromSec: 3600,
  toSec: 3960,
  durationSec: 4000,
  sheets: [
    { image: img, cells: [{ atSec: 3605, scene: 1 }, { atSec: 3620.5, scene: 2 }] },
    { image: img, cells: [{ atSec: 3700, scene: 3 }] },
  ],
  words: [
    { text: "Selam", startMs: 3_600_000, endMs: 3_600_400 },
    { text: "dostlar", startMs: 3_600_500, endMs: 3_601_000 },
  ],
  heatmap: [{ atSec: 3610, value: 0.25 }],
  chapters: [{ fromSec: 3600, title: "Final" }],
  silences: [{ fromSec: 3700, toSec: 3702.5 }],
  shortSec: { min: 20, max: 60 },
};

describe("YouTube analisti", () => {
  it("kontakt sayfalarını sırayla gönderir; pencereyi, hücreleri, dökümü, grafiği, bölümleri ve sessizlikleri anlatır", async () => {
    const { queryFn, seen, text } = capture();
    await expect(youtubeAnalyst(base, { queryFn })).rejects.toThrow(AgentError);
    const { text: prompt, images } = await text();
    expect(images).toBe(2);
    expect(prompt).toContain('Video: "Uzun Sohbet" (1:06:40 long)\nWindow: 1:00:00 to 1:06:00 (3600.0-3960.0 s)');
    expect(prompt).toContain("Sheet 1: #1 3605.0s (scene 1), #2 3620.5s (scene 2)\nSheet 2: #1 3700.0s (scene 3)");
    expect(prompt).toContain("  [3600.0–3601.0] Selam dostlar");
    expect(prompt).toContain("Replay graph (how often viewers rewatch each moment, 0-1): 3610s=0.25");
    expect(prompt).toContain('Chapters: 3600s "Final"');
    expect(prompt).toContain("Silences: 3700.0-3702.5s");
    expect(String(seen.params!.options.systemPrompt)).toContain("Prefer 20-60 s");
    expect(String(seen.params!.options.systemPrompt)).toContain("in tr.");
  });

  it("boş döküm, grafik, bölüm ve sessizlik öyle söylenir; kısa video saatsiz", async () => {
    const { queryFn, text } = capture();
    await expect(youtubeAnalyst({ ...base, durationSec: 59, fromSec: 0, toSec: 59, words: [], heatmap: [], chapters: [], silences: [] }, { queryFn })).rejects.toThrow(AgentError);
    const { text: prompt } = await text();
    expect(prompt).toContain("(0:59 long)");
    expect(prompt).toContain("  (no speech found)");
    expect(prompt).toContain("No replay graph.\nNo chapters.\nNo long silences.");
  });

  it("çıktı şeması: enerji 1-5, puan 1-10, odak 0-1", () => {
    expect((toOutputSchema(YoutubeWindowOut) as { required: string[] }).required).toEqual(["scenes", "cuts", "moments"]);
    const moment = { fromSec: 1, toSec: 30, title: "t", hook: "h", why: "w", score: 7, focusX: 0.5, fit: "cover" };
    expect(YoutubeWindowOut.safeParse({ scenes: [], cuts: [], moments: [moment] }).success).toBe(true);
    expect(YoutubeWindowOut.safeParse({ scenes: [], cuts: [], moments: [{ ...moment, score: 11 }] }).success).toBe(false);
  });
});

describe("Short seçici", () => {
  const input = {
    lang: "tr",
    title: "Uzun Sohbet",
    durationSec: 4000,
    count: 5,
    shortSec: { min: 20, max: 60 },
    moments: [{ fromSec: 10, toSec: 40, title: "Soru", hook: "Bunu bilmiyordun", why: "tam bir soru-cevap", score: 8, focusX: 0.4, fit: "cover" as const }],
    scenes: [{ fromSec: 0, toSec: 60, summary: "Tanışma", energy: 2 }],
    cuts: [{ fromSec: 60, toSec: 75, reason: "dead_air" as const, note: "sessizlik" }],
    heatmapPeaks: [{ atSec: 25, value: 0.9 }],
  };

  it("anları, sahne günlüğünü, kesimleri ve zirveleri metin olarak verir; sayı ve süre talimatta", async () => {
    const { queryFn, seen, text } = capture();
    await expect(youtubeCurator(input, { queryFn })).rejects.toThrow(AgentError);
    const { text: prompt, images } = await text();
    expect(images).toBe(0);
    expect(prompt).toContain('- 10.0-40.0s [8/10] Soru: tam bir soru-cevap (hook "Bunu bilmiyordun", focusX 0.4, cover)');
    expect(prompt).toContain("- 0-60s (energy 2) Tanışma");
    expect(prompt).toContain("- 60.0-75.0s dead_air: sessizlik");
    expect(prompt).toContain("Replay peaks: 25s (0.90)");
    expect(String(seen.params!.options.systemPrompt)).toContain("up to 5 candidates");
    expect(String(seen.params!.options.systemPrompt)).toContain("20-60 s in total");
  });

  it("boş listeler 'none'", async () => {
    const { queryFn, text } = capture();
    await expect(youtubeCurator({ ...input, moments: [], scenes: [], cuts: [], heatmapPeaks: [] }, { queryFn })).rejects.toThrow(AgentError);
    const { text: prompt } = await text();
    expect(prompt).toContain("Moments found:\n- none\n\nScene log:\n- none\n\nStretches to cut:\n- none\n\nReplay peaks: none");
  });

  it("çıktı şeması: aday başına 1-8 parça", () => {
    const c = { title: "t", hook: "h", why: "w", score: 8, mood: "warm", segments: [{ fromSec: 1, toSec: 30, focusX: 0.5, fit: "cover" }] };
    expect(YoutubeShortsOut.safeParse({ candidates: [c] }).success).toBe(true);
    expect(YoutubeShortsOut.safeParse({ candidates: [{ ...c, segments: [] }] }).success).toBe(false);
  });
});
