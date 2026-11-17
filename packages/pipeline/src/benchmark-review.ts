import { mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, relative, isAbsolute, resolve, sep, basename } from "node:path";
import { BenchmarkLabels, BenchmarkLabelRevision, BenchmarkReviewPacket, BenchmarkRunEvidence } from "@ys/core";
import { fingerprint, inside, verifyBenchmark } from "./benchmark.ts";
import type { EpisodeState } from "./state.ts";

const json = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));
const identity = (value: unknown) => fingerprint(JSON.stringify(value));
const reviewerKey = (data: BenchmarkLabels) => JSON.stringify(data.reviewer);
const revisionPath = (directory: string, id: string) => inside(directory, `annotations/${id}.json`);

// Dosya yolu ve symlink hedefi paket/ölçüm klasörünün içinde kalmalıdır.
async function localFile(directory: string, path: string) {
  const root = await realpath(directory), target = await realpath(path), rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Review media escapes its directory");
  return target;
}

const html = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function gallery(packet: BenchmarkReviewPacket) {
  const cards = packet.items.map((item) => `<article><h2>${html(item.key)}</h2><p>${html(item.category)} · ${html(item.language)} · ${html(item.styleSelection)} · ${item.width}×${item.height}</p><p>${html(item.description)}</p>${item.provenance ? `<p>Supplied provenance: ${html(item.provenance.kind)}. Language scope: ${html(item.provenance.languageScope)}.<br>Designed coverage targets (not reviewed): ${html(item.provenance.coverageTargets.join(", "))}.<br>${html(item.provenance.purpose)}</p>` : ""}<img loading="lazy" src="${item.still.path}" alt="${html(item.key)}"><p>Still SHA-256: <code>${item.still.sha256}</code></p>${item.clip ? `<video controls preload="none" src="${item.clip.path}"></video><p>Clip frames: ${item.clip.frames.join("–")} (absolute source frames)</p>` : ""}<p>Unreviewed. Record the key, evidence, verdict, tags and rationale in your worksheet.</p></article>`).join("\n");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"><title>Benchmark review — ${html(packet.runLabel)}</title><style>body{font:16px/1.5 system-ui;margin:24px auto;padding:0 20px;max-width:1200px;color:#19212a;background:#f5f6f8}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:20px}article{background:white;border:1px solid #c9ced5;padding:16px;border-radius:8px;min-width:0}img,video{width:100%;height:auto}code,h2{overflow-wrap:anywhere}h2{font-size:18px}a{color:#164b95}</style><header><h1>Benchmark review</h1><p>Media from ${html(packet.runLabel)}. No editorial scores or human labels have been supplied by this export.</p><p>Packet: <code>${packet.id}</code><br>Rendered source: <code>${packet.sourceHash}</code></p><p><a href="worksheet.json" download>Download the empty label worksheet</a>. Fill your name, role, review date and reviewed items; leave unreviewed items absent. See the benchmark runbook before importing. This gallery does not save labels or approve publishing.</p></header><main>${cards}</main></html>`;
}

