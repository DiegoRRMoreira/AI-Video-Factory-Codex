// @vitest-environment happy-dom
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { Timeline, VERTICAL_SAFE, type TimelineOverlay } from "@ys/core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ frame: 0, fps: 30, width: 1080, height: 1920 }));
vi.mock("remotion", async (orig) => ({
  ...(await orig<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: clock.fps, width: clock.width, height: clock.height, durationInFrames: 300 }),
  staticFile: (p: string) => `/public/${p}`,
  Sequence: (p: { from: number; durationInFrames: number; name: string; children: ReactNode }) => (
    <section data-from={p.from} data-duration={p.durationInFrames} data-name={p.name}>
      {p.children}
    </section>
  ),
  OffthreadVideo: (p: { src: string }) => <video data-kind="video" src={p.src} />,
  Img: (p: { src: string }) => <img src={p.src} />,
  Audio: (p: { src: string; volume: number }) => <audio data-kind="audio" src={p.src} data-volume={p.volume} />,
}));

const { Overlays, overlayBox, OVERLAY_LOOK, CAPTION_CLEAR } = await import("../src/Overlays.tsx");
const { OVERLAY, overlayFrame, overlayRevealSec } = await import("../src/overlay-timing.ts");
const { Episode } = await import("../src/Episode.tsx");
const { sfxEvents } = await import("../src/sfx.ts");
const { musicSections } = await import("../src/music.ts");
const { chunkKeys, chunkRanges } = await import("../src/chunks.ts");

afterEach(() => {
  cleanup();
  clock.frame = 0;
  clock.width = 1080;
  clock.height = 1920;
});

const ov = (over: Partial<TimelineOverlay> = {}): TimelineOverlay => ({ text: "Yola çıktık bugün", style: "hook", fromFrame: 0, durationInFrames: 90, position: "top", anim: "pop", ...over });

describe("ekran yazısı zamanlaması", () => {
  it("pop büyüyerek açılır, sonunda kararır; diğerleri doğal hızında açılır", () => {
    expect(overlayRevealSec(ov(), 30)).toBe(OVERLAY.popSec);
    expect(overlayRevealSec(ov({ durationInFrames: 6 }), 30)).toBeCloseTo(0.2);
    expect(overlayRevealSec(ov({ anim: "typewriter", text: "x".repeat(16) }), 30)).toBeCloseTo(1);
    expect(overlayRevealSec(ov({ anim: "typewriter", text: "x".repeat(160), durationInFrames: 30 }), 30)).toBeCloseTo(1);
    const start = overlayFrame(ov(), 0, 30);
    expect([start.reveal, start.opacity]).toEqual([0, 0]);
    expect(start.scale).toBeCloseTo(OVERLAY.popFrom);
    const open = overlayFrame(ov(), 9, 30);
    expect(open.scale).toBeCloseTo(1);
    expect(open.opacity).toBe(1);
    expect(overlayFrame(ov(), 90, 30).opacity).toBe(0);
    const typing = overlayFrame(ov({ anim: "typewriter", text: "x".repeat(16) }), 15, 30);
    expect(typing).toEqual({ reveal: 0.5, scale: 1, opacity: 1 });
  });
});

