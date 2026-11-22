import type { MotionScene } from "@ys/core";
import { staticFile } from "remotion";
import type { colorsOf, safeBox } from "./timing.ts";

/** Dil bileşenlerine verilen ortak bağlam: sahnenin yerel karesi, giriş kareleri, kutu, renkler ve yazı tipleri. */
export interface PartProps {
  scene: MotionScene;
  frame: number;
  frames: number;
  fps: number;
  bpm: number;
  width: number;
  height: number;
  box: ReturnType<typeof safeBox>;
  colors: ReturnType<typeof colorsOf>;
  /** em: kalın harfin ortalama genişliği (yazı boyunun oranı); sığdırma bununla hesaplanır. */
  heading: { family: string; weight: number; em: number };
  body: { family: string; weight: number; em: number };
  lang: string;
  images: readonly string[];
  /** Öğelerin giriş kareleri (enterFrames). */
  enters: readonly number[];
}

/** http(s) ise olduğu gibi, değilse render klasörünün public/ dizininden. */
export const fileSrc = (url: string) => (/^https?:\/\//.test(url) ? url : staticFile(url));

/**
 * Yazı tipinin kalın harf genişliği (em oranı, Türkçe metinde ölçüldü): eşaralıklı yazı daha geniş, Oswald dar. Sabit
 * 0,56 eşaralıklı yazıyı taşırıyordu (gerçek filmde "Yeniden render / mı?" kırıldı, düğüm etiketi kutudan taştı).
 */
export function emOf(face: { id: string; generic: string }): number {
  if (face.generic === "monospace") return 0.64;
  if (face.id === "oswald") return 0.47;
  return face.generic === "serif" ? 0.57 : 0.58;
}

/**
 * Dikey karede satırlar kelime sınırından kayar: tek satıra sığdırmak yatay için yazılmış uzun satırı çok küçültüyordu
 * (gerçek filmin Short'unda "27 dakika beklemek mi?" ~60 px kaldı). En büyük boydan başlayıp %4 küçülterek, en uzun
 * kelime genişliğe ve kaymış satırların toplam yüksekliği kutuya sığana kadar iner (en az 24 px).
 */
export function fitWrapped(lines: readonly string[], width: number, height: number, max: number, perChar: number, lineHeight = 1.12): number {
  for (let size = max; size > 24; size *= 0.96) {
    const char = size * perChar;
    let rows = 0;
    let fits = true;
    for (const line of lines) {
      let used = 0;
      rows++;
      for (const word of line.split(/\s+/).filter(Boolean)) {
        const w = word.length * char;
        if (w > width) fits = false;
        if (used && used + char + w > width) {
          rows++;
          used = w;
        } else used += (used ? char : 0) + w;
      }
    }
    if (fits && rows * size * lineHeight <= height) return Math.round(size);
  }
  return 24;
}

/** Uzun dikey metinde satır başına sığan yazı boyu (px): en uzun satır kutunun genişliğine sığar. */
export function fitSize(lines: readonly string[], width: number, max: number, perChar: number): number {
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return Math.round(Math.min(max, width / (longest * perChar)));
}
