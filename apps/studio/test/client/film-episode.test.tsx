// @vitest-environment happy-dom
import type { MotionFilm, MotionScene } from "@ys/core";
import type { EpisodeState } from "@ys/pipeline/light";
import { act as reactAct, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptTab, ShotsTab } from "../../src/app/episodes/[id]/steps.tsx";
import { FilmTreatment, sceneText } from "../../src/app/episodes/[id]/film-treatment.tsx";
import { tabsOf } from "../../src/app/episodes/[id]/parts.tsx";
import { en, makeData, makeState, okAct, renderIn, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = { beats: 4, pace: "beat", transition: "cut", camera: "still", ground: "ground", hit: "none", narration: "" } as const;
const scene = (id: string, over: Partial<MotionScene>): MotionScene => ({ id, language: "kinetic", ...base, kinetic: { lines: ["Tek komut.", "Konudan videoya."], mode: "slam" }, ...over }) as MotionScene;

const scenes: MotionScene[] = [
  scene("m1", { hit: "impact", transition: "cut", camera: "punch", ground: "ink", narration: "Tek komutla video." }),
  scene("m2", { language: "data", illustrative: true, transition: "whip", data: { chart: "bars", title: "Render", unit: "dk", points: [{ label: "Önce", value: 27 }, { label: "Sonra", value: 3 }], callout: "9 kat" } }),
  scene("m3", { language: "diagram", transition: "flash", ground: "accent", diagram: { title: "Hat", nodes: [{ id: "a", label: "Senaryo", col: 0, row: 0 }, { id: "b", label: "Render", col: 1, row: 0 }], edges: [{ from: "a", to: "b" }], packets: true } }),
  scene("m4", { language: "grid", transition: "flood", camera: "pull", grid: { mode: "montage", cards: [{ title: "Ses", stat: "12" }, { title: "Kurgu" }] } }),
  scene("m5", { language: "field", transition: "iris", camera: "drift", field: { kind: "starfield", title: "Bir kez kur." } }),
  scene("m6", { language: "object", transition: "push", camera: "push", object: { preset: "crystal", title: "AI Video Factory", caption: "Konudan videoya" } }),
  scene("m7", { language: "data", transition: "flip", data: { chart: "count", title: "Hız", points: [], count: { to: 9, from: 0, decimals: 0, prefix: "", suffix: "×" } } }),
];
const film: MotionFilm = {
  title: "Video hattı",
  bpm: 120,
  route: "hybrid",
  type: "technical",
  palette: { ground: "#f0f4ff", ink: "#0f172a", accent: "#2563eb", alt: "#dbeafe" },
  sections: [
    { name: "hook", bars: 1, energy: 7 },
    { name: "build", bars: 2, energy: 5 },
    { name: "stop", bars: 1, energy: 1 },
    { name: "peak", bars: 2, energy: 9 },
    { name: "resolve", bars: 1, energy: 3 },
  ],
  scenes,
};
const script = { scenes: scenes.map((s) => ({ id: s.id, beatId: s.id, narration: s.narration, visualIntent: "", emotion: "neutral", location: "" })) };
const motion = (narration = false) => ({ motion: { colors: [], images: [], narration } });
const filmState = (over: Partial<EpisodeState> = {}, narration = false) => makeState({ script, motionFilm: film, ...over } as Partial<EpisodeState>, motion(narration));

describe("sahnenin ekrandaki metni", () => {
  it("her dil kendi metnini verir; birimler, not, bağlar, başlıklar ve yedekler", () => {
    expect(sceneText(scenes[0]!)).toBe("Tek komut. / Konudan videoya.");
    expect(sceneText(scenes[1]!)).toBe("Render: Önce 27dk, Sonra 3dk (9 kat)");
    expect(sceneText(scene("x", { language: "data", data: { chart: "line", title: "Seri", points: [{ label: "A", value: 1 }, { label: "B", value: 2 }] } }))).toBe("Seri: A 1, B 2");
    expect(sceneText(scenes[6]!)).toBe("Hız: 9×");
    expect(sceneText(scene("x", { language: "data", data: { chart: "count", title: "Pay", unit: "%", points: [], count: { to: 70, from: 0, decimals: 0, prefix: "~", suffix: "" } } }))).toBe("Pay: ~70%");
    expect(sceneText(scenes[2]!)).toBe("Hat: Senaryo → Render");
    expect(sceneText(scene("x", { language: "diagram", diagram: { nodes: [{ id: "a", label: "A", col: 0, row: 0 }, { id: "b", label: "B", col: 1, row: 0 }], edges: [], packets: false } }))).toBe("A, B");
    expect(sceneText(scenes[3]!)).toBe("12 Ses · Kurgu");
    expect(sceneText(scene("x", { language: "grid", grid: { mode: "grid", title: "Hepsi", cards: [{ title: "Log" }] } }))).toBe("Hepsi: Log");
    expect(sceneText(scenes[4]!)).toBe("Bir kez kur.");
    expect(sceneText(scene("x", { language: "field", field: { kind: "sparks", subtitle: "Alt" } }))).toBe("Alt");
    expect(sceneText(scene("x", { language: "field", field: { kind: "bubbles" } }))).toBe("bubbles");
    expect(sceneText(scenes[5]!)).toBe("AI Video Factory / Konudan videoya");
    expect(sceneText(scene("x", { language: "object", object: { preset: "atom" } }))).toBe("atom");
  });
});

describe("film tarifi", () => {
  it("başlık, tempo, palet, ritim çizelgesi, sahneler, temsili veri, vurgu sesi ve denetim bulguları", () => {
    const lint = [
      { kind: "gap" as const, sceneId: "m3", atSec: 4.5, detail: "3.0 s with nothing new" },
      { kind: "hook" as const, atSec: 0, detail: "nothing new" },
    ];
    renderIn(<FilmTreatment state={filmState({ motionLint: lint } as Partial<EpisodeState>)} film={film} busy={false} approved={false} act={okAct()} onDirtyChange={() => {}} />);
    expect(screen.getByText("Video hattı")).toBeTruthy();
    expect(screen.getByText(tr("film.meta", { bpm: 120, sec: "14.0", scenes: 7, route: tr("film.route.hybrid") }))).toBeTruthy();
    expect(screen.getByLabelText(tr("film.palette")).children).toHaveLength(4);
    const rhythm = screen.getByTestId("film-rhythm");
    expect(rhythm.children).toHaveLength(5);
    expect((rhythm.children[0] as HTMLElement).style.width).toBe(`${(1 / 7) * 100}%`);
    expect((rhythm.children[0] as HTMLElement).title).toBe(tr("film.section", { name: tr("film.section.hook"), bars: 1, energy: 7 }));
    for (const name of ["hook", "build", "stop", "peak", "resolve"] as const) expect(rhythm.textContent).toContain(tr(`film.section.${name}`));
    const lintList = screen.getByTestId("film-lint");
    expect(lintList.children).toHaveLength(2);
    expect(lintList.children[0]!.textContent).toContain(tr("film.lint.gap"));
    expect(lintList.children[0]!.textContent).toContain("m3");
    expect(lintList.children[1]!.querySelector(".font-mono")).toBeNull();
    expect(screen.getAllByTestId("film-scene-text").map((p) => p.textContent)).toEqual(scenes.map(sceneText));
    expect(screen.getAllByText(tr("film.illustrative"))).toHaveLength(1);
    expect(screen.getByText("♪ impact")).toBeTruthy();
    expect(screen.getAllByText(tr("film.beats", { beats: 4, sec: "2.0" }))).toHaveLength(scenes.length);
    expect(screen.getByText([tr("film.transition.cut"), tr("film.camera.punch"), tr("film.ground.ink")].join(" · "))).toBeTruthy();
    for (const l of ["kinetic", "data", "diagram", "grid", "field", "object"] as const) expect(screen.getAllByText(tr(`film.lang.${l}`)).length).toBeGreaterThan(0);
    // Anlatım kapalı: düzenleyici yok.
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("bulgu listesi boşsa ya da yoksa gösterilmez; boş ritim çizelgesi", () => {
    const empty = { ...film, sections: [] };
    renderIn(<FilmTreatment state={filmState({ motionLint: [] } as Partial<EpisodeState>)} film={empty} busy={false} approved={false} act={okAct()} onDirtyChange={() => {}} />);
    expect(screen.queryByTestId("film-lint")).toBeNull();
    expect(screen.getByTestId("film-rhythm").children).toHaveLength(0);
    cleanup();
    renderIn(<FilmTreatment state={filmState()} film={film} busy={false} approved={false} act={okAct()} onDirtyChange={() => {}} />);
    expect(screen.queryByTestId("film-lint")).toBeNull();
  });

  it("notla yeniden yaz: boş notla kilitli, iş sürerken kilitli; gönderilince eylem gider", async () => {
    const act = okAct();
    renderIn(<FilmTreatment state={filmState()} film={film} busy={false} approved={false} act={act} onDirtyChange={() => {}} />);
    const send = () => screen.getByRole("button", { name: new RegExp(tr("film.remake.submit")) }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(tr("film.remake")), { target: { value: "   " } });
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(tr("film.remake")), { target: { value: "Daha hızlı açılış" } });
    expect(send().disabled).toBe(false);
    await reactAct(async () => void fireEvent.click(send()));
    expect(act).toHaveBeenCalledWith({ type: "remake-film", note: "Daha hızlı açılış" });
    cleanup();
    renderIn(<FilmTreatment state={filmState()} film={film} busy approved={false} act={act} onDirtyChange={() => {}} />);
    fireEvent.change(screen.getByLabelText(tr("film.remake")), { target: { value: "Not" } });
    expect(send().disabled).toBe(true);
    cleanup();
    // Onaylı filmde yeniden yazma yok.
    renderIn(<FilmTreatment state={filmState()} film={film} busy={false} approved act={act} onDirtyChange={() => {}} />);
    expect(screen.queryByLabelText(tr("film.remake"))).toBeNull();
  });

  it("anlatım açıksa her sahnenin cümlesi düzenlenir: senaryodaki, yoksa filmdeki; onaylıysa kilitli", () => {
    const onDirty = vi.fn();
    const partial = { scenes: [{ ...script.scenes[0]!, narration: "Senaryodaki cümle." }] };
    renderIn(<FilmTreatment state={filmState({ script: partial } as Partial<EpisodeState>, true)} film={film} busy={false} approved={false} act={okAct()} onDirtyChange={onDirty} />);
    const editors = [...document.querySelectorAll("li textarea")] as HTMLTextAreaElement[];
    expect(editors).toHaveLength(scenes.length);
    expect(editors[0]!.value).toBe("Senaryodaki cümle.");
    expect(editors[1]!.value).toBe("");
    expect(onDirty).toHaveBeenCalled();
    cleanup();
    renderIn(<FilmTreatment state={filmState({ script: undefined } as Partial<EpisodeState>, true)} film={film} busy={false} approved act={okAct()} onDirtyChange={() => {}} />);
    const locked = [...document.querySelectorAll("li textarea")] as HTMLTextAreaElement[];
    expect(locked[0]!.value).toBe("Tek komutla video.");
    expect(locked.every((t) => t.disabled)).toBe(true);
  });

  it("motion girdisi olmayan durumda anlatım düzenleyicisi yok; İngilizce", () => {
    renderIn(<FilmTreatment state={makeState({ script } as Partial<EpisodeState>)} film={film} busy={false} approved={false} act={okAct()} onDirtyChange={() => {}} />, "en");
    expect(document.querySelectorAll("li textarea")).toHaveLength(0);
    expect(screen.getByText(en("film.remake"))).toBeTruthy();
  });
});

describe("film bölümü sekmeleri", () => {
  it("film bölümünde konsept sekmesi yok", () => {
    expect(tabsOf(filmState())).toEqual(["overview", "script", "shots", "costs", "activity"]);
  });

  it("senaryo sekmesi filmin tarifini gösterir: araştırma ve hikâye kartı yok, onay düğmesi filmi onaylar", () => {
    const act = okAct();
    const state = filmState({ story: { title: "T", logline: "Logline metni", premise: "", hook: "Kanca metni", beats: [] } } as Partial<EpisodeState>);
    renderIn(<ScriptTab data={makeData(state)} busy={false} act={act} />);
    expect(screen.getByTestId("film-rhythm")).toBeTruthy();
    expect(screen.queryByRole("button", { name: tr("research.title") })).toBeNull();
    expect(screen.queryByText("Logline metni")).toBeNull();
    const approve = screen.getByRole("button", { name: new RegExp(tr("film.approve")) });
    // Maliyet tahmini filmde gösterilmez.
    expect(approve.querySelector("span")).toBeNull();
    fireEvent.click(approve);
    expect(act).toHaveBeenCalledWith({ type: "approve-script" });
  });

  it("filmi henüz yazılmamış motion bölümü düz senaryo gibi görünür", () => {
    renderIn(<ScriptTab data={makeData(makeState({ script } as Partial<EpisodeState>, motion()))} busy={false} act={okAct()} />);
    expect(screen.queryByTestId("film-rhythm")).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(tr("script.approve")) })).toBeTruthy();
  });

  it("çekimler sekmesi: film sahneleri yeniden çizilmez ve notla yeniden oluşturulmaz", () => {
    const shots = scenes.map((s, i) => ({ id: s.id, sceneId: s.id, kind: "motion_graphic" as const, startMs: i * 2000, endMs: (i + 1) * 2000, description: sceneText(s), imagePrompt: "", motionPrompt: "", camera: "static" as const }));
    renderIn(<ShotsTab data={makeData(filmState({ shots } as Partial<EpisodeState>))} busy={false} act={okAct()} />);
    expect(screen.queryByText(tr("prod.replanHint"))).toBeNull();
    expect(screen.queryByText(tr("prod.pickFailed"), { exact: false })).toBeNull();
    expect(screen.getAllByText("m7").length).toBeGreaterThan(0);
  });
});
