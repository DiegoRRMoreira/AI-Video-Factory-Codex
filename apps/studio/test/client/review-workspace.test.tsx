// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import type { QualityIssue, PlannedShotState } from "@ys/pipeline/light";
import type { EpisodeResponse } from "../../src/lib/types.ts";
import { en, json, makeData, makeState, okAct, renderIn } from "./fixtures.tsx";
const player = vi.hoisted(() => ({ seek: vi.fn(), pause: vi.fn(), play: vi.fn(), add: vi.fn(), remove: vi.fn(), props: [] as Record<string, unknown>[] }));
vi.mock("@remotion/player", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return { Player: forwardRef((props: Record<string, unknown>, ref) => {
    useImperativeHandle(ref, () => ({ seekTo: player.seek, pause: player.pause, play: player.play, addEventListener: player.add, removeEventListener: player.remove }));
    player.props.push(props); return <div data-testid="preview-player" />;
  }) };
});
vi.mock("@ys/video", () => ({ Episode: () => null }));
vi.mock("next/dynamic", async () => { const { default: Component } = await import("../../src/app/episodes/[id]/timeline-player.tsx"); return { default: () => Component }; });
const { ShotsTab } = await import("../../src/app/episodes/[id]/steps.tsx");
const { ReviewWorkspace } = await import("../../src/app/episodes/[id]/review-workspace.tsx");
const { LocaleProvider } = await import("../../src/app/locale-provider.tsx");
const { default: Preview } = await import("../../src/app/episodes/[id]/timeline-player.tsx");
const { EpisodeView } = await import("../../src/app/episodes/[id]/episode-view.tsx");
const { panelPayload } = await import("../../src/lib/episode-payload.ts");
const scene = (id: string) => ({ id, beatId: "b", narration: "Narration for " + id, visualIntent: "", location: "room", emotion: "calm" });
const data = (): EpisodeResponse => makeData(makeState({ done: { timeline: "t", render: "t" }, script: { scenes: [scene("s1"), scene("s2")] },
  shots: [{ id: "sh1", sceneId: "s1", startMs: 0, endMs: 5000, description: "First shot", camera: "static" }, { id: "sh2", sceneId: "s2", startMs: 5000, endMs: 10000, description: "Second shot", camera: "static" }] as PlannedShotState[],
  render: { path: "main.mp4", at: "main-at", exportId: "main-v1" }, short: { path: "short.mp4", title: "Short", scenes: ["s2"], sec: 5, at: "short-at", exportId: "short-v1" },
}, { motionMode: "vector" }), { outputVersions: { main: "main-v1", short: "short-v1" } });
const issues = (): QualityIssue[] => [
  { key: "main-issue", source: "audit", target: "main", kind: "freeze", detail: "Main finding", shotId: "sh1", seconds: 3, exportId: "main-v1", evidence: "main.json", status: "open" },
  { key: "short-issue", source: "audit", target: "short", kind: "audio_gap", detail: "Short finding", shotId: "sh2", seconds: 2, exportId: "short-v1", evidence: "short.json", status: "fix-needed" },
];
let rows: QualityIssue[], posts: Record<string, unknown>[], fetcher: Mock<(url: string, options?: RequestInit) => Promise<Response>>;
beforeEach(() => {
  rows = issues(); posts = []; player.props.length = 0; for (const f of [player.seek, player.pause, player.play, player.add, player.remove]) f.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  fetcher = vi.fn(async (url: string, opts?: RequestInit) => {
    if (opts?.method === "POST") { posts.push(JSON.parse(String(opts.body))); return json({ ok: true }); }
    if (url.includes("/timeline")) return json({ episodeId: "e", fps: 30, width: 1920, height: 1080, durationInFrames: 300, visuals: [{ shotId: "sh1", fromFrame: 0 }, { shotId: "sh2", fromFrame: 150 }], audio: [], captions: [] });
    expect(url).toContain("/quality"); return json({ issues: rows, total: rows.length, notices: [], historicalDecisions: 0 });
  }); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const open = async () => { fireEvent.click(screen.getByRole("button", { name: en("quality.title") })); await screen.findAllByRole("button", { name: en("workspace.inspectIssue") }); };
const inspect = async (index: number) => { await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: en("workspace.inspectIssue") })[index]!); }); };

