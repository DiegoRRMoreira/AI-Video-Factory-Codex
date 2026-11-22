import { beatSec, PACE_BEATS, VERTICAL_SAFE, type MotionCamera, type MotionPalette, type MotionScene } from "@ys/core";

/**
 * Hareketli grafik filminin saf zamanlamaları: render bileşenleri (Film.tsx), ses efektleri (sfx.ts) ve film denetimi
 * (lint.ts) aynı hesabı kullanır. Her şey sahnenin yerel karesinin saf fonksiyonudur (paralel sekmeler aynı kareyi verir).
 * Ölçüler huashu-motion'un ölçtüklerinden ve HyperFrames kayıt öğelerinden (headline-slam, whip-pan-cut, count-up,
 * grid-card-assemble) uyarlandı; kodları kopyalanmadı.
 */
export const FILM = {
  /** Giriş süresi (sn): sert ease-out (expo) teknolojiyi okutur; yumuşak 0,6–0,8 sn uyutur (rhythm.md §4). */
  enterSec: 0.34,
  /** Öğelerin hepsi sahnenin bu kadarında girmiş olur: son öğe de okunacak kadar kalsın. */
  fill: 0.7,
  /** Başlık düşüşü: 1,6'dan 1'e (headline-slam), oturunca üç karelik sarsıntı (genişliğin %'si). */
  slamFrom: 1.6,
  shake: [0.55, -0.38, 0] as const,
  /** Geçişlerin kendi çizdiği örtüler (kare): parlama, taşma, renk dönüşü. */
  flashFrames: 7,
  floodFrames: 11,
  flipFrames: 6,
  /** punch kamerası ikinci vuruşta bu kadar yaklaşır (4 karede). */
  punch: 1.22,
  /** Sayı sayarken son 0,15 sn'de hafifçe büyüyüp oturur (count-up). */
  countSec: 0.9,
  /** Yazı okunma süresi: kelime başına 0,25 sn + 0,5 sn (huashu director). */
  holdPerWord: 0.25,
  holdBase: 0.5,
  /** Paket noktası bir kenarı bu kadar vuruşta geçer. */
  packetBeats: 2,
  /**
   * Son öğenin oturma süresi (sn): girişi (enterSec), vurgu kutusunun gecikmeli açılışı (enterSec × 1,5 + 0,4 sn) ve
   * sayacın sayışı (countSec) bunun içinde biter. İnceleme karesi bundan önce alınmaz.
   */
  settle: 0.95,
  /** İnceleme karesinin en erken anı (sahnenin kesri): öğeler sığmak için sıkışmışsa da son öğe okunur hâlde olsun. */
  still: 0.8,
} as const;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const expoOut = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * clamp01(t)));
/** Bir vuruşun karesi. */
export const beatFrames = (bpm: number, fps: number) => beatSec(bpm) * fps;

/** Metindeki kelimeler. */
export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** Sahnede sırayla giren öğe sayısı (dile göre); zamanlamanın ve denetimin ortak sayımı. */
export function unitsOf(scene: MotionScene): number {
  switch (scene.language) {
    case "kinetic": {
      const k = scene.kinetic!;
      if (k.mode === "words") return k.lines.reduce((n, l) => n + wordsOf(l).length, 0);
      return k.mode === "chapter" ? 1 + k.lines.length : k.lines.length;
    }
    case "data": {
      const d = scene.data!;
      return 1 + (d.chart === "count" ? 1 : d.points.length) + (d.callout ? 1 : 0);
    }
    case "diagram":
      return scene.diagram!.nodes.length + scene.diagram!.edges.length;
    case "grid":
      return scene.grid!.cards.length + (scene.grid!.title && scene.grid!.mode === "grid" ? 1 : 0);
    case "field":
      return [scene.field!.title, scene.field!.subtitle].filter(Boolean).length;
    case "object":
      return [scene.object!.title ?? (scene.object!.image !== undefined ? "img" : undefined), scene.object!.caption].filter(Boolean).length;
  }
}

/**
 * Öğelerin giriş kareleri (sahne başından): ilki kesmede, sonrakiler sahnenin temposu (pace) aralıkla vuruşlarda. Hepsi
 * sahnenin FILM.fill'ine sığmazsa aralık sıkışır (vuruştan kayar; denetim bunu söyler).
 */
export function enterFrames(scene: MotionScene, frames: number, bpm: number, fps: number, units = unitsOf(scene)): number[] {
  if (!units) return [];
  const step = PACE_BEATS[scene.pace] * beatFrames(bpm, fps);
  const room = (frames * FILM.fill) / Math.max(1, units - 1);
  const gap = units > 1 ? Math.min(step, room) : step;
  return Array.from({ length: units }, (_, i) => Math.round(i * gap));
}

