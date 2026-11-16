import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import { EpisodeRepo, episodeRevision, querySummaries, readEpisodeSummary, saveEpisodeSnapshot, summarizeEpisode, summaryKey, summaryProgress, summaryStatus, type EpisodeState } from "../src/light.ts";

let root: string, store: FsAssetStore, repo: EpisodeRepo;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ys-summary-")); store = new FsAssetStore(root); repo = new EpisodeRepo(store); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
const state = (id = "e1", over: Partial<EpisodeState> = {}): EpisodeState => ({
  id, createdAt: "2026-11-16T12:00:00Z", input: { topic: "Example", lang: "en", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 2, width: 1920, height: 1080, fps: 30 }, done: {}, agentCostUsd: 0, ...over,
});
const source = (id = "e1") => `episodes/${id}/state.json`;

describe("rebuildable episode summaries", () => {
  it("recomputes elapsed progress while preserving unstarted, completed and legacy counts", () => {
    const base = summarizeEpisode(state());
    expect(summaryProgress(base)).toBeUndefined();
    const progress = { stage: "render" as const, label: { key: "cost.stage.render" as const }, done: 25, total: 100, etaSec: 999 };
    const live = { ...base, progress, progressStartedAt: "2026-11-16T12:00:00Z" };
    const now = Date.parse("2026-11-16T12:00:10Z");
    expect(summaryProgress(live, now)?.etaSec).toBe(30);
    expect(summaryProgress({ ...live, progress: { ...progress, done: 0 } }, now)?.etaSec).toBeUndefined();
    expect(summaryProgress({ ...live, progress: { ...progress, done: 100 } }, now)?.etaSec).toBeUndefined();
    expect(summaryProgress({ ...base, progress })).toEqual(progress);
    expect(live.progress.etaSec).toBe(999);
  });
  it("keeps state byte-compatible and reads warm summaries without loading large source bodies", async () => {
    const s = state("e1", { timeline: { vectorAssets: { large: { svg: "x".repeat(256_000) } } } as unknown as EpisodeState["timeline"] });
    const before = JSON.stringify(s);
    await repo.save(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(new TextDecoder().decode((await store.get(source()))!)).toBe(before);
    const read = vi.spyOn(store, "get");
    expect((await repo.summary("e1")).revision).toBe(episodeRevision(s));
    expect((await repo.summaries()).episodes).toHaveLength(1);
    expect(read.mock.calls.some(([key]) => key === source())).toBe(false);
    expect(JSON.stringify(await repo.summary("e1")).length).toBeLessThan(25 * 1024);
    expect((await repo.load("e1")).timeline).toEqual(s.timeline);
  });

  it("repairs missing, invalid, mismatched and corrupted manifests from the unchanged source", async () => {
    const s = state(); await putJson(store, source(), s);
    for (const bad of [null, "broken", "null", JSON.stringify({ version: 9 }), JSON.stringify({ version: 1, summary: { id: "wrong" } })]) {
      if (bad === null) await store.delete(summaryKey("e1")); else await store.put(summaryKey("e1"), new TextEncoder().encode(bad));
      expect((await repo.summary("e1")).revision).toBe(episodeRevision(s));
    }
    const valid = await getJson<any>(store, summaryKey("e1"));
    valid.summary.input.topic = "Changed only the cached data";
    await putJson(store, summaryKey("e1"), valid);
    expect((await repo.summary("e1")).input.topic).toBe("Example");
    valid.summary.id = "other"; await putJson(store, summaryKey("e1"), valid);
    expect((await repo.summary("e1")).id).toBe("e1");
    valid.summary.id = "e1"; valid.summary.version = 9; await putJson(store, summaryKey("e1"), valid);
    expect((await repo.summary("e1")).version).toBe(1);
    valid.summary.version = 1; valid.summary.revision = "invalid"; await putJson(store, summaryKey("e1"), valid);
    expect((await repo.summary("e1")).revision).toBe(episodeRevision(s));
    expect(await repo.load("e1")).toEqual(s);
  });

  it("detects external edits, survives a new repo instance, and never retains a deleted source", async () => {
    await repo.save(state());
    const edited = state("e1", { input: { ...state().input, topic: "External edit" } });
    await putJson(store, source(), edited);
    expect((await new EpisodeRepo(new FsAssetStore(root)).summary("e1")).input.topic).toBe("External edit");
    await store.delete(source());
    await expect(repo.summary("e1")).rejects.toThrow("e1");
    expect((await repo.summaries()).episodes).toHaveLength(0);
  });

  it("discloses unreadable sources and unfinished writes; explicit rebuild restores the index only", async () => {
    const old = state(); await repo.save(old);
    await putJson(store, summaryKey("e1"), { version: 1, pending: "unfinished-next-save" });
    await store.put(source("broken"), new TextEncoder().encode("{broken"));
    const list = await repo.summaries();
    expect(list.episodes.map(e => e.id)).toEqual(["e1"]);
    expect(list.notices).toEqual(expect.arrayContaining([{ id: "e1", reason: "pending" }, { id: "broken", reason: "unreadable" }]));
    expect((await repo.summaries(true)).notices).toEqual([{ id: "broken", reason: "unreadable" }]);
    expect(await repo.load("e1")).toEqual(old);
    expect((await readEpisodeSummary(store, "e1")).pending).toBe(false);
  });

  it("recovers a crash after state publication but before summary publication", async () => {
    const s = state();
    await putJson(store, summaryKey("e1"), { version: 1, pending: episodeRevision(s) });
    await putJson(store, source(), s);
    expect((await readEpisodeSummary(store, "e1")).pending).toBe(false);
    const read = vi.spyOn(store, "get");
    await repo.summary("e1");
    expect(read.mock.calls.some(([key]) => key === source())).toBe(false);
  });

  it("a failed source write leaves the previous source intact and visibly pending", async () => {
    await repo.save(state());
    const put = store.putVersioned.bind(store);
    vi.spyOn(store, "putVersioned").mockImplementation(async (key, bytes) => {
      if (key === source()) throw new Error("injected write failure");
      return put(key, bytes);
    });
    await expect(repo.save(state("e1", { agentCostUsd: 4 }))).rejects.toThrow("injected");
    expect((await repo.load("e1")).agentCostUsd).toBe(0);
    expect((await readEpisodeSummary(store, "e1")).pending).toBe(true);
  });

  it("does not publish an older repair after a newer producer save completes", async () => {
    await putJson(store, source(), state());
    const get = store.get.bind(store);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { started = r; });
    let once = true;
    vi.spyOn(store, "get").mockImplementation(async key => {
      const bytes = await get(key);
      if (key === source() && once) { once = false; started(); await gate; }
      return bytes;
    });
    const reading = repo.summary("e1"); await ready;
    const newer = state("e1", { agentCostUsd: 5 }); await repo.save(newer);
    release();
    expect((await reading).revision).toBe(episodeRevision(newer));
    expect((await repo.summary("e1")).revision).toBe(episodeRevision(newer));
    expect(await repo.load("e1")).toEqual(newer);
  });

  it("retries a lost publication CAS without overwriting the winner", async () => {
    await putJson(store, source(), state());
    const cas = store.compareAndSwap.bind(store); let once = true;
    vi.spyOn(store, "compareAndSwap").mockImplementation(async (key, expected, bytes) => {
      if (key === summaryKey("e1") && once) { once = false; await repo.save(state("e1", { agentCostUsd: 8 })); }
      return cas(key, expected, bytes);
    });
    expect((await repo.summary("e1")).revision).toBe(episodeRevision(state("e1", { agentCostUsd: 8 })));
  });

  it("bounds repair retries and propagates source metadata/identity errors", async () => {
    await putJson(store, source(), state());
    vi.spyOn(store, "compareAndSwap").mockResolvedValue(false);
    await expect(repo.summary("e1")).rejects.toMatchObject({ text: { key: "err.summary.changed" } });
    vi.restoreAllMocks();
    vi.spyOn(store, "version").mockRejectedValueOnce(new Error("metadata denied"));
    await expect(repo.summary("e1")).rejects.toThrow("metadata denied");
    await putJson(store, source(), state("wrong"));
    await expect(repo.summary("e1")).rejects.toMatchObject({ text: { key: "err.summary.identity" } });
  });

  it("supports stores without version/CAS capabilities by using authoritative reads", async () => {
    const simple: AssetStore = { put: store.put.bind(store), get: store.get.bind(store), list: store.list.bind(store), delete: store.delete.bind(store) };
    await saveEpisodeSnapshot(simple, state());
    expect((await readEpisodeSummary(simple, "e1")).summary.revision).toBe(episodeRevision(state()));
    expect(await store.get(summaryKey("e1"))).toBeNull();
    simple.version = store.version.bind(store);
    expect((await readEpisodeSummary(simple, "e1")).summary.id).toBe("e1");
    simple.compareAndSwap = store.compareAndSwap.bind(store);
    await saveEpisodeSnapshot(simple, state("e2"));
    expect((await readEpisodeSummary(simple, "e2")).summary.id).toBe("e2");
    await expect(readEpisodeSummary(simple, "missing")).rejects.toThrow("missing");
    delete simple.version;
    await expect(readEpisodeSummary(simple, "missing")).rejects.toThrow("missing");
  });

  it("does not serve an orphan index when the source disappears during publication", async () => {
    const put = store.putVersioned.bind(store);
    vi.spyOn(store, "putVersioned").mockImplementation(async (key, bytes) => {
      const revision = await put(key, bytes); await store.delete(key); return revision;
    });
    await repo.save(state());
    await expect(repo.summary("e1")).rejects.toThrow("e1");
  });

  it("never stamps an older summary with a concurrent writer's source identity", async () => {
    const data = new Map<string, Uint8Array>(), versions = new Map<string, string>(); let serial = 0, sourceWrites = 0;
    let startB!: () => void, releaseB!: () => void, startA!: () => void, releaseA!: () => void;
    const bReady = new Promise<void>(r => { startB = r; }), bGo = new Promise<void>(r => { releaseB = r; });
    const aReady = new Promise<void>(r => { startA = r; }), aGo = new Promise<void>(r => { releaseA = r; });
    const write = async (key: string, bytes: Uint8Array) => {
      const number = key === source() ? ++sourceWrites : 0;
      if (number === 1) { startB(); await bGo; }
      const revision = String(++serial); data.set(key, bytes); versions.set(key, revision);
      if (number === 2) { startA(); await aGo; }
      return revision;
    };
    const racing: AssetStore & { putVersioned(key: string, bytes: Uint8Array, contentType: string): Promise<string> } = {
      put: async (key, bytes) => { await write(key, bytes); return key; }, putVersioned: (key, bytes) => write(key, bytes),
      get: async key => data.get(key) ?? null, version: async key => versions.get(key) ?? null,
      list: async prefix => [...data.keys()].filter(k => k.startsWith(prefix)), delete: async key => { data.delete(key); },
      compareAndSwap: async (key, expected, bytes) => {
        const actual = data.get(key) ?? null;
        if (actual === null ? expected !== null : expected === null || !Buffer.from(actual).equals(expected)) return false;
        await write(key, bytes); return true;
      },
    };
    const bState = state("e1", { agentCostUsd: 2 }), aState = state("e1", { agentCostUsd: 1 });
    const b = saveEpisodeSnapshot(racing, bState); await bReady;
    const a = saveEpisodeSnapshot(racing, aState); await aReady;
    releaseB(); await b; releaseA(); await a;
    expect(JSON.parse(new TextDecoder().decode(data.get(source())!)).agentCostUsd).toBe(2);
    expect((await readEpisodeSummary(racing, "e1")).summary.revision).toBe(episodeRevision(bState));
  });

  it("keeps input, title and thumbnail sizes bounded and reports counts/status", async () => {
    const s = state("e1", { input: { ...state().input, topic: "x".repeat(200_000), series: "s".repeat(300), voiceId: "v".repeat(800), stylePack: "p".repeat(300), customStyleId: "c".repeat(300) },
      story: { title: "t".repeat(3000) } as EpisodeState["story"], style: { pack: "p".repeat(200) } as EpisodeState["style"],
      shots: [{ id: "sh" }] as EpisodeState["shots"], keyframes: { sh: { key: "k".repeat(2000), mimeType: "image/png" } },
      render: { path: "local", at: "render", exportId: "export", research: { claims: 3 } as any }, voice: { s: { durationMs: 1200 } as any },
      activity: [{ at: "now", level: "info", msg: "large" }], waitingFor: "preview", done: { render: "done", unknown: "ignored" } as any });
    const row = summarizeEpisode(s);
    expect(row.input.topic).toHaveLength(500); expect(row.title).toHaveLength(300); expect(row.thumbnail).toHaveLength(1000);
    expect(row.counts).toMatchObject({ shots: 1, activity: 1, claims: 3 }); expect(row.voiceSec).toBe(1.2);
    expect(row.done).not.toHaveProperty("unknown"); expect(row.render?.exportId).toBe("export");
    expect(JSON.stringify(row).length).toBeLessThan(25 * 1024);
    expect(summarizeEpisode(state("e2", { concept: { candidates: {}, selected: { c: { key: "concept", mimeType: "image/png" } } } })).thumbnail).toBe("concept");
    const now = Date.now(), running = summarizeEpisode(state("e3", { stats: { style: { startedAt: new Date(now).toISOString() } } }));
    expect(summaryStatus(running, now).status).toBe("running"); expect(summaryStatus(running, now + 16 * 60_000).status).toBe("stalled");
    expect(summaryStatus({ ...running, heartbeatAt: undefined, createdAt: new Date(now).toISOString() }, now).status).toBe("running");
  });

  it("paginates and filters with stable ordering, series folding, status and bounded page sizes", () => {
    const episodes = ["b", "a", "c"].map(id => summarizeEpisode(state(id, { input: { ...state().input, topic: id === "c" ? "Another" : "İstanbul", series: id === "c" ? undefined : " Test  Series " } })));
    expect(querySummaries({ episodes, notices: [] }).episodes.map(e => e.id)).toEqual(["c", "b", "a"]);
    expect(querySummaries({ episodes, notices: [] }, { q: "istanbul", series: "test series", sort: "oldest", limit: 1 }).episodes.map(e => e.id)).toEqual(["a"]);
    expect(querySummaries({ episodes, notices: [] }, { series: "-", status: "idle", offset: -1, limit: 500 }).total).toBe(1);
    expect(querySummaries({ episodes, notices: [] }, { status: "done", limit: 0 }).episodes).toEqual([]);
  });
});
