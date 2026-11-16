// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { nextWork } from "../../src/app/episodes/[id]/parts.tsx";
import { makeData, makeState } from "./fixtures.tsx";
import { STAGES } from "@ys/pipeline/light";

it("previews only work through the next actual approval gate, without charging completed stages", () => {
  const data = makeData(makeState({ done: { script: "t" } }), { status: { status: "waiting", stage: "cast" } });
  expect(nextWork(data).stages).toEqual(["cast", "concept"]);
  expect(nextWork(data).usd).toBe(0.5);
  expect(nextWork(data).seconds).toBe(90);
  expect(nextWork(data).local).toBe(false);
  data.status = { status: "error", stage: "voice" };
  expect(nextWork(data).stages).toEqual([]);
  data.state.approvals = { concept: "t" };
  expect(nextWork(data).stages).toEqual(["voice", "shots", "keyframes", "clips", "timeline"]);
  data.status = { status: "waiting", stage: "render" };
  expect(nextWork(data).stages).toEqual(["render", "package", "short", "review"]);
  data.state.done = { ...data.state.done, package: "t", review: "t" };
  expect(nextWork(data).local).toBe(true);
});

it("retains explicit preview approval for failed draft checks even on automatic episodes", () => {
  const data = makeData(makeState({}, { autoApprove: true }), { status: { status: "idle", stage: "timeline" }, counts: { shots: 1, claims: 0, activity: 0, draftBelow: 1 } });
  expect(nextWork(data).stages).toEqual(["timeline"]);
  data.state.approvals = { preview: "t" };
  expect(nextWork(data).stages).toEqual(["timeline", "render", "package", "short", "review"]);
  data.state.done = Object.fromEntries(STAGES.map(s => [s, "t"]));
  data.status = { status: "done" };
  expect(nextWork(data).stages).toEqual([]);
  data.state.done = {};
  expect(nextWork(data).stages[0]).toBe("style");
});
