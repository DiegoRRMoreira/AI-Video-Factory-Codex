import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().min(1).max(260);
export const BENCHMARK_TAGS = ["narrated-action", "readable-text", "transition", "crowded", "close-framing", "archive-insert", "portrait", "intentional-hold", "style-choice"] as const;
export const BenchmarkSampleProvenance = z.object({
  kind: z.enum(["synthetic", "production"]), purpose: z.string().trim().min(1).max(1000),
  coverageTargets: z.array(z.enum(BENCHMARK_TAGS)).max(BENCHMARK_TAGS.length),
  languageScope: z.enum(["on-screen-text", "voice-and-text", "not-assessed"]),
}).strict();
export type BenchmarkSampleProvenance = z.infer<typeof BenchmarkSampleProvenance>;
const media = z.object({ path: z.string().regex(/^media\/[0-9]+\.(jpg|mp4)$/), sha256: hash }).strict();
const frames = z.tuple([z.int().nonnegative(), z.int().nonnegative()]);
export const BenchmarkReviewPacket = z.object({
  version: z.literal(1), id: hash, inputHash: hash, runHash: hash,
  runLabel: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/), runAt: z.iso.datetime(),
  sourceHash: hash, reviewerHash: hash,
  items: z.array(z.object({
    key, category: z.enum(["close", "wide", "group", "scene"]), language: z.string().min(1),
    styleSelection: z.string(), resolvedStyle: z.string().nullable(), width: z.int().positive(), height: z.int().positive(),
    description: z.string(), provenance: BenchmarkSampleProvenance.optional(), still: media,
    clip: media.extend({ frames }).strict().optional(),
  }).strict()).min(1).max(200),
}).strict();
export type BenchmarkReviewPacket = z.infer<typeof BenchmarkReviewPacket>;

export const BenchmarkLabels = z.object({
  version: z.literal(1), packetId: hash, parent: hash.nullable(),
  reviewer: z.object({ name: z.string().trim().min(1).max(120), role: z.enum(["human", "assistant"]) }).strict(),
  reviewedAt: z.iso.datetime(),
  labels: z.array(z.object({
    key, verdict: z.enum(["accepted", "defect", "unresolved"]),
    tags: z.array(z.enum(BENCHMARK_TAGS)).max(BENCHMARK_TAGS.length),
    note: z.string().trim().min(1).max(2000), media: z.enum(["still", "clip"]), frames: frames.optional(),
  }).strict()).max(200),
}).strict();
export type BenchmarkLabels = z.infer<typeof BenchmarkLabels>;
export const BenchmarkLabelRevision = z.object({ id: hash, data: BenchmarkLabels }).strict();
export type BenchmarkLabelRevision = z.infer<typeof BenchmarkLabelRevision>;

// Eski sonuçların ek alanları korunmaz; inceleme için gereken kanıt zorunludur.
export const BenchmarkRunEvidence = z.object({
  label: BenchmarkReviewPacket.shape.runLabel, at: z.iso.datetime(), inputHash: hash, sourceHash: hash, reviewerHash: hash,
  expected: z.int().positive(), rendered: z.int().positive(), reviewStatus: z.enum(["complete", "skipped"]),
  stills: z.record(z.string(), z.string()),
  clips: z.record(z.string(), z.object({ path: z.string().optional(), frames, status: z.enum(["complete", "incomplete", "failed"]) })).default({}),
});
