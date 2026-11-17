import { expect, it } from "vitest";
import { issueShot, qualityVersion } from "../../src/lib/review.ts";
import type { EpisodeResponse } from "../../src/lib/types.ts";
import type { QualityIssue } from "@ys/pipeline/light";
const data = { state: { done: {}, shots: [{ id: "a", sceneId: "s1", startMs: 0, endMs: 5000 }, { id: "b", sceneId: "s2", startMs: 5000, endMs: 10000 }] } } as EpisodeResponse;
const issue = { target: "main", source: "audit", seconds: 6 } as QualityIssue;
it("resolves explicit shots and authoring scenes without applying Short time to the main timeline", () => {
  expect(issueShot(issue, data)?.id).toBe("b");
  expect(issueShot({ ...issue, shotId: "a" }, data)?.id).toBe("a");
  expect(issueShot({ ...issue, target: "short", shotId: "unknown" }, data)).toBeUndefined();
  expect(issueShot({ ...issue, source: "research", shotId: "s1" }, data)?.id).toBe("a");
  expect(issueShot({ ...issue, source: "voice", shotId: "absent" }, data)).toBeUndefined();
  expect(issueShot({ ...issue, seconds: undefined }, data)).toBeUndefined();
  expect(issueShot({ ...issue, seconds: 20 }, data)).toBeUndefined();
  expect(issueShot(issue, { ...data, state: { ...data.state, shots: undefined } })).toBeUndefined();
});
it("invalidates findings for source/preview changes while retaining cache identity for cost-only changes", () => {
  const a = { ...data, sourceRevision: "source", revision: "cost-a" };
  expect(qualityVersion(a)).toBe(qualityVersion({ ...a, revision: "cost-b" }));
  expect(qualityVersion(a)).not.toBe(qualityVersion({ ...a, sourceRevision: "other" }));
  expect(qualityVersion(a)).not.toBe(qualityVersion({ ...a, state: { ...a.state, done: { timeline: "new" } } }));
  expect(qualityVersion({ ...data, revision: "legacy" })).not.toBe(qualityVersion(data));
});
