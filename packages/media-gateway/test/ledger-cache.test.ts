import { mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JsonlLedger, type CostEntry } from "../src/ledger.ts";
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, readFile: vi.fn(real.readFile), stat: vi.fn(real.stat) };
});

let dir: string, path: string, ledger: JsonlLedger;
beforeEach(() => { vi.clearAllMocks(); dir = mkdtempSync(join(tmpdir(), "ys-ledger-cache-")); path = join(dir, "ledger.jsonl"); ledger = new JsonlLedger(path); });
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
const entry: CostEntry = { at: "2026-11-16T12:00:00Z", episodeId: "e1", providerId: "local", capability: "t2i", estimateMicros: 123, cacheHit: false, requestHash: "request" };

it("caches unchanged bytes and isolates returned entries from caller mutation", async () => {
  await ledger.record(entry);
  const read = vi.mocked(fs.readFile);
  const first = await ledger.all(); first[0]!.estimateMicros = 999; first.push(entry);
  expect(await ledger.all()).toEqual([entry]); expect(read).toHaveBeenCalledTimes(1);
  const snapshot = await ledger.snapshot(); expect(snapshot.revision).toBe(await ledger.revision()); expect(snapshot.entries).toEqual([entry]);
  await new JsonlLedger(path).record({ ...entry, episodeId: "e2" });
  expect(await ledger.all()).toHaveLength(2); expect(read).toHaveBeenCalledTimes(2);
  await fs.writeFile(path, `${JSON.stringify({ ...entry, estimateMicros: 321 })}\n`);
  expect((await ledger.all())[0]!.estimateMicros).toBe(321);
  await fs.rm(path); expect(await ledger.all()).toEqual([]); expect(await ledger.revision()).toBe("missing");
});

it("coalesces simultaneous cold readers", async () => {
  await ledger.record(entry);
  const read = vi.mocked(fs.readFile);
  const result = await Promise.all(Array.from({ length: 8 }, () => ledger.all()));
  expect(result.every(x => x.length === 1)).toBe(true); expect(read).toHaveBeenCalledTimes(1);
});

it("retries a changed file version before caching and bounds continuous changes", async () => {
  await ledger.record(entry);
  vi.spyOn(ledger, "revision").mockResolvedValueOnce("initial").mockResolvedValueOnce("before").mockResolvedValueOnce("after").mockResolvedValue("stable");
  expect(await ledger.all()).toEqual([entry]);
  vi.restoreAllMocks();
  let serial = 0; vi.spyOn(ledger, "revision").mockImplementation(async () => String(serial++));
  await expect(ledger.all()).rejects.toMatchObject({ text: { key: "err.ledger.changed" } });
});

it("does not hide invalid JSON, read errors or metadata errors behind an earlier cache", async () => {
  await ledger.record(entry); await ledger.all();
  await fs.writeFile(path, "invalid-json\n");
  await expect(ledger.all()).rejects.toThrow();
  await expect(new JsonlLedger(dir).all()).rejects.toMatchObject({ code: "EISDIR" });
  vi.mocked(fs.stat).mockRejectedValueOnce(Object.assign(new Error("metadata denied"), { code: "EACCES" }));
  await expect(ledger.revision()).rejects.toMatchObject({ code: "EACCES" });
});

it("snapshot revision remains available to adapters that override all", async () => {
  vi.spyOn(ledger, "all").mockResolvedValue([entry]);
  expect((await ledger.snapshot()).revision).toMatch(/^[a-f0-9]{64}$/);
});

it("binds a snapshot revision to its returned entries even when another reader advances the cache", async () => {
  await ledger.record(entry); const oldRevision = await ledger.revision();
  const original = ledger.all.bind(ledger);
  vi.spyOn(ledger, "all").mockImplementationOnce(async () => {
    const oldEntries = await original();
    await ledger.record({ ...entry, episodeId: "e2" }); await original();
    return oldEntries;
  });
  const snapshot = await ledger.snapshot();
  expect(snapshot.entries).toEqual([entry]); expect(snapshot.revision).toBe(oldRevision);
  expect(snapshot.revision).not.toBe(await ledger.revision());
});
