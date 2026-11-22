// @vitest-environment happy-dom
import type { EpisodeState, YoutubeState } from "@ys/pipeline/light";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { approved, tabsOf } from "../../src/app/episodes/[id]/parts.tsx";
import { atTime, clock, frameAt, YoutubeTab } from "../../src/app/episodes/[id]/youtube-report.tsx";
import { YoutubeForm } from "../../src/app/youtube-form.tsx";
import { en, json, makeData, makeState, okAct, renderIn, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
});

const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const input = { url: URL, videoId: "dQw4w9WgXcQ", count: 6, minSec: 20, maxSec: 60 };
const ytState = (youtube: YoutubeState = {}, over: Partial<EpisodeState> = {}) => makeState({ youtube, ...over } as Partial<EpisodeState>, { youtube: input, width: 1080, height: 1920 });

const meta = { videoId: "dQw4w9WgXcQ", title: "Uzun Sohbet", channel: "Kanal", durationMs: 3_725_000, width: 1920, height: 1080, description: "", chapters: [], heatmap: [] };
const frames = [
  { atMs: 10_000, scene: 1, key: "f/10.jpg" },
  { atMs: 40_000, scene: 2, key: "f/40.jpg" },
];
const report: YoutubeState["report"] = {
  scenes: [
    { fromSec: 0, toSec: 30, summary: "Tanışma", people: "İki kişi masada", onScreenText: "BÖLÜM 1", energy: 2, quality: "dark", frameKey: "f/10.jpg" },
    { fromSec: 30, toSec: 60, summary: "Soru", people: "", onScreenText: "", energy: 5, quality: "good" },
  ],
  cuts: [{ fromSec: 0, toSec: 5, reason: "intro_outro", note: "jenerik" }],
  moments: [],
  candidates: [
    { id: "c1", title: "Soru", hook: "Bunu bilmiyordun", why: "soru-cevap", score: 9, mood: "warm", durationMs: 25_000, segments: [{ fromMs: 30_000, toMs: 55_000, focusX: 0.5, fit: "cover" }] },
    { id: "c2", title: "Final", hook: "", why: "kapanış", score: 6, mood: "warm", durationMs: 40_000, segments: [{ fromMs: 3_600_000, toMs: 3_620_000, focusX: 0.5, fit: "cover" }, { fromMs: 3_630_000, toMs: 3_650_000, focusX: 0.5, fit: "cover" }] },
    { id: "c3", title: "Erken", hook: "", why: "w", score: 5, mood: "warm", durationMs: 20_000, segments: [{ fromMs: 0, toMs: 20_000, focusX: 0.5, fit: "cover" }] },
  ],
};

describe("yardımcılar ve sekmeler", () => {
  it("clock, YouTube zaman bağlantısı, anın karesi", () => {
    expect(clock(65_400)).toBe("1:05");
    expect(clock(3_725_000)).toBe("1:02:05");
    expect(clock(-5)).toBe("0:00");
    expect(atTime(URL, 61_900)).toBe(`${URL}&t=61s`);
    expect(frameAt(frames, 20_000)).toBe("f/40.jpg");
    expect(frameAt(frames, 90_000)).toBe("f/40.jpg");
    expect(frameAt(undefined, 0)).toBeUndefined();
  });

  it("YouTube bölümünde yalnız rapor, maliyet ve günlük; bütün kapılar geçer", () => {
    expect(tabsOf(ytState())).toEqual(["youtube", "costs", "activity"]);
    expect(approved(ytState(), "script")).toBe(true);
    expect(approved(makeState(), "script")).toBe(false);
  });
});

