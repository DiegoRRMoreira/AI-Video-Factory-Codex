import { join } from "node:path";
import { freezeBenchmark } from "../src/benchmark.ts";
import { benchmarkSupplement, BENCHMARK_SUPPLEMENT } from "../src/benchmark-supplement.ts";

export async function runBenchSupplement(root: string) {
  const { states, shots } = benchmarkSupplement();
  const directory = join(root, ".data", "bench", BENCHMARK_SUPPLEMENT);
  const fixture = await freezeBenchmark({ directory, shots, load: async id => states[id]!, asset: async () => { throw new Error("Inline synthetic fixture must not request external media"); } });
  return { directory, inputHash: fixture.inputHash, shots: shots.length, kind: "synthetic", languageScope: "on-screen-text", generationCalls: 0 };
}
