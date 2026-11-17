import type { QualityIssue } from "@ys/pipeline/light";
import type { EpisodeResponse } from "./types.ts";

export function qualityVersion(data: EpisodeResponse): string {
  const s = data.state;
  return [data.sourceRevision ?? data.revision, s.done.timeline, s.render?.exportId ?? s.render?.at, s.short?.exportId ?? s.short?.at, s.render?.audit?.at, s.short?.audit?.at, s.render?.styleComparison?.at, s.review?.at, s.draftReview?.at, s.voiceAudit?.at].join("|");
}

/** Short saniyesi ana zaman çizelgesine çevrilmez; ses/araştırma kimliği sahneyi belirtir. */
export function issueShot(issue: QualityIssue, data: EpisodeResponse) {
  const shots = data.state.shots ?? [];
  if (issue.source === "voice" || issue.source === "research") return shots.find(s => s.sceneId === issue.shotId);
  return shots.find(s => s.id === issue.shotId) ?? (issue.target === "main" && issue.seconds !== undefined
    ? shots.find(s => s.startMs <= issue.seconds! * 1000 && s.endMs > issue.seconds! * 1000) : undefined);
}