export async function createReviewPacket(fixtureDirectory: string, runDirectory: string, outputRoot: string): Promise<string> {
  const fixture = await verifyBenchmark(fixtureDirectory), rawRun = await readFile(join(runDirectory, "result.json"));
  const run = BenchmarkRunEvidence.parse(JSON.parse(rawRun.toString("utf8")));
  if (run.inputHash !== fixture.inputHash || run.expected !== fixture.shots.length || run.rendered !== run.expected || Object.keys(run.stills).length !== run.expected) throw new Error("Review requires a complete run with the matching frozen inputs");
  const keys = new Set(fixture.shots.map((s) => `${s.episode}/${s.shot}`));
  if (keys.size !== fixture.shots.length || Object.keys(run.clips).some((key) => !keys.has(key))) throw new Error("Review run contains duplicate or unknown sample keys");
  const root = resolve(outputRoot), staging = inside(root, `.pending-${randomUUID()}`);
  await mkdir(root, { recursive: true }); await mkdir(staging); await mkdir(join(staging, "media")); await mkdir(join(staging, "annotations"));
  const items: BenchmarkReviewPacket["items"] = [];
  for (const [index, selected] of fixture.shots.entries()) {
    const key = `${selected.episode}/${selected.shot}`, source = run.stills[key];
    if (!source) throw new Error(`Review still missing: ${key}`);
    const state = await json(inside(fixtureDirectory, `states/${selected.episode}.json`)) as EpisodeState;
    const stillBytes = await readFile(await localFile(runDirectory, resolve(source)));
    const still = { path: `media/${index * 2}.jpg`, sha256: fingerprint(stillBytes) };
    await writeFile(inside(staging, still.path), stillBytes, { flag: "wx" });
    const item: BenchmarkReviewPacket["items"][number] = { key, category: selected.category, language: state.input.lang,
      styleSelection: state.input.stylePack ?? "auto", resolvedStyle: state.style?.artStyle ?? null,
      width: state.input.width, height: state.input.height, description: state.shots?.find((s) => s.id === selected.shot)?.description ?? "", provenance: selected.provenance, still };
    const clip = run.clips[key];
    if (clip) {
      if (clip.status !== "complete" || !clip.path || clip.frames[1] < clip.frames[0]) throw new Error(`Review clip incomplete: ${key}`);
      const bytes = await readFile(await localFile(runDirectory, resolve(clip.path)));
      item.clip = { path: `media/${index * 2 + 1}.mp4`, sha256: fingerprint(bytes), frames: clip.frames };
      await writeFile(inside(staging, item.clip.path), bytes, { flag: "wx" });
    }
    items.push(item);
  }
  const packet = BenchmarkReviewPacket.parse({ version: 1, id: "0".repeat(64), inputHash: fixture.inputHash, runHash: fingerprint(rawRun), runLabel: run.label, runAt: run.at, sourceHash: run.sourceHash, reviewerHash: run.reviewerHash, items });
  const { id: _id, ...payload } = packet; packet.id = identity(payload);
  await writeFile(join(staging, "packet.json"), JSON.stringify(packet, null, 2), { flag: "wx" });
  await writeFile(join(staging, "worksheet.json"), JSON.stringify({ version: 1, packetId: packet.id, parent: null, reviewer: { name: "", role: "human" }, reviewedAt: "", labels: [] }, null, 2), { flag: "wx" });
  await writeFile(join(staging, "index.html"), gallery(packet), { flag: "wx" });
  await verifyBenchmark(fixtureDirectory);
  if (fingerprint(await readFile(join(runDirectory, "result.json"))) !== packet.runHash) throw new Error("Benchmark result changed during review export");
  const target = inside(root, packet.id); await rename(staging, target);
  return target;
}

export async function readReviewPacket(directory: string): Promise<BenchmarkReviewPacket> {
  const packet = BenchmarkReviewPacket.parse(await json(join(directory, "packet.json")));
  const { id, ...payload } = packet;
  if (basename(resolve(directory)) !== id || identity(payload) !== id || new Set(packet.items.map((i) => i.key)).size !== packet.items.length) throw new Error("Review packet identity is invalid");
  for (const item of packet.items) for (const asset of [item.still, ...item.clip ? [item.clip] : []]) {
    const file = await localFile(directory, inside(directory, asset.path));
    if (fingerprint(await readFile(file)) !== asset.sha256) throw new Error(`Review media changed: ${asset.path}`);
  }
  return packet;
}

function validateLabels(packet: BenchmarkReviewPacket, data: BenchmarkLabels) {
  if (data.packetId !== packet.id) throw new Error("Labels belong to another review packet");
  const seen = new Set<string>();
  for (const label of data.labels) {
    const item = packet.items.find((i) => i.key === label.key);
    if (!item || seen.has(label.key) || new Set(label.tags).size !== label.tags.length) throw new Error("Labels contain unknown/duplicate samples or tags");
    seen.add(label.key);
    if (label.media === "still" && label.frames || label.media === "clip" && (!item.clip || !label.frames || label.frames[0] < item.clip.frames[0] || label.frames[1] > item.clip.frames[1] || label.frames[1] < label.frames[0])) throw new Error("Label frame evidence is outside the selected medium");
  }
}