describe("ekran yazısı bileşeni", () => {
  const draw = (node: ReactNode, frame = 0) => {
    clock.frame = frame;
    return render(<>{node}</>).container;
  };

  it("dikeyde güvenli alanda: üstte, ortada, altta altyazının üstünde; yatayda kenar payı", () => {
    expect(overlayBox("top", 1080, 1920)).toMatchObject({ top: VERTICAL_SAFE.top + 40, left: VERTICAL_SAFE.right + 10, right: VERTICAL_SAFE.right + 10 });
    expect(overlayBox("bottom", 1080, 1920)).toMatchObject({ bottom: VERTICAL_SAFE.bottom + 20 + CAPTION_CLEAR });
    expect(overlayBox("center", 1080, 1920)).toMatchObject({ top: 0, bottom: 0, alignItems: "center" });
    expect(overlayBox("top", 1920, 1080)).toMatchObject({ top: 80, left: 192 });
    expect(overlayBox("bottom", 1920, 1080)).toMatchObject({ bottom: 90 + CAPTION_CLEAR });
  });

  it("pop, daktilo ve kinetik yazı; tipografi varsa yazı ailesi", () => {
    const overlays = [ov(), ov({ style: "label", anim: "typewriter", text: "abcd", fromFrame: 0 }), ov({ style: "title", anim: "kinetic", text: "iki kelime" })];
    const c = draw(<Overlays overlays={overlays} typography={{ pair: "clear" }} />, 9);
    const spans = [...c.querySelectorAll("[data-overlay] > span")] as HTMLElement[];
    expect(spans.map((s) => s.parentElement!.dataset.overlay)).toEqual(["hook", "label", "title"]);
    expect(spans[0]!.style.background).toBe(OVERLAY_LOOK.hook.plate);
    expect(spans[1]!.textContent).toBe("abcd");
    expect(spans[2]!.querySelectorAll("[data-word]")).toHaveLength(2);
    expect(spans[0]!.style.fontFamily).not.toContain("Segoe");
    expect(c.querySelectorAll("section")[1]!.dataset.name).toBe("text-label");
  });

  it("daktilonun ilk karesinde yazı yok; tipografisiz düz yazı ailesi", () => {
    const c = draw(<Overlays overlays={[ov({ style: "cta", anim: "typewriter", text: "Abone ol" }), ov({ style: "label" })]} />, 0);
    expect(c.querySelector("[data-overlay='cta'] > span")).toBeNull();
    expect((c.querySelector("[data-overlay='label'] > span") as HTMLElement).style.fontFamily).toContain("Segoe");
  });

  it("bölüm yazıları altyazıyla birlikte çizer; yazısız timeline'da katman yok; footage parçası video olarak oynar", () => {
    const t = Timeline.parse({
      episodeId: "e",
      lang: "tr",
      width: 1080,
      height: 1920,
      durationInFrames: 90,
      visuals: [{ shotId: "b1-sh1", assetUrl: "cut.mp4", kind: "footage", fromFrame: 0, durationInFrames: 90, mood: "warm" }],
      audio: [{ role: "source", assetUrl: "a.wav", fromFrame: 0, durationInFrames: 90, volume: 0.15 }],
      overlays: [ov()],
    });
    const c = draw(<Episode timeline={t} />, 10);
    expect(c.querySelector("[data-overlay='hook']")).toBeTruthy();
    expect(c.querySelector("video")!.getAttribute("src")).toBe("/public/cut.mp4");
    expect(c.querySelector("audio")!.dataset.volume).toBe("0.15");
    cleanup();
    expect(draw(<Episode timeline={{ ...t, overlays: undefined }} />, 10).querySelector("[data-overlay]")).toBeNull();
  });
});

describe("footage sesleri, müzik ve önbellek", () => {
  const visual = (shotId: string, fromFrame: number, extra: object = {}) => ({ shotId, assetUrl: "x.mp4", kind: "footage", fromFrame, durationInFrames: 60, ...extra });
  const tl = (extra: object) => Timeline.parse({ episodeId: "e", lang: "tr", durationInFrames: 240, audio: [], visuals: [], ...extra });

  it("vuruş geçişinde vınlama (havası olan vektörsüz çekim), yazı açılışında pop, daktilo ve kinetik sesleri", () => {
    const events = sfxEvents(
      tl({
        visuals: [visual("b1-sh1", 0, { mood: "warm" }), visual("b1-sh2", 60, { mood: "warm" }), visual("b2-sh1", 120, { mood: "night" }), visual("arch", 180, { kind: "still_motion" })],
        overlays: [ov({ fromFrame: 30 }), ov({ anim: "typewriter", text: "ab", fromFrame: 60 }), ov({ anim: "kinetic", text: "bir iki", fromFrame: 90 })],
      }),
    );
    expect(events.filter((e) => e.sound === "whoosh" && e.pitch === 0.9).map((e) => e.frame)).toEqual([120]);
    expect(events.filter((e) => e.sound === "pop").map((e) => e.frame)).toEqual([30]);
    expect(events.filter((e) => e.sound === "type")).toHaveLength(2);
    expect(events.filter((e) => e.sound === "tick")).toHaveLength(2);
    expect(events.find((e) => e.sound === "whoosh" && e.pitch === 1.4)!.frame).toBe(90);
  });

  it("vektörsüz çekimin havası müziğe geçer", () => {
    expect(musicSections(tl({ durationInFrames: 30 * 40, visuals: [visual("b1-sh1", 0, { mood: "night", durationInFrames: 30 * 40 })] }))).toEqual([{ fromFrame: 0, frames: 1200, mood: "night" }]);
  });

  it("yazı yalnız göründüğü parçanın anahtarını değiştirir; yazısız timeline'ın anahtarı eskisiyle aynı", async () => {
    const pub = mkdtempSync(join(tmpdir(), "ys-ov-"));
    const t = tl({ visuals: [visual("b1-sh1", 0), visual("b2-sh1", 60, { durationInFrames: 180 })] });
    const plain = await chunkKeys(t, chunkRanges(t), pub, "c");
    const empty = await chunkKeys({ ...t, overlays: [] }, chunkRanges(t), pub, "c");
    const withText = await chunkKeys({ ...t, overlays: [ov({ fromFrame: 70, durationInFrames: 30 })] }, chunkRanges(t), pub, "c");
    expect(empty).toEqual(plain);
    expect(withText[0]).toBe(plain[0]);
    expect(withText[1]).not.toBe(plain[1]);
  });
});