it("preserves the actual workspace across tabs and opens research/voice at the correct script scene", async () => {
  window.location.hash = "";
  const initial = data(), other = fetcher.getMockImplementation()!;
  rows.push({ ...issues()[0]!, key: "voice", source: "voice", target: "plan", shotId: "s2", seconds: undefined, exportId: undefined }, { ...issues()[0]!, key: "research", source: "research", target: "plan", shotId: "s1", seconds: undefined, exportId: undefined });
  fetcher.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url === `/api/episodes/${initial.state.id}`) {
      const panel = (opts?.headers as Record<string, string>)["x-ys-panel"];
      return json(panelPayload({ ...initial, revision: panel, sourceRevision: "source" }, panel === "auto" ? "overview" : panel as "shots"));
    }
    return other(url, opts);
  });
  renderIn(<EpisodeView id={initial.state.id} />, "en"); await screen.findByRole("tablist");
  await open(); await inspect(0);
  const video = await screen.findByLabelText(en("quality.target.main"));
  const workspace = screen.getByRole("region", { name: en("workspace.title") });
  fireEvent.click(within(workspace).getByRole("button", { name: en("quality.title") }));
  await within(workspace).findAllByText("Main finding");
  fireEvent.change(within(workspace).getByLabelText(en("quality.source")), { target: { value: "audit" } });
  await within(workspace).findAllByText("Main finding");
  await act(async () => void fireEvent.click(screen.getByRole("tab", { name: en("tab.costs") })));
  await screen.findByRole("tab", { name: new RegExp(`^${en("tab.shots")}`) });
  await act(async () => void fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${en("tab.shots")}`) })));
  expect(await screen.findByLabelText(en("quality.target.main"))).toBe(video);
  expect(within(workspace).getByLabelText(en("quality.source"))).toHaveProperty("value", "audit");
  fireEvent.change(within(workspace).getByLabelText(en("quality.source")), { target: { value: "" } });
  await within(workspace).findAllByText("Main finding");
  await act(async () => void fireEvent.click(within(workspace).getByRole("link", { name: en("voiceAudit.open") })));
  await waitFor(() => expect(document.activeElement?.id).toBe(`scene-${initial.state.id}-s2`));
  await act(async () => void fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${en("tab.shots")}`) })));
  await within(workspace).findAllByText("Main finding");
  await act(async () => void fireEvent.click(within(workspace).getByRole("link", { name: en("research.open") })));
  await waitFor(() => expect(document.activeElement?.id).toBe(`scene-${initial.state.id}-s1`));
  await act(async () => void fireEvent.click(screen.getByRole("tab", { name: en("tab.overview") })));
  await open(); await inspect(1); expect(await screen.findByLabelText(en("quality.target.short"))).toBeTruthy();
});

it("joins main/Short playback, narration inspection, export-bound decisions and prepared correction", async () => {
  const action = okAct(); renderIn(<ShotsTab data={data()} workspace busy={false} act={action} />, "en");
  await open(); await inspect(0);
  const video = screen.getByLabelText(en("quality.target.main")) as HTMLVideoElement;
  fireEvent.loadedMetadata(video); expect(video.currentTime).toBe(3); expect(video.src).toContain("v=main-at");
  expect(within(screen.getByRole("region", { name: en("workspace.inspector") })).getByText("Narration for s1")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Decision freeze sh1" }), { target: { value: "accepted" } });
  await waitFor(() => expect(posts).toEqual([{ issueKey: "main-issue", exportId: "main-v1", status: "accepted" }]));
  await screen.findByRole("button", { name: en("workspace.nextIssue") });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en("workspace.nextIssue") })); });
  const short = screen.getByLabelText(en("quality.target.short")) as HTMLVideoElement;
  fireEvent.loadedMetadata(short); expect(short.currentTime).toBe(2); expect(short.src).toContain("&short&vshort=short-at");
  expect(within(screen.getByRole("region", { name: en("workspace.inspector") })).getByText("Narration for s2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: en("workspace.correct") }));
  expect(screen.getByLabelText(en("prod.replanNote"))).toHaveProperty("value", "Short finding");
  expect(action).not.toHaveBeenCalled();
});

