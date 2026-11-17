import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { benchmarkArguments, fingerprint, verifyBenchmark, freezeBenchmark } from "../src/benchmark.ts";
import { benchmarkSupplement, BENCHMARK_SUPPLEMENT } from "../src/benchmark-supplement.ts";
import { runBenchSupplement } from "../scripts/bench-supplement.ts";
import { runBenchReview } from "../scripts/bench-review.ts";
import { readReviewPacket, benchmarkReviewHistory } from "../src/benchmark-review.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function root() { const path = await mkdtemp(join(tmpdir(), "ys-corpus-supplement-")); dirs.push(path); return path; }

describe("separate benchmark corpora", () => {
  it("selects a supplement explicitly without changing default fixture or run flags", () => {
    expect(benchmarkArguments(["run", "baseline", "--free"])).toEqual({ fixture: "fixture-v1", args: ["run", "baseline", "--free"] });
    expect(benchmarkArguments(["run", "candidate", "--free", "--fixture=fixture-e-text-v1", "--clips=4"])).toEqual({ fixture: "fixture-e-text-v1", args: ["run", "candidate", "--free", "--clips=4"] });
    for (const args of [["diff", "a", "b"], ["review", "export", "run"]]) expect(benchmarkArguments([`--fixture=${BENCHMARK_SUPPLEMENT}`, ...args])).toEqual({ fixture: BENCHMARK_SUPPLEMENT, args });
  });
  it("rejects duplicate, malformed and irrelevant fixture flags before reading or writing a corpus", () => {
    for (const flag of ["--fixture", "--fixtureElse=fixture-v1", "--fixture=../outside", "--fixture=fixture-a/b", "--fixture=fixture-A", "--fixture=", "--fixture=x"]) expect(() => benchmarkArguments(["run", "x", flag])).toThrow();
    expect(() => benchmarkArguments(["run", "x", "--fixture=fixture-v1", "--fixture=fixture-v1"])).toThrow("one");
    for (const args of [[], ["freeze"], ["pick"], ["supplement"], ["review", "import"], ["review", "report"]]) expect(() => benchmarkArguments([...args, "--fixture=fixture-e-text-v1"])).toThrow("supported");
  });
  it("defines repeatable TR/EN and landscape/portrait inputs with an explicit silent text-only scope", () => {
    const a = benchmarkSupplement(), b = benchmarkSupplement(); expect(a).toEqual(b);
    const cells = new Set<string>();
    for (const state of Object.values(a.states)) {
      cells.add(`${state.input.lang}:${state.input.width}x${state.input.height}`);
      expect(state.timeline).toMatchObject({ lang: state.input.lang, width: state.input.width, height: state.input.height, audio: [], speech: [], captions: [], durationInFrames: 240 });
      expect(state.agentCostUsd).toBe(0);
      expect(state.shots![0]!.vector!.layers[0]!.anims).toEqual([{ type: "move", toX: 1070, start: 0, end: .5 }]);
      expect(state.shots![1]!.vector!.layers[0]!.anims).toEqual([]);
      expect(state.shots![0]!.vector!.texts[0]!.text).toBe(state.input.lang === "tr" ? "Çığ ve ışık" : "Avalanche and light");
      expect(state.timeline!.visuals.every(v => v.kind === "motion_graphic" && v.vector && !v.assetUrl)).toBe(true);
    }
    expect(cells).toEqual(new Set(["tr:1920x1080", "tr:1080x1920", "en:1920x1080", "en:1080x1920"]));
    expect(new Set(a.shots.slice(0, 4).map(s => s.episode)).size).toBe(4);
    expect(a.shots).toHaveLength(8);
    for (const selected of a.shots) {
      expect(selected.provenance).toMatchObject({ kind: "synthetic", languageScope: "on-screen-text" });
      expect(selected.provenance!.coverageTargets.includes("portrait")).toBe(selected.episode.endsWith("portrait"));
    }
  });
  it("publishes a separate immutable supplement without replacing the default corpus", async () => {
    const directory = await root(), bench = join(directory, ".data", "bench"), baseline = join(bench, "fixture-v1");
    await mkdir(baseline, { recursive: true }); await writeFile(join(baseline, "sentinel"), "original corpus");
    const result = await runBenchSupplement(directory), fixture = await verifyBenchmark(result.directory);
    expect(result).toMatchObject({ shots: 8, kind: "synthetic", generationCalls: 0 });
    expect(fixture.files).toHaveLength(4);
    await expect(runBenchSupplement(directory)).rejects.toThrow();
    expect((await verifyBenchmark(result.directory)).inputHash).toBe(fixture.inputHash);
    expect(await readFile(join(baseline, "sentinel"), "utf8")).toBe("original corpus");
    const tampered = structuredClone(fixture); tampered.shots[0]!.provenance!.purpose = "different purpose";
    await writeFile(join(result.directory, "manifest.json"), JSON.stringify(tampered)); await expect(verifyBenchmark(result.directory)).rejects.toThrow("Invalid benchmark manifest");
    const invalid = { ...fixture, shots: fixture.shots.map((s) => ({ ...s, provenance: { ...s.provenance, languageScope: "verified-everything" } })) };
    invalid.inputHash = fingerprint(JSON.stringify({ shots: invalid.shots, files: invalid.files }));
    await writeFile(join(result.directory, "manifest.json"), JSON.stringify(invalid)); await expect(verifyBenchmark(result.directory)).rejects.toThrow();
  });
  it("exports supplied provenance only with a matching selected corpus and leaves old packets compatible", async () => {
    const directory = await root(), { directory: fixtureDir } = await runBenchSupplement(directory), fixture = await verifyBenchmark(fixtureDir);
    const run = join(directory, ".data", "bench", "runs", "supplement"), stills: Record<string, string> = {};
    await mkdir(run, { recursive: true });
    for (const [i, shot] of fixture.shots.entries()) { const path = join(run, `${i}.jpg`); await writeFile(path, `owned fake JPEG ${i}`); stills[`${shot.episode}/${shot.shot}`] = path; }
    await writeFile(join(run, "result.json"), JSON.stringify({ label: "supplement", at: "2026-11-17T00:00:00Z", inputHash: fixture.inputHash, sourceHash: "1".repeat(64), reviewerHash: "2".repeat(64), expected: 8, rendered: 8, reviewStatus: "skipped", stills }));
    const states = benchmarkSupplement().states, first = fixture.shots[0]!;
    await freezeBenchmark({ directory: join(directory, ".data", "bench", "fixture-v1"), shots: [{ episode: first.episode, shot: first.shot, category: "scene" }], load: async id => states[id]!, asset: async () => new Uint8Array() });
    await expect(runBenchReview(directory, ["export", "supplement"])).rejects.toThrow("matching frozen inputs");
    const output = await runBenchReview(directory, ["export", "supplement"], BENCHMARK_SUPPLEMENT) as { directory: string };
    const packet = await readReviewPacket(output.directory);
    expect(packet.items).toHaveLength(8);
    expect(packet.items.every(item => item.provenance?.languageScope === "on-screen-text")).toBe(true);
    const page = await readFile(join(output.directory, "index.html"), "utf8"); expect(page).toContain("Designed coverage targets (not reviewed)"); expect(page).toContain("synthetic");
    expect(await benchmarkReviewHistory(output.directory)).toMatchObject({ total: 8, humanItems: 0, assistantItems: 0 });
  });
});
