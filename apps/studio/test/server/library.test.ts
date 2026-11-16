import { describe, expect, it } from "vitest";
import { summarizeEpisode, STAGES, type EpisodeState } from "@ys/pipeline/light";
import { episodeStyle, filterLibrary, libraryCosts, libraryFilters, libraryHref, libraryQueue } from "../../src/lib/library.ts";

const episode = (id: string, over: Partial<EpisodeState> = {}, input: Partial<EpisodeState["input"]> = {}) => summarizeEpisode({
  id, createdAt: "2026-11-16T12:00:00Z", input: { topic: id, lang: "tr", targetSec: 60, width: 1920, height: 1080, fps: 30, tier: "economy", aiClipRatio: 0, budgetUsd: 5, ...input }, done: {}, agentCostUsd: 0, ...over,
});

describe("library discovery and recorded-state queues", () => {
  it("normalizes shareable filters, ignores ambiguous/invalid values and resets page on filter changes", () => {
    const filters = libraryFilters({ q: " Space ", series: " Science ", queue: "failed", status: "error", style: "ink", sort: "oldest", page: "99" });
    expect(filters).toEqual({ q: "Space", series: "Science", queue: "failed", status: "error", style: "ink", sort: "oldest" });
    const url = new URL(libraryHref(filters, { page: 2 }), "http://local");
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, page: "2" });
    expect(new URL(libraryHref(filters, { queue: "script" }), "http://local").searchParams.has("page")).toBe(false);
    expect(libraryHref({})).toBe("/");
    expect(libraryFilters({ q: ["x", "y"], status: "wrong", queue: "wrong", sort: "newest", series: " " })).toEqual({ q: undefined, series: undefined, style: undefined, status: undefined, queue: undefined, sort: undefined });
    expect(libraryFilters({ q: "x".repeat(600) }).q).toHaveLength(500);
  });

  it("distinguishes actual gates, active work, failures, missing records and completed exports", () => {
    const doneThrough = (last: string) => Object.fromEntries(STAGES.slice(0, STAGES.indexOf(last as typeof STAGES[number]) + 1).map(s => [s, "t"]));
    expect(libraryQueue(episode("script", { done: doneThrough("script") }))).toBe("script");
    expect(libraryQueue(episode("concept", { done: doneThrough("concept"), approvals: { script: "t" } }))).toBe("concept");
    expect(libraryQueue(episode("preview", { done: doneThrough("timeline"), approvals: { script: "t", concept: "t" } }))).toBe("preview");
    expect(libraryQueue(episode("active", { stats: { style: { startedAt: new Date().toISOString() } } }))).toBeUndefined();
    expect(libraryQueue(episode("stalled", { stats: { style: { startedAt: "2000-01-01" } } }))).toBe("failed");
    expect(libraryQueue(episode("failed", { lastError: { stage: "script", message: "failed", at: "t" } }))).toBe("failed");
    expect(libraryQueue(episode("missing", { done: doneThrough("review") }))).toBe("missing");
    expect(libraryQueue(episode("timeline", { done: { timeline: "t" } }))).toBe("missing");
    expect(libraryQueue(episode("render", { done: { render: "t" } }))).toBe("missing");
    expect(libraryQueue(episode("ready", { done: { render: "t" }, render: { at: "t", path: "file.mp4" } }))).toBe("ready");
    expect(libraryQueue(episode("old-output", { render: { at: "t", path: "file.mp4" } }))).toBeUndefined();
    expect(libraryQueue(episode("idle"))).toBeUndefined();
  });

  it("combines Turkish search, series, style, status and queue without truncating a large matching set", () => {
    const failed = { lastError: { stage: "style" as const, message: "failed", at: "t" } };
    const rows = Array.from({ length: 120 }, (_, i) => episode(`item-${String(i).padStart(3, "0")}`, failed, { topic: "İcat", series: "Bilim", stylePack: "ink" }));
    rows.push(episode("other", failed, { topic: "Other", stylePack: "different" }));
    const filters = libraryFilters({ q: "icat", series: " BİLİM ", style: "ink", status: "error", queue: "failed" });
    expect(filterLibrary(rows, filters)).toHaveLength(120);
    expect(filterLibrary(rows, filters)[0]!.id).toBe("item-119");
    expect(filterLibrary(rows, { ...filters, sort: "oldest" })[0]!.id).toBe("item-000");
    expect(filterLibrary(rows, { series: "-" }).map(e => e.id)).toEqual(["other"]);
    expect(filterLibrary(rows, { queue: "ready" })).toEqual([]);
    expect(filterLibrary(rows, { status: "running" })).toEqual([]);
    expect(filterLibrary(rows, { series: "absent" })).toEqual([]);
    expect(episodeStyle(episode("auto"))).toBe("auto");
    expect(episodeStyle(episode("resolved", { style: { pack: "resolved" } as EpisodeState["style"] }, { stylePack: "requested" }))).toBe("resolved");
  });

  it("counts billed failures, separates agents from media caps and excludes cached/orphan costs", () => {
    const entries = [
      { episodeId: "a", capability: "t2i" as const, estimateMicros: 2_000_000, failed: true },
      { episodeId: "a", capability: "llm" as const, estimateMicros: 500_000 },
      { episodeId: "a", capability: "llm" as const, estimateMicros: 8_000_000, cacheHit: true },
      { episodeId: "other", capability: "t2i" as const, estimateMicros: 9_000_000 },
    ].map(e => ({ at: "t", providerId: "provider", requestHash: "hash", cacheHit: false, ...e }));
    const costs = libraryCosts([episode("a"), episode("b")], entries);
    expect(costs.byId.get("a")).toEqual({ media: 2_000_000, agents: 500_000, total: 2_500_000 });
    expect(costs.byId.get("b")?.total).toBe(0);
    expect([costs.media, costs.agents, costs.total, costs.budget]).toEqual([2_000_000, 500_000, 2_500_000, 10]);
    expect(libraryCosts([], entries).total).toBe(0);
  });
});