it("keeps encoded evidence on its own export and rejects an old seek after replacement", async () => {
  const initial = data(), view = renderIn(<ShotsTab data={initial} workspace busy={false} act={okAct()} />, "en");
  await open(); await inspect(0);
  const oldVideo = screen.getByLabelText(en("quality.target.main")) as HTMLVideoElement;
  const newer = { ...initial, outputVersions: { main: "main-v2", short: "short-v1" }, state: { ...initial.state, done: { ...initial.state.done, timeline: "new-timeline" }, render: { ...initial.state.render!, at: "new-at", exportId: "main-v2" } } };
  view.rerender(<LocaleProvider locale="en"><ShotsTab data={newer} workspace busy={false} act={okAct()} /></LocaleProvider>);
  expect(screen.getByRole("alert")).toHaveProperty("textContent", en("workspace.stale"));
  expect(document.querySelector("video")).toBeNull(); fireEvent.loadedMetadata(oldVideo);
  expect(screen.getByRole("button", { name: en("workspace.correct") })).toHaveProperty("disabled", true);
});

it("opens authoring evidence at the actual scene and preserves preview frame, filters and shot context", async () => {
  rows = [{ ...issues()[0]!, target: "plan", source: "voice", shotId: "s2", seconds: undefined, exportId: undefined, detail: "Main finding" }];
  const onScene = vi.fn(), initial = data();
  const view = renderIn(<ShotsTab data={initial} workspace busy={false} act={okAct()} onScene={onScene} />, "en");
  await open(); await inspect(0); await screen.findByTestId("preview-player");
  expect(player.seek).toHaveBeenCalledWith(150); expect(player.play).not.toHaveBeenCalled();
  const listener = player.add.mock.calls.at(-1)![1] as (e: unknown) => void;
  listener({ detail: { frame: 177 } });
  fireEvent.change(screen.getByLabelText(en("quality.source")), { target: { value: "voice" } }); await screen.findAllByText("Main finding");
  fireEvent.click(screen.getByRole("link", { name: en("voiceAudit.open") })); expect(onScene).toHaveBeenCalledWith("s2");
  view.rerender(<LocaleProvider locale="en"><ShotsTab data={initial} workspace active={false} busy={false} act={okAct()} onScene={onScene} /></LocaleProvider>);
  expect(player.pause).toHaveBeenCalled();
  view.rerender(<LocaleProvider locale="en"><ShotsTab data={initial} workspace active busy={false} act={okAct()} onScene={onScene} /></LocaleProvider>);
  expect(screen.getByLabelText(en("quality.source"))).toHaveProperty("value", "voice");
  fireEvent.click(screen.getByRole("button", { name: en("shots.play.close") }));
  expect(player.remove).toHaveBeenCalledWith("frameupdate", listener);
  const seekCount = player.seek.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: en("shots.play") })); await screen.findByTestId("preview-player");
  expect(player.props.at(-1)!.initialFrame).toBe(177);
  expect(player.seek).toHaveBeenCalledTimes(seekCount);
  expect(screen.getByRole("region", { name: en("workspace.inspector") })).toBeTruthy();
});

it("handles absent timelines/outputs, unbound findings, unknown shots and explicit player changes", async () => {
  const initial = data(); initial.state.done.timeline = undefined;
  const external = { issue: { ...issues()[0]!, shotId: "unknown", target: "plan" as const, seconds: undefined, exportId: undefined }, seq: 1, episodeId: initial.state.id };
  const view = renderIn(<ReviewWorkspace data={initial} active busy={false} PlayerComponent={Preview} onShot={() => {}} onCorrect={() => {}} external={external}>{null}</ReviewWorkspace>, "en");
  expect(screen.getByText(en("workspace.noPreview"))).toBeTruthy(); expect(screen.getByText(en("workspace.noShot"))).toBeTruthy();
  expect(screen.getByText(en("workspace.pickShot"))).toBeTruthy();
  fireEvent.change(screen.getByLabelText(en("workspace.player")), { target: { value: "main" } });
  const video = screen.getByLabelText(en("quality.target.main")) as HTMLVideoElement; fireEvent.error(video);
  expect(screen.getByRole("alert")).toHaveProperty("textContent", en("workspace.videoError"));
  video.currentTime = 4; fireEvent.timeUpdate(video);
  fireEvent.change(screen.getByLabelText(en("workspace.player")), { target: { value: "short" } });
  fireEvent.change(screen.getByLabelText(en("workspace.player")), { target: { value: "main" } });
  const restored = screen.getByLabelText(en("quality.target.main")) as HTMLVideoElement; fireEvent.loadedMetadata(restored); expect(restored.currentTime).toBe(4);
  view.rerender(<LocaleProvider locale="en"><ReviewWorkspace data={{ ...initial, state: { ...initial.state, render: undefined } }} active busy={false} PlayerComponent={Preview} onShot={() => {}} onCorrect={() => {}}>{null}</ReviewWorkspace></LocaleProvider>);
  expect(screen.getByRole("alert")).toHaveProperty("textContent", en("workspace.noOutput"));
});

