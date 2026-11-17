import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenchmarkLabels, type BenchmarkLabelRevision, type BenchmarkReviewPacket, Timeline } from "@ys/core";
import { benchmarkReviewHistory, createReviewPacket, importBenchmarkLabels, readReviewPacket, reviewProgress } from "../src/benchmark-review.ts";
import { fingerprint, freezeBenchmark } from "../src/benchmark.ts";
import { runBenchReview } from "../scripts/bench-review.ts";
import { makeState } from "./pipeline-harness.ts";

const hooks = vi.hoisted(() => ({ afterWrite: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined) }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
    await actual.writeFile(...args); await hooks.afterWrite(String(args[0]));
  } };
});
const directories: string[] = [];
afterEach(async () => { hooks.afterWrite.mockReset().mockResolvedValue(undefined); for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const hash = (v: unknown) => fingerprint(JSON.stringify(v));
async function setup(withClip = true) {
  const root = await mkdtemp(join(tmpdir(), "ys-bench-review-")); directories.push(root);
  const bench = join(root, ".data/bench"), fixture = join(bench, "fixture-v1"), run = join(bench, "runs/test-run"), output = join(bench, "reviews");
  await mkdir(run, { recursive: true });
  const state = makeState({}, { input: { ...makeState().input, lang: "en", width: 640, height: 360 },
    shots: [{ id: "s1", sceneId: "s", kind: "still_motion", startMs: 0, endMs: 4000, description: "Readable <label> & \"caption\" 'choice'", imagePrompt: "", motionPrompt: "", camera: "static" }],
    timeline: Timeline.parse({ episodeId: "e", lang: "en", fps: 10, width: 640, height: 360, durationInFrames: 40, visuals: [{ shotId: "s1", kind: "still_motion", assetUrl: "image.png", fromFrame: 0, durationInFrames: 40 }], audio: [] }) });
  const frozen = await freezeBenchmark({ directory: fixture, shots: [{ episode: "e", shot: "s1", category: "wide" }], load: async () => state, asset: async () => Buffer.from("input") });
  const still = join(run, "image.jpg"), clip = join(run, "clip.mp4"); await writeFile(still, "JPEG fixture"); await writeFile(clip, "MP4 fixture");
  const result = { label: "test-run", at: "2026-11-17T00:00:00Z", inputHash: frozen.inputHash, sourceHash: "1".repeat(64), reviewerHash: "2".repeat(64), expected: 1, rendered: 1, reviewStatus: "skipped", stills: { "e/s1": still },
    clips: withClip ? { "e/s1": { path: clip, frames: [10, 30], status: "complete" } } : {} };
  const saveRun = () => writeFile(join(run, "result.json"), JSON.stringify(result)); await saveRun();
  return { root, bench, fixture, run, output, result, saveRun, state, still, clip, create: () => createReviewPacket(fixture, run, output) };
}
const label = () => ({ key: "e/s1", verdict: "defect" as const, tags: ["readable-text" as const], note: "The label overlaps the subject.", media: "still" as const });
const submission = (id: string): BenchmarkLabels => ({ version: 1, packetId: id, parent: null, reviewer: { name: "Test editor", role: "human" }, reviewedAt: "2026-11-17T01:00:00Z", labels: [label()] });
async function packetSetup(withClip = true) { const s = await setup(withClip), directory = await s.create(), packet = await readReviewPacket(directory); return { ...s, directory, packet, data: submission(packet.id) }; }

describe("benchmark human calibration", () => {
  it("counts human and assistant observations separately without inventing reviewed items", () => {
    const packet = { items: [{ key: "e/s1" }, { key: "e/s2" }, { key: "e/s3" }] } as BenchmarkReviewPacket;
    const revisions = [
      { id: "a", data: { parent: null, reviewer: { name: "Editor", role: "human" }, labels: [{ key: "e/s1", verdict: "defect" }] } },
      { id: "b", data: { parent: null, reviewer: { name: "Assistant", role: "assistant" }, labels: [{ key: "e/s2", verdict: "accepted" }] } },
    ] as BenchmarkLabelRevision[];
    expect(reviewProgress(packet, revisions)).toMatchObject({ humanItems: 1, assistantItems: 1, pendingHumanItems: 2 });
  });
});

describe("immutable benchmark review packets", () => {
  it("exports a portable gallery and empty worksheet; source edits cannot change copied evidence", async () => {
    const s = await packetSetup();
    expect(basename(s.directory)).toBe(s.packet.id);
    expect(s.packet.items[0]).toMatchObject({ language: "en", width: 640, height: 360, clip: { frames: [10, 30] } });
    const page = await readFile(join(s.directory, "index.html"), "utf8");
    expect(page).toContain("Readable &lt;label&gt; &amp; &quot;caption&quot; &#39;choice&#39;");
    expect(page).toContain('preload="none"'); expect(page).not.toContain("<script");
    const worksheet = JSON.parse(await readFile(join(s.directory, "worksheet.json"), "utf8"));
    expect(worksheet).toMatchObject({ packetId: s.packet.id, labels: [], reviewer: { name: "" } });
    expect(BenchmarkLabels.safeParse(worksheet).success).toBe(false);
    await writeFile(s.still, "new render");
    expect((await readReviewPacket(s.directory)).id).toBe(s.packet.id);
    expect(await benchmarkReviewHistory(s.directory)).toMatchObject({ humanItems: 0, pendingHumanItems: 1 });
  });
  it("handles legacy optional style, description and missing clips without inventing context", async () => {
    const s = await setup(false), path = join(s.fixture, "states/e.json");
    const state = JSON.parse(await readFile(path, "utf8")); delete state.input.stylePack; delete state.style; delete state.shots;
    const bytes = JSON.stringify(state); await writeFile(path, bytes);
    const manifest = JSON.parse(await readFile(join(s.fixture, "manifest.json"), "utf8"));
    manifest.files.find((f: { path: string }) => f.path === "states/e.json").sha256 = fingerprint(bytes);
    manifest.inputHash = hash({ shots: manifest.shots, files: manifest.files }); await writeFile(join(s.fixture, "manifest.json"), JSON.stringify(manifest));
    s.result.inputHash = manifest.inputHash; await s.saveRun();
    const packet = await readReviewPacket(await s.create());
    expect(packet.items[0]).toMatchObject({ styleSelection: "auto", resolvedStyle: null, description: "" });
    expect(packet.items[0]?.clip).toBeUndefined();
  });
  it("refuses legacy/incomplete results, mismatched inputs, missing and extra stills", async () => {
    const s = await setup(); const original = structuredClone(s.result);
    for (const change of [{ sourceHash: "" }, { inputHash: "0".repeat(64) }, { expected: 2 }, { rendered: 2 }, { stills: {} }, { stills: { x: s.still } }, { clips: { unknown: s.result.clips["e/s1"] } }]) {
      await writeFile(join(s.run, "result.json"), JSON.stringify({ ...original, ...change }));
      await expect(s.create()).rejects.toThrow();
    }
    for (const clip of [{ ...original.clips["e/s1"], status: "failed" }, { ...original.clips["e/s1"], path: undefined }, { ...original.clips["e/s1"], frames: [30, 10] }]) {
      await writeFile(join(s.run, "result.json"), JSON.stringify({ ...original, clips: { "e/s1": clip } })); await expect(s.create()).rejects.toThrow("clip incomplete");
    }
  });
  it("refuses media outside the run, including a directory/root or symlink target", async () => {
    const s = await setup(), outside = join(s.root, "outside.jpg"); await writeFile(outside, "outside");
    for (const path of [outside, s.run]) { s.result.stills["e/s1"] = path; await s.saveRun(); await expect(s.create()).rejects.toThrow("escapes"); }
    const link = join(s.run, "link.jpg"); await symlink(outside, link); s.result.stills["e/s1"] = link; await s.saveRun(); await expect(s.create()).rejects.toThrow("escapes");
  });
  it("preserves an existing packet and rejects result changes during publication", async () => {
    const s = await setup(), dir = await s.create(), original = await readFile(join(dir, "packet.json"), "utf8");
    await expect(s.create()).rejects.toThrow(); expect(await readFile(join(dir, "packet.json"), "utf8")).toBe(original);
    hooks.afterWrite.mockImplementation(async path => { if (path.endsWith("index.html")) { hooks.afterWrite.mockResolvedValue(undefined); await writeFile(join(s.run, "result.json"), "changed"); } });
    await expect(s.create()).rejects.toThrow("result changed");
  });
  it("detects packet tampering, duplicate keys and changed copied media", async () => {
    const s = await packetSetup(), path = join(s.directory, "packet.json");
    await writeFile(path, JSON.stringify({ ...s.packet, sourceHash: "9".repeat(64) })); await expect(readReviewPacket(s.directory)).rejects.toThrow("identity");
    const duplicate = { ...s.packet, items: [s.packet.items[0], s.packet.items[0]] }; const { id: _id, ...payload } = duplicate; duplicate.id = hash(payload);
    await writeFile(path, JSON.stringify(duplicate)); await expect(readReviewPacket(s.directory)).rejects.toThrow("identity");
    await writeFile(path, JSON.stringify(s.packet)); await writeFile(join(s.directory, s.packet.items[0]!.still.path), "changed"); await expect(readReviewPacket(s.directory)).rejects.toThrow("media changed");
  });
});

describe("append-only benchmark labels", () => {
  it("keeps revisions, separates roles and exposes forks/conflicts", async () => {
    const s = await packetSetup(), first = await importBenchmarkLabels(s.directory, s.data);
    await expect(importBenchmarkLabels(s.directory, s.data)).rejects.toThrow("EEXIST");
    const revised = { ...s.data, parent: first.id, reviewedAt: "2026-11-17T02:00:00Z", labels: [{ ...label(), verdict: "accepted" as const, note: "This crop is intentional." }] };
    const second = await importBenchmarkLabels(s.directory, revised);
    const third = await importBenchmarkLabels(s.directory, { ...revised, labels: [{ ...label(), verdict: "unresolved" }] });
    await importBenchmarkLabels(s.directory, { ...s.data, reviewer: { name: "Assistant", role: "assistant" } });
    const report = await benchmarkReviewHistory(s.directory);
    expect(report).toMatchObject({ revisions: 4, humanItems: 1, assistantItems: 1, pendingHumanItems: 0, conflicts: ["e/s1"] });
    expect(report.forks.sort()).toEqual([second.id, third.id].sort());
    expect(report.leaves.map(r => r.id)).not.toContain(first.id);
    expect(JSON.parse(await readFile(join(s.directory, "annotations", `${first.id}.json`), "utf8"))).toEqual(first);
    expect(report.leaves.some(r => r.unresolved === 1)).toBe(true);
  });
  it("allows a full-snapshot revision to retract the last label while preserving its history", async () => {
    const s = await packetSetup(), first = await importBenchmarkLabels(s.directory, s.data);
    await importBenchmarkLabels(s.directory, { ...s.data, parent: first.id, labels: [] });
    expect(await benchmarkReviewHistory(s.directory)).toMatchObject({ revisions: 2, humanItems: 0, pendingHumanItems: 1 });
    expect(await readFile(join(s.directory, "annotations", `${first.id}.json`), "utf8")).toContain(first.id);
  });
  it("validates reviewer/date/notes and rejects malformed, wrong-packet and duplicate labels", async () => {
    const s = await packetSetup();
    for (const change of [{ reviewer: { name: "", role: "human" } }, { reviewer: { name: "x", role: "machine" } }, { reviewedAt: "yesterday" }, { labels: [] }, { labels: [{ ...label(), note: " " }] }, { packetId: "0".repeat(64) }, { labels: [{ ...label(), key: "other" }] }, { labels: [label(), label()] }, { labels: [{ ...label(), tags: ["readable-text", "readable-text"] }] }]) await expect(importBenchmarkLabels(s.directory, { ...s.data, ...change })).rejects.toThrow();
    expect(await benchmarkReviewHistory(s.directory)).toMatchObject({ revisions: 0, humanItems: 0 });
  });
  it("requires clip evidence within the frozen absolute-frame interval", async () => {
    const s = await packetSetup();
    for (const item of [{ ...label(), frames: [10, 15] }, { ...label(), media: "clip" }, { ...label(), media: "clip", frames: [9, 15] }, { ...label(), media: "clip", frames: [10, 31] }, { ...label(), media: "clip", frames: [20, 10] }]) await expect(importBenchmarkLabels(s.directory, { ...s.data, labels: [item] })).rejects.toThrow("frame evidence");
    await importBenchmarkLabels(s.directory, { ...s.data, labels: [{ ...label(), media: "clip", frames: [10, 30] }] });
    const noClip = await packetSetup(false); await expect(importBenchmarkLabels(noClip.directory, { ...noClip.data, labels: [{ ...label(), media: "clip", frames: [10, 20] }] })).rejects.toThrow("frame evidence");
  });
  it("does not inherit another reviewer or assistant's parent revision", async () => {
    const s = await packetSetup(), first = await importBenchmarkLabels(s.directory, s.data);
    for (const reviewer of [{ name: "Other", role: "human" }, { name: "Test editor", role: "assistant" }]) await expect(importBenchmarkLabels(s.directory, { ...s.data, parent: first.id, reviewer })).rejects.toThrow("reviewer identity");
    await expect(importBenchmarkLabels(s.directory, { ...s.data, parent: "0".repeat(64) })).rejects.toThrow("ENOENT");
  });
  it("detects edited revisions and missing/mismatched history parents rather than hiding them", async () => {
    const s = await packetSetup(), first = await importBenchmarkLabels(s.directory, s.data), file = join(s.directory, "annotations", `${first.id}.json`);
    await writeFile(file, JSON.stringify({ ...first, id: "0".repeat(64) })); await expect(benchmarkReviewHistory(s.directory)).rejects.toThrow("revision identity");
    await writeFile(file, JSON.stringify({ ...first, data: { ...first.data, reviewedAt: "2026-11-17T03:00:00Z" } })); await expect(benchmarkReviewHistory(s.directory)).rejects.toThrow("revision identity");
    await writeFile(file, JSON.stringify(first)); await importBenchmarkLabels(s.directory, { ...s.data, parent: first.id, reviewedAt: "2026-11-17T02:00:00Z" });
    await unlink(file); await expect(benchmarkReviewHistory(s.directory)).rejects.toThrow("missing or mismatched parent");
    const foreign = { ...first, data: { ...first.data, reviewer: { name: "Foreign", role: "human" as const }, parent: first.id } }; foreign.id = hash(foreign.data);
    await writeFile(file, JSON.stringify(first));
    await writeFile(join(s.directory, "annotations", `${foreign.id}.json`), JSON.stringify(foreign)); await expect(benchmarkReviewHistory(s.directory)).rejects.toThrow("missing or mismatched parent");
  });
  it("will not publish label files through a replaced annotation directory", async () => {
    const s = await packetSetup(), outside = join(s.root, "outside"); await mkdir(outside);
    await rm(join(s.directory, "annotations"), { recursive: true }); await symlink(outside, join(s.directory, "annotations"), "junction");
    await expect(importBenchmarkLabels(s.directory, s.data)).rejects.toThrow("escapes"); expect(await readdir(outside)).toEqual([]);
  });
  it("wires export, report and import commands without production or critic calls", async () => {
    const s = await setup(); const exported = await runBenchReview(s.root, ["export", "test-run"]) as { directory: string };
    const id = basename(exported.directory); expect(await runBenchReview(s.root, ["report", id])).toMatchObject({ total: 1, humanItems: 0 });
    const labels = join(s.root, "labels.json"); await writeFile(labels, JSON.stringify(submission(id)));
    expect(await runBenchReview(s.root, ["import", id, labels])).toMatchObject({ data: { packetId: id } });
    for (const args of [[], ["export"], ["export", "../bad"], ["report", "bad"], ["report", id, "extra"], ["import", id], ["report", id, "", "extra"]]) await expect(runBenchReview(s.root, args)).rejects.toThrow();
  });
});
