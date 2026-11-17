import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inside } from "../src/benchmark.ts";
import { benchmarkReviewHistory, createReviewPacket, importBenchmarkLabels } from "../src/benchmark-review.ts";

export async function runBenchReview(root: string, args: string[]): Promise<unknown> {
  const [command, id, input] = args, bench = join(root, ".data", "bench");
  if (args.length > 3) throw new Error("Too many benchmark review arguments");
  if (command === "export" && id && !input) return { directory: await createReviewPacket(join(bench, "fixture-v1"), inside(join(bench, "runs"), id), join(bench, "reviews")) };
  if (id && /^[a-f0-9]{64}$/.test(id)) {
    const packet = inside(join(bench, "reviews"), id);
    if (command === "import" && input) return importBenchmarkLabels(packet, JSON.parse(await readFile(resolve(input), "utf8")));
    if (command === "report" && !input) return benchmarkReviewHistory(packet);
  }
  throw new Error("Usage: bench review export <run-directory> | import <packet-id> <labels.json> | report <packet-id>");
}
