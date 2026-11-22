import type { MessageKey } from "./i18n";

interface KindInput {
  motionMode?: "animated" | "mixed" | "still" | "vector";
  aiClipRatio: number;
  footage?: unknown;
  youtube?: unknown;
  motion?: unknown;
}

/**
 * Bölümün türünün etiketi: film, footage Short'u ve YouTube analizi kendi türüyle, konudan bölüm görsel moduyla anılır
 * (22 Kas: hepsi görsel moduna düşüp "Yaşayan kareler" görünüyordu).
 */
export function kindLabel(input: KindInput): MessageKey {
  if (input.motion) return "film.tab";
  if (input.footage) return "footage.tab.footage";
  if (input.youtube) return "youtube.tab";
  return `motion.${input.motionMode ?? (input.aiClipRatio > 0 ? "mixed" : "still")}`;
}
