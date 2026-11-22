import type { TimelineOverlay } from "@ys/core";
import { revealWindow } from "./kinetic-timing.ts";

/**
 * Ekran yazısı zamanlaması (footage modu, 22 Kas): render (Overlays.tsx) ve efekt sesleri (sfx.ts) aynı hesabı
 * kullanır. Yazı açılır (pop: büyüyerek, kinetic: kelime kelime, typewriter: harf harf; doğal hızında, revealWindow),
 * durur, sonunda kararır.
 */
export const OVERLAY = { popSec: 0.3, popFrom: 0.6, outSec: 0.25 } as const;

/** Yazının açılma süresi (sn): pop'ta büyüme, diğerlerinde revealWindow'un doğal hızı (yazının süresine sığar). */
export function overlayRevealSec(o: Pick<TimelineOverlay, "anim" | "text" | "durationInFrames">, fps: number): number {
  const sec = o.durationInFrames / fps;
  if (o.anim === "pop") return Math.min(sec, OVERLAY.popSec);
  return revealWindow({ type: o.anim, start: 0, end: 1 }, o.text, sec).end * sec;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
/** Hafif taşan yay (easeOutBack). */
const back = (k: number) => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;

export interface OverlayFrame {
  /** Açılma ilerlemesi 0–1 (kinetic için GSAP ilerlemesi, typewriter için gösterilen harf oranı). */
  reveal: number;
  scale: number;
  opacity: number;
}

/** Yazının o karedeki hâli; kare yazının kendi başına göredir (0 = görünmeye başladığı kare). */
export function overlayFrame(o: Pick<TimelineOverlay, "anim" | "text" | "durationInFrames">, frame: number, fps: number): OverlayFrame {
  const t = frame / fps;
  const sec = o.durationInFrames / fps;
  const reveal = clamp(t / Math.max(1 / fps, overlayRevealSec(o, fps)));
  const out = clamp((sec - t) / OVERLAY.outSec);
  if (o.anim !== "pop") return { reveal, scale: 1, opacity: out };
  const k = clamp(t / OVERLAY.popSec);
  return { reveal, scale: OVERLAY.popFrom + (1 - OVERLAY.popFrom) * back(k), opacity: Math.min(clamp(k * 2), out) };
}