/**
 * Film sahnesinin inceleme karesi (sahnenin kesri): bütün öğeler girip oturduktan sonra (son giriş + FILM.settle), en
 * erken FILM.still, en geç son kare. Vektör çekimlerin anı (stillMoment) film sahnesine bakamaz: %80'de kısa bir sahnenin
 * son öğesi daha girerken ya da sayacı sayarken yakalanır, denetçi "eksik" sanardı.
 */
export function filmStill(scene: MotionScene, frames: number, bpm: number, fps: number): number {
  const last = Math.max(0, ...enterFrames(scene, frames, bpm, fps));
  return Math.min(1 - 1 / frames, Math.max(FILM.still, (last + FILM.settle * fps + 1) / frames));
}

/** Öğenin giriş ilerlemesi (0–1, expo): giriş karesinden FILM.enterSec içinde. */
export const enterK = (frame: number, at: number, fps: number) => expoOut((frame - at) / (FILM.enterSec * fps));

/** Kameranın bu karedeki ölçeği ve yatay kayması (genişliğin oranı). */
export function cameraAt(camera: MotionCamera, frame: number, frames: number, bpm: number, fps: number): { scale: number; x: number } {
  const k = clamp01(frame / Math.max(1, frames));
  switch (camera) {
    case "still":
      return { scale: 1, x: 0 };
    case "push":
      return { scale: 1 + 0.07 * k, x: 0 };
    case "pull":
      return { scale: 1.12 - 0.12 * expoOut(k * 1.6), x: 0 };
    case "drift":
      return { scale: 1.04, x: 0.018 - 0.036 * k };
    case "punch": {
      const at = beatFrames(bpm, fps);
      return { scale: 1 + (FILM.punch - 1) * expoOut((frame - at) / 4), x: 0 };
    }
  }
}

/** Kameranın en büyük ölçeği: içerik bu kadar büyüdüğünde de kutuya sığmalı (punch tam genişlikteki yazıyı kesiyordu). */
export const CAMERA_MAX: Record<MotionCamera, number> = { still: 1, push: 1.07, pull: 1.12, drift: 1.04 + 0.036, punch: FILM.punch };

/** Başlık düşüşlerinin sarsıntısı (genişliğin %'si): her inişten sonraki üç karede. */
export function shakeAt(lands: readonly number[], frame: number): number {
  for (const at of lands) {
    const i = frame - at;
    if (i >= 0 && i < FILM.shake.length) return FILM.shake[i]!;
  }
  return 0;
}

/** Hex rengin göreli parlaklığı (WCAG). */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** İki rengin karşıtlık oranı (WCAG, 1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** Sahnenin renkleri: zemin, yazı, vurgu ve vurgunun üstündeki yazı. Vurgu zemininde yazı daha okunan uçtan seçilir. */
export function colorsOf(ground: MotionScene["ground"], p: MotionPalette): { bg: string; fg: string; accent: string; onAccent: string; card: string } {
  const pick = (bg: string, a: string, b: string) => (contrast(bg, a) >= contrast(bg, b) ? a : b);
  const onAccent = pick(p.accent, p.ink, p.ground);
  if (ground === "ink") return { bg: p.ink, fg: p.ground, accent: p.accent, onAccent, card: p.alt };
  if (ground === "accent") {
    const fg = onAccent;
    // Vurgu zemininde vurgu rengi kaybolur: vurgu yazının rengine döner.
    return { bg: p.accent, fg, accent: fg, onAccent: p.accent, card: p.alt };
  }
  return { bg: p.ground, fg: p.ink, accent: p.accent, onAccent, card: p.alt };
}

/** İçeriğin güvenli kutusu (px): dikeyde Shorts/Reels arayüzünün dışı, yatayda altyazı payı. */
export function safeBox(width: number, height: number, captions: boolean): { x: number; y: number; w: number; h: number } {
  if (height > width) {
    const x = 64;
    const y = VERTICAL_SAFE.top;
    return { x, y, w: width - x - VERTICAL_SAFE.right, h: height - y - VERTICAL_SAFE.bottom };
  }
  const x = Math.round(width * 0.07);
  const y = Math.round(height * 0.1);
  return { x, y, w: width - 2 * x, h: height - y - Math.round(height * (captions ? 0.2 : 0.1)) };
}

/** Sayının gösterimi: ondalık basamak, binlik ayırıcı dilin kuralıyla. */
export function formatValue(v: number, decimals: number, lang: string): string {
  return new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

/** Sayacın bu karedeki değeri: giriş karesinden FILM.countSec içinde ease-out ile. */
export function countAt(from: number, to: number, frame: number, at: number, fps: number): number {
  const k = 1 - (1 - clamp01((frame - at) / (FILM.countSec * fps))) ** 3;
  return from + (to - from) * k;
}