async function readRevision(directory: string, id: string, packet: BenchmarkReviewPacket): Promise<BenchmarkLabelRevision> {
  const revision = BenchmarkLabelRevision.parse(await json(await localFile(directory, revisionPath(directory, id))));
  if (revision.id !== id || identity(revision.data) !== id) throw new Error("Label revision identity is invalid");
  validateLabels(packet, revision.data);
  return revision;
}

export async function importBenchmarkLabels(directory: string, input: unknown): Promise<BenchmarkLabelRevision> {
  const packet = await readReviewPacket(directory), data = BenchmarkLabels.parse(input);
  validateLabels(packet, data);
  if (!data.labels.length && !data.parent) throw new Error("An initial label worksheet must include a reviewed item");
  await benchmarkReviewHistory(directory);
  if (data.parent) {
    const previous = await readRevision(directory, data.parent, packet);
    if (reviewerKey(previous.data) !== reviewerKey(data)) throw new Error("A label revision must retain its reviewer identity and role");
  }
  const revision = { id: identity(data), data };
  await localFile(directory, join(directory, "annotations"));
  await writeFile(revisionPath(directory, revision.id), JSON.stringify(revision, null, 2), { flag: "wx" });
  return revision;
}

export function reviewProgress(packet: BenchmarkReviewPacket, revisions: BenchmarkLabelRevision[]) {
  const parents = new Set(revisions.map((r) => r.data.parent)), leaves = revisions.filter((r) => !parents.has(r.id));
  const human = leaves.filter((r) => r.data.reviewer.role === "human"), assistants = leaves.filter((r) => r.data.reviewer.role === "assistant");
  const humanKeys = new Set(human.flatMap((r) => r.data.labels.map((l) => l.key)));
  const assistantKeys = new Set(assistants.flatMap((r) => r.data.labels.map((l) => l.key)));
  const forks = leaves.filter((r) => leaves.filter((other) => reviewerKey(other.data) === reviewerKey(r.data)).length > 1).map((r) => r.id);
  const conflicts = packet.items.filter((item) => new Set(human.flatMap((r) => r.data.labels.filter((l) => l.key === item.key).map((l) => l.verdict))).size > 1).map((i) => i.key);
  return { packetId: packet.id, total: packet.items.length, humanItems: humanKeys.size, assistantItems: assistantKeys.size,
    pendingHumanItems: packet.items.length - humanKeys.size, forks, conflicts,
    revisions: revisions.length, leaves: leaves.map((r) => ({ id: r.id, parent: r.data.parent, reviewer: r.data.reviewer, reviewedAt: r.data.reviewedAt,
      accepted: r.data.labels.filter((l) => l.verdict === "accepted").length, defects: r.data.labels.filter((l) => l.verdict === "defect").length,
      unresolved: r.data.labels.filter((l) => l.verdict === "unresolved").length, labels: r.data.labels })) };
}

export async function benchmarkReviewHistory(directory: string) {
  const packet = await readReviewPacket(directory), revisions: BenchmarkLabelRevision[] = [];
  await localFile(directory, join(directory, "annotations"));
  for (const file of (await readdir(join(directory, "annotations"))).filter((f) => /^[a-f0-9]{64}\.json$/.test(f)).sort()) revisions.push(await readRevision(directory, file.slice(0, -5), packet));
  for (const revision of revisions) if (revision.data.parent) {
    const parent = revisions.find((r) => r.id === revision.data.parent);
    if (!parent || reviewerKey(parent.data) !== reviewerKey(revision.data)) throw new Error("Label history has a missing or mismatched parent");
  }
  return reviewProgress(packet, revisions);
}
