import { afterEach, expect, it, vi } from "vitest";
import { panelPayload, responseRevision, selectedPanel } from "../../src/lib/episode-payload.ts";
import type { EpisodePanel, EpisodeResponse } from "../../src/lib/types.ts";
afterEach(() => vi.useRealTimers());

const data = (): EpisodeResponse => ({
  state: { id: "e1", createdAt: "today", input: { topic: "Topic", lang: "en" }, done: {}, agentCostUsd: 0,
    story: { title: "Title", beats: [{ id: "b" }] }, script: { scenes: [{ id: "s1", narration: "Narration" }] },
    shots: [{ id: "sh1", vector: { heavy: "x".repeat(100_000) }, description: "A meaningful shot" }, { id: "sh2" }],
    voice: { s1: { key: "voice", durationMs: 1000, words: [{ word: "Narration" }], text: "Narration", spoken: "Narration" } },
    activity: Array.from({ length: 20 }, (_, i) => ({ msg: String(i), level: "info", at: "now" })),
    cast: { characters: [], locations: [] }, concept: { candidates: {}, selected: {} }, review: { shots: {} },
    scriptNotes: ["Doctor note"], voiceProviderId: "voice-provider",
  } as unknown as EpisodeResponse["state"],
  job: { label: "job", status: "running", startedAt: "now", log: Array.from({ length: 20 }, (_, i) => String(i)) },
  library: [{ key: "character" }] as any, estimates: {} as EpisodeResponse["estimates"], spentUsd: 0, claudeUsd: 0,
  actual: { byStage: [], byProvider: [] }, quota: null, progress: null, status: { status: "idle" },
});
it("chooses explicit panels or the same automatic approval/activity/overview destination", () => {
  for (const panel of ["script", "concept", "shots", "activity", "costs", "overview"] as const) expect(selectedPanel(panel, { status: "idle" })).toBe(panel);
  expect(selectedPanel(null, { status: "running" })).toBe("activity");
  expect(selectedPanel(null, { status: "waiting", stage: "render" })).toBe("shots");
  expect(selectedPanel(null, { status: "waiting", stage: "voice" })).toBe("concept");
  expect(selectedPanel(null, { status: "waiting", stage: "cast" })).toBe("script");
  expect(selectedPanel("unknown", { status: "error" })).toBe("overview");
});
it("projects panels without mutating the source or transmitting unrelated shots/reviews", () => {
  const original = data(), before = JSON.stringify(original);
  for (const panel of ["overview", "script", "concept", "shots", "activity", "costs"] as const) {
    const result = panelPayload(original, panel);
    expect(result.panel).toBe(panel);
    expect(result.state.story?.beats).toEqual([]);
    expect(result.library.length).toBe(panel === "concept" ? 1 : 0);
    expect(result.job!.log.length).toBe(panel === "activity" ? 20 : 6);
    expect(result.state.activity!.length).toBe(panel === "activity" ? 20 : 6);
    expect(JSON.stringify(result)).not.toContain("x".repeat(100));
  }
  expect(JSON.stringify(original)).toBe(before);
  const script = panelPayload(original, "script");
  expect(script.state.script?.scenes[0]?.narration).toBe("Narration");
  expect(script.state.shots).toBeUndefined(); expect(script.state.review).toBeUndefined();
  const shots = panelPayload(original, "shots");
  expect(shots.state.shots).toHaveLength(2); expect(shots.state.shots![0]!.description).toBe("A meaningful shot");
  expect(shots.state.script?.scenes[0]?.narration).toBe("Narration");
  const overview = panelPayload(original, "overview");
  expect(overview.state.shots).toHaveLength(1); expect(overview.state.voice!.s1!.words).toEqual([]);
  expect(overview.state.voice!.s1!.durationMs).toBe(1000); expect(overview.state.scriptNotes).toEqual(["Doctor note"]);
});
it("handles an unproduced episode with no optional data or job", () => {
  const original = data(); original.state = { id: "empty", createdAt: "now", input: original.state.input, done: {}, agentCostUsd: 0 }; original.job = null;
  for (const panel of ["overview", "activity", "script"] as EpisodePanel[]) {
    const result = panelPayload(original, panel); expect(result.job).toBeNull(); expect(result.state.script).toBeUndefined(); expect(result.state.story).toBeUndefined();
  }
});
it("binds response revisions to source, costs, job, panel and bounded quota refresh", () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(120000);
  const revision = responseRevision("source", "costs", null, "script", true);
  expect(responseRevision("source", "costs", null, "script", true)).toBe(revision);
  expect(responseRevision("next", "costs", null, "script", true)).not.toBe(revision);
  expect(responseRevision("source", "next", null, "script", true)).not.toBe(revision);
  expect(responseRevision("source", "costs", data().job, "script", true)).not.toBe(revision);
  expect(responseRevision("source", "costs", null, "shots", true)).not.toBe(revision);
  const complete = responseRevision("source", "costs", null, "script", false);
  vi.setSystemTime(180000); expect(responseRevision("source", "costs", null, "script", true)).not.toBe(revision);
  expect(responseRevision("source", "costs", null, "script", false)).toBe(complete);
});
