// @vitest-environment happy-dom
import type { EpisodeState } from "@ys/pipeline/light";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptTab, ShotsTab } from "../../src/app/episodes/[id]/steps.tsx";
import { frameFor } from "../../src/app/episodes/[id]/footage-plan.tsx";
import { tabsOf, TABS } from "../../src/app/episodes/[id]/parts.tsx";
import { en, makeData, makeState, okAct, renderIn, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const footage = {
  sources: [
    { id: "f1", key: "k/f1.mp4", name: "yol.mp4", ext: "mp4", kind: "video" as const, durationMs: 20000, width: 1920, height: 1080, audio: true },
    { id: "f2", key: "k/f2.jpg", name: "foto.jpg", ext: "jpg", kind: "image" as const, durationMs: 0, width: 800, height: 600, audio: false },
  ],
  narration: true,
  transcribe: true,
  texts: [],
};
const plan = {
  title: "Gezi",
  beats: [
    { id: "b1", narration: "Yola çıktık.", mood: "warm" as const, segments: [
      { source: "f1", fromMs: 1000, toMs: 4000, focusX: 0.3, fit: "cover" as const, audio: "ambient" as const, why: "yol" },
      { source: "f2", fromMs: 0, toMs: 2000, focusX: 0.5, fit: "contain" as const, audio: "mute" as const, why: "foto" },
    ] },
    { id: "b2", narration: "", mood: "night" as const, segments: [{ source: "f9", fromMs: 0, toMs: 2000, focusX: 0.5, fit: "cover" as const, audio: "original" as const, why: "kayıp" }] },
  ],
  overlays: [{ text: "Kanca", style: "hook" as const, beat: "b1", position: "top" as const }],
};
const scan = { f1: { frames: [{ atMs: 1000, key: "fr/f1-1000.jpg" }, { atMs: 3000, key: "fr/f1-3000.jpg" }] }, f2: { frames: [{ atMs: 0, key: "fr/f2-0.jpg" }] } };
const script = { scenes: plan.beats.map((b) => ({ id: b.id, beatId: b.id, narration: b.narration, visualIntent: "", emotion: b.mood, location: "" })) };
const cuts = [
  { id: "b1-sh1", beat: "b1", source: "f1", kind: "video" as const, fromMs: 1000, toMs: 4000, speed: 0.75, holdMs: 1200, startMs: 0, durMs: 5200, focusX: 0.3, fit: "cover" as const, audio: "ambient" as const, why: "yol" },
];

const footageState = (over: Partial<EpisodeState> = {}) =>
  makeState({ script, footagePlan: plan, footageScan: scan, ...over } as Partial<EpisodeState>, { footage, width: 1080, height: 1920 });

describe("footage bölümü", () => {
  it("en yakın taranmış kare; kare yoksa yok", () => {
    expect(frameFor(scan, "f1", 2500, 4000)).toBe("fr/f1-3000.jpg");
    expect(frameFor(scan, "f1", 0, 1000)).toBe("fr/f1-1000.jpg");
    expect(frameFor(scan, "f9", 0, 1000)).toBeUndefined();
    expect(frameFor(undefined, "f1", 0, 1000)).toBeUndefined();
  });

  it("footage bölümünde konsept sekmesi yok", () => {
    expect(tabsOf(makeState())).toEqual(TABS);
    expect(tabsOf(footageState())).toEqual(["overview", "script", "shots", "costs", "activity"]);
  });

  it("kurgu sekmesi: vuruşlar, parçalar (kare, aralık, kadraj, ses), yazılar; onay kurguyu onaylar", () => {
    const act = okAct();
    const { container } = renderIn(<ScriptTab data={makeData(footageState({ footageCuts: cuts }))} busy={false} act={act} />);
    expect(container.querySelector("[data-footage-plan]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: tr("research.title") })).toBeNull();
    const first = container.querySelector('[data-segment="b1-1"]') as HTMLElement;
    expect(first.querySelector("img")!.getAttribute("src")).toBe("/api/assets/fr/f1-3000.jpg");
    expect((first.querySelector("img") as HTMLImageElement).style.objectPosition).toBe("30% 50%");
    expect(within(first).getByText(/yol\.mp4/)).toBeTruthy();
    expect(first.textContent).toContain(tr("footage.plan.range", { from: "1.0", to: "4.0" }));
    expect(first.textContent).toContain("×0.75");
    expect(first.textContent).toContain(tr("footage.plan.hold", { sec: "1.2" }));
    expect(first.textContent).toContain(tr("footage.fit.cover"));
    expect(first.textContent).toContain(tr("footage.audio.ambient"));
    const still = container.querySelector('[data-segment="b1-2"]') as HTMLElement;
    expect(still.textContent).toContain(tr("footage.plan.still", { sec: "2.0" }));
    expect(still.textContent).toContain(tr("footage.audio.mute"));
    // Kaynağı bilinmeyen parça: kare yerine boş kutu, kimliği.
    const lost = container.querySelector('[data-segment="b2-1"]') as HTMLElement;
    expect(lost.querySelector("img")).toBeNull();
    expect(lost.textContent).toContain("f9");
    expect(screen.getByText(tr("footage.plan.noNarration"))).toBeTruthy();
    expect(screen.getByText(tr("footage.plan.beatSec", { sec: "5.2" }))).toBeTruthy();
    expect(screen.getByText(tr("footage.mood.warm"))).toBeTruthy();
    expect(container.querySelector('[data-overlay-item="hook"]')!.textContent).toContain("Kanca");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: tr("footage.plan.approve") }));
    expect(act).toHaveBeenCalledWith({ type: "approve-script" });
  });

  it("zamanlanmamış kurgu ve yazısız plan; senaryoda olmayan vuruş anlatımı plandan gelir; İngilizce", () => {
    const state = footageState({ footagePlan: { ...plan, overlays: [] }, script: { scenes: [] } as never });
    renderIn(<ScriptTab data={makeData(state)} busy={false} act={okAct()} />, "en");
    expect(screen.queryByText(en("footage.plan.overlays"))).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Yola çıktık.");
    expect(screen.getByText(en("footage.plan.range", { from: "1.0", to: "4.0" }))).toBeTruthy();
  });

  it("çekimler sekmesi: kare taranmış görüntüden; yeniden çizim ve notla yeniden oluşturma yok", () => {
    const shots = cuts.map((c) => ({ id: c.id, sceneId: c.beat, kind: "footage" as const, startMs: 0, endMs: 5200, description: c.why, imagePrompt: "", motionPrompt: "", camera: "static" as const }));
    const extra = { id: "b9-sh1", sceneId: "b9", kind: "footage" as const, startMs: 5200, endMs: 6000, description: "kayıp", imagePrompt: "", motionPrompt: "", camera: "static" as const };
    renderIn(<ShotsTab data={makeData(footageState({ footageCuts: cuts, shots: [...shots, extra] }))} busy={false} act={okAct()} />);
    expect(screen.getByRole("img", { name: "b1-sh1" }).getAttribute("src")).toContain("fr/f1-3000.jpg");
    expect(screen.queryByText(tr("prod.replanHint"))).toBeNull();
    expect(screen.queryByText(tr("prod.pickFailed"), { exact: false })).toBeNull();
  });
});
