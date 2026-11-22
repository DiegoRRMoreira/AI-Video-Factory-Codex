// @vitest-environment happy-dom
import type { EpisodeState } from "@ys/pipeline/light";
import { act as reactAct, cleanup, fireEvent, screen, within } from "@testing-library/react";
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

  it("onaylı kurgu salt okunur: vuruşlar, parçalar (kare, aralık, kadraj, ses), yazılar", () => {
    const { container } = renderIn(<ScriptTab data={makeData(footageState({ footageCuts: cuts, approvals: { script: "t" } }))} busy={false} act={okAct()} />);
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
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("onaysız kurgu düzenlenir: sıra, silme, aralık, odak, kadraj, ses, hava, yazı; kaydedilmeden onay kilitli", async () => {
    const act = okAct();
    const { container } = renderIn(<ScriptTab data={makeData(footageState({ footageCuts: cuts }))} busy={false} act={act} />);
    const approve = () => screen.getByRole("button", { name: new RegExp(tr("footage.plan.approve")) }) as HTMLButtonElement;
    expect(approve().disabled).toBe(false);
    expect(screen.queryByText(tr("footage.edit.unsaved"))).toBeNull();
    // Zamanlanmış süre gösterilir; düzenleme başlayınca gizlenir.
    expect(screen.getByText(tr("footage.plan.beatSec", { sec: "5.2" }))).toBeTruthy();
    const label = (key: Parameters<typeof tr>[0]) => screen.getAllByLabelText(tr(key));
    fireEvent.change(label("footage.edit.from")[0]!, { target: { value: "1.5" } });
    fireEvent.change(label("footage.edit.to")[0]!, { target: { value: "3" } });
    fireEvent.change(label("footage.edit.seconds")[0]!, { target: { value: "2.5" } });
    fireEvent.change(label("footage.edit.focus")[0]!, { target: { value: "0.8" } });
    fireEvent.change(label("footage.edit.fit")[0]!, { target: { value: "contain" } });
    fireEvent.change(label("footage.edit.audio")[0]!, { target: { value: "original" } });
    expect((label("footage.edit.audio")[1] as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(label("footage.edit.mood")[0]!, { target: { value: "dramatic" } });
    expect(screen.queryByText(tr("footage.plan.beatSec", { sec: "5.2" }))).toBeNull();
    expect(screen.getByText(tr("footage.edit.unsaved"))).toBeTruthy();
    expect(approve().disabled).toBe(true);
    // Anlatım düzenleyicisi kurgu kaydedilene dek kilitli.
    expect((container.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(label("footage.edit.right")[0]!);
    fireEvent.click(label("footage.edit.left")[1]!);
    fireEvent.click(label("footage.edit.remove")[1]!);
    fireEvent.click(label("footage.edit.beatDown")[0]!);
    fireEvent.click(label("footage.edit.beatUp")[1]!);
    fireEvent.change(label("footage.edit.text")[0]!, { target: { value: "Yeni kanca" } });
    fireEvent.change(label("footage.edit.style")[0]!, { target: { value: "title" } });
    fireEvent.change(label("footage.edit.position")[0]!, { target: { value: "center" } });
    fireEvent.change(label("footage.edit.beat")[0]!, { target: { value: "b2" } });
    await reactAct(async () => void fireEvent.click(screen.getByRole("button", { name: new RegExp(tr("footage.edit.save")) })));
    const sent = act.mock.calls.at(-1)![0] as { type: string; plan: { beats: { id: string; mood: string; segments: { fromMs: number; toMs: number; focusX: number; fit: string; audio: string }[] }[]; overlays: object[] } };
    expect(sent.type).toBe("edit-footage");
    expect(sent.plan.beats.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(sent.plan.beats[0]).toMatchObject({ mood: "dramatic", segments: [{ fromMs: 1500, toMs: 3000, focusX: 0.8, fit: "contain", audio: "original" }] });
    expect(sent.plan.overlays).toEqual([{ text: "Yeni kanca", style: "title", beat: "b2", position: "center" }]);
    // Geri al taslağı sunucudaki kurguya döndürür.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tr("footage.edit.reset")) }));
    expect(screen.queryByText(tr("footage.edit.unsaved"))).toBeNull();
    expect(container.querySelectorAll("[data-segment]")).toHaveLength(3);
    fireEvent.click(screen.getByLabelText(tr("footage.edit.textRemove")));
    expect(screen.queryByLabelText(tr("footage.edit.text"))).toBeNull();
    expect(screen.getByText(tr("footage.edit.unsaved"))).toBeTruthy();
  });

  it("vuruş silinince yazıları da gider; son vuruş ve tek parça silinemez", () => {
    renderIn(<ScriptTab data={makeData(footageState())} busy={false} act={okAct()} />);
    const label = (key: Parameters<typeof tr>[0]) => screen.getAllByLabelText(tr(key)) as HTMLButtonElement[];
    expect(label("footage.edit.remove")[2]!.disabled).toBe(true);
    fireEvent.click(label("footage.edit.beatRemove")[0]!);
    expect(screen.queryByLabelText(tr("footage.edit.text"))).toBeNull();
    expect(label("footage.edit.beatRemove")[0]!.disabled).toBe(true);
  });

  it("onay düğmesi kurguyu onaylar; yazısız plan; senaryoda olmayan vuruş anlatımı plandan gelir; İngilizce", () => {
    const act = okAct();
    const state = footageState({ footagePlan: { ...plan, overlays: [] }, script: { scenes: [] } as never });
    renderIn(<ScriptTab data={makeData(state)} busy={false} act={act} />, "en");
    expect(screen.queryByText(en("footage.plan.overlays"))).toBeNull();
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Yola çıktık.");
    expect((screen.getAllByLabelText(en("footage.edit.from"))[0] as HTMLInputElement).value).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en("footage.plan.approve")) }));
    expect(act).toHaveBeenCalledWith({ type: "approve-script" });
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