it("plays a selected shot in place and resets the preview only when its completed timeline changes", async () => {
  const initial = data(), view = renderIn(<ShotsTab data={initial} workspace busy={false} act={okAct()} />, "en");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: en("shots.playFrom") + " #2" })); });
  await screen.findByTestId("preview-player"); expect(player.seek).toHaveBeenLastCalledWith(150);
  expect(screen.getByRole("region", { name: en("workspace.inspector") })).toBeTruthy();
  [...player.add.mock.calls].at(-1)![1]({ detail: { frame: 180 } });
  view.rerender(<LocaleProvider locale="en"><ShotsTab data={{ ...initial, state: { ...initial.state, done: { timeline: "new" } } }} workspace busy={false} act={okAct()} /></LocaleProvider>);
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/timeline"))).toHaveLength(2));
  await screen.findByTestId("preview-player"); expect(player.props.at(-1)!.initialFrame).toBe(0);
});

it("keeps legacy output viewing explicit, clamps duration, and requires a usable image before correction", async () => {
  const initial = data(); initial.outputVersions = undefined; initial.state.input.motionMode = "still";
  const view = renderIn(<ShotsTab data={initial} workspace busy={false} act={okAct()} />, "en");
  await open(); await inspect(0);
  const video = screen.getByLabelText(en("quality.target.main")) as HTMLVideoElement;
  Object.defineProperty(video, "duration", { value: 1, configurable: true }); fireEvent.loadedMetadata(video); expect(video.currentTime).toBe(1);
  expect(screen.getByRole("button", { name: en("workspace.correct") })).toHaveProperty("disabled", true);
  const usable = { ...initial, state: { ...initial.state, keyframes: { sh1: { key: "image.png", mimeType: "image/png" } } } };
  view.rerender(<LocaleProvider locale="en"><ShotsTab data={usable} workspace busy={false} act={okAct()} /></LocaleProvider>);
  expect(screen.getByRole("button", { name: en("workspace.correct") })).toHaveProperty("disabled", false);
  const legacy = { ...usable, state: { ...usable.state, render: { ...usable.state.render!, exportId: undefined } } };
  view.rerender(<LocaleProvider locale="en"><ShotsTab data={legacy} workspace busy={false} act={okAct()} /></LocaleProvider>);
  expect(screen.getByRole("alert")).toHaveProperty("textContent", en("workspace.stale"));
  fireEvent.change(screen.getByLabelText(en("workspace.player")), { target: { value: "main" } });
  expect((screen.getByLabelText(en("quality.target.main")) as HTMLVideoElement).src).toContain("export=");
  expect(screen.getByText(en("quality.version") + ": main-at")).toBeTruthy();
  view.rerender(<LocaleProvider locale="en"><ShotsTab data={{ ...legacy, state: { ...legacy.state, done: { timeline: "new-without-request" } } }} workspace busy={false} act={okAct()} /></LocaleProvider>);
  expect(screen.getByLabelText(en("quality.target.main"))).toBeTruthy();
});

it("does not replace the current inspection when another issue's decision completes", async () => {
  let release!: (response: Response) => void; const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, opts?: RequestInit) => opts?.method === "POST" ? new Promise<Response>(resolve => { release = resolve; }) : original(url, opts));
  renderIn(<ShotsTab data={data()} workspace busy={false} act={okAct()} />, "en");
  await open();
  fireEvent.change(screen.getByRole("combobox", { name: "Decision freeze sh1" }), { target: { value: "reviewed" } });
  await act(async () => { release(json({ ok: true })); });
  await screen.findByText("Main finding"); await inspect(0);
  fireEvent.change(screen.getByRole("combobox", { name: "Decision freeze sh1" }), { target: { value: "accepted" } });
  await inspect(1); await act(async () => { release(json({ ok: true })); });
  expect(screen.getByLabelText(en("quality.target.short"))).toBeTruthy();
});