describe("analiz raporu", () => {
  it("rapor yokken ilerleme adımları", () => {
    renderIn(<YoutubeTab data={makeData(ytState({ meta, video: { key: "v", durationMs: 1, width: 1920, height: 1080, audio: true }, transcript: { source: "auto", words: 120 }, scenes: [{ fromMs: 0, toMs: 1 }], frames, windows: [{ sig: "a", out: { scenes: [], cuts: [], moments: [] } }] }))} busy={false} act={okAct()} />);
    const steps = screen.getByTestId("youtube-steps");
    expect(steps.textContent).toContain(tr("youtube.transcript.auto", { n: 120 }));
    expect(steps.textContent).toContain(tr("youtube.scenesFrames", { scenes: 1, frames: 2 }));
    expect(steps.textContent).toContain(tr("youtube.windowsDone", { n: 1 }));
    expect(steps.textContent).toContain("1920×1080");
    expect(screen.getByText("Uzun Sohbet")).toBeTruthy();
    expect(screen.getByText("Kanal")).toBeTruthy();
  });

  it("hiçbir şey yokken adres başlık, adımlar boş", () => {
    renderIn(<YoutubeTab data={makeData(ytState(undefined, { youtube: undefined }))} busy={false} act={okAct()} />, "en");
    expect(screen.getByText(URL)).toBeTruthy();
    expect(screen.getByText(en("youtube.limits", { count: 6, min: 20, max: 60 }))).toBeTruthy();
    expect(screen.getByTestId("youtube-steps").querySelectorAll("svg")).toHaveLength(0);
  });

  it("adaylar seçilip Short üretilir; üretilmiş aday bölüme bağlanır; sahne günlüğü ve kesimler", async () => {
    const act$ = okAct();
    renderIn(<YoutubeTab data={makeData(ytState({ meta, frames, report, shorts: [{ candidate: "c3", episodeId: "short-3" }] }))} busy={false} act={act$} />);
    expect(screen.getByText(tr("youtube.candidates", { n: 3 }))).toBeTruthy();
    const make = screen.getByRole("button", { name: tr("youtube.make", { n: 0 }) }) as HTMLButtonElement;
    expect(make.disabled).toBe(true);
    const c1 = screen.getByTestId("candidate-c1");
    expect(c1.textContent).toContain("9/10");
    expect(c1.textContent).toContain("“Bunu bilmiyordun”");
    expect(c1.querySelector("img")!.getAttribute("src")).toBe("/api/assets/f/40.jpg");
    expect(c1.querySelector("a")!.getAttribute("href")).toBe(`${URL}&t=30s`);
    expect(screen.getByTestId("candidate-c2").textContent).toContain(tr("youtube.length", { sec: 40, parts: 2 }));
    expect(screen.getByTestId("candidate-c2").textContent).toContain("1:00:00–1:00:20");
    expect(screen.getByRole("link", { name: tr("youtube.open") }).getAttribute("href")).toBe("/episodes/short-3");

    fireEvent.click(c1.querySelector('input[type="checkbox"]')!);
    fireEvent.click(screen.getByTestId("candidate-c2").querySelector('input[type="checkbox"]')!);
    fireEvent.click(screen.getByTestId("candidate-c2").querySelector('input[type="checkbox"]')!);
    fireEvent.click(screen.getByLabelText(tr("youtube.review")));
    fireEvent.click(screen.getByLabelText(tr("form.music")));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: tr("youtube.make", { n: 1 }) })));
    expect(act$).toHaveBeenCalledWith({ type: "make-shorts", candidates: ["c1"], review: true, music: false });
    expect(screen.getByRole("button", { name: tr("youtube.make", { n: 0 }) })).toBeTruthy();

    // Sahne günlüğü: kare, enerji, kalite; kesimler: neden.
    expect(screen.getByText(tr("youtube.scenes", { n: 2 }))).toBeTruthy();
    expect(screen.getByText("Tanışma")).toBeTruthy();
    expect(screen.getByText("İki kişi masada")).toBeTruthy();
    expect(screen.getByText("“BÖLÜM 1”")).toBeTruthy();
    expect(screen.getByText(tr("youtube.quality.dark"))).toBeTruthy();
    expect(screen.queryByText(tr("youtube.quality.good"))).toBeNull();
    expect(screen.getAllByTitle(tr("youtube.energy")).map((e) => e.textContent)).toEqual(["●●○○○", "●●●●●"]);
    expect(screen.getByText(tr("youtube.cut.intro_outro"))).toBeTruthy();
    expect(screen.getByText("jenerik")).toBeTruthy();
  });

  it("eylem reddedilirse seçim kalır; aday yoksa bilgi, sahne günlüğü açık", async () => {
    const refused = vi.fn(async () => false);
    renderIn(<YoutubeTab data={makeData(ytState({ meta, frames: [], report }))} busy={false} act={refused} />);
    expect(screen.getByTestId("candidate-c1").querySelector("img")).toBeNull();
    fireEvent.click(screen.getByTestId("candidate-c1").querySelector('input[type="checkbox"]')!);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: tr("youtube.make", { n: 1 }) })));
    expect(screen.getByRole("button", { name: tr("youtube.make", { n: 1 }) })).toBeTruthy();
    cleanup();
    renderIn(<YoutubeTab data={makeData(ytState({ meta, report: { ...report!, candidates: [] } }))} busy={false} act={okAct()} />);
    expect(screen.getByText(tr("youtube.noCandidates"))).toBeTruthy();
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(true);
  });
});

describe("YouTube formu", () => {
  function mockApi(reply: (body: Record<string, unknown>) => Response | Promise<Response> = () => json({ id: "analiz" })) {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        return reply(body);
      }),
    );
    return bodies;
  }
  const submit = () => act(async () => void fireEvent.submit(document.querySelector("form")!));

  it("adres, sayılar, seçenekler ve hak onayı gönderilir; bölüm açılır", async () => {
    const bodies = mockApi();
    renderIn(<YoutubeForm />);
    (document.getElementById("url") as HTMLInputElement).value = "https://youtu.be/dQw4w9WgXcQ";
    (document.getElementById("topic") as HTMLTextAreaElement).value = "Sohbet";
    (document.getElementById("count") as HTMLInputElement).value = "4";
    fireEvent.click(document.querySelector('input[name="transcribe"]')!);
    fireEvent.click(document.querySelector('input[name="rights"]')!);
    await submit();
    expect(bodies[0]).toEqual({
      topic: "Sohbet",
      lang: "tr",
      budgetUsd: 5,
      captions: true,
      music: true,
      sfx: true,
      youtube: { url: "https://youtu.be/dQw4w9WgXcQ", count: 4, minSec: 20, maxSec: 60, transcribe: false, rights: true },
    });
    expect(router.push).toHaveBeenCalledWith("/episodes/analiz");
  });

  it("sunucu hatası gösterilir; ağ düşerse genel hata", async () => {
    let reply: () => Response | Promise<Response> = () => json({ error: "Geçerli bir YouTube video adresi değil: x" }, 400);
    mockApi(() => reply());
    renderIn(<YoutubeForm />);
    await submit();
    expect(screen.getByText("Geçerli bir YouTube video adresi değil: x")).toBeTruthy();
    reply = () => json({}, 500);
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    // JSON olmayan gövde (vekil sunucu sayfası) da genel hata.
    reply = () => new Response("<html>", { status: 502 });
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ağ"))));
    renderIn(<YoutubeForm />, "en");
    await submit();
    expect(screen.getByText(en("form.failed"))).toBeTruthy();
    expect((document.querySelector("button.btn-primary") as HTMLButtonElement).disabled).toBe(false);
  });
});
