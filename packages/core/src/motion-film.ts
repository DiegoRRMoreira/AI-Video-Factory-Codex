import { z } from "zod";
import { PARTICLE_EFFECTS, THREE_PRESETS } from "./effects.ts";
import { Typography } from "./typography.ts";

/**
 * Hareketli grafik filmi (22 Kas, kullanıcı: "bizde olmayan bu motion hareketli ... insan görünümleri de olmayan, svg
 * çizimden başka bir video yapma hattı"; fikir huashu-motion'dan, kod ve metin bizim): insan figürü ve model SVG'si yok,
 * her şey koddan çizilir. Yönetmen ajanı bu tarifi (JSON) yazar, kod çizer; modelin kodu hiç çalışmaz. Zaman vuruştur:
 * sahneler vuruş sayısıyla, öğeler sahnenin temposuyla (pace) vuruşlara oturur; müzik aynı ızgarada çalar, kesmeler vuruşta.
 */

/** Ölçülmüş varsayılanlar (huashu-motion rhythm.md, 21 lansman filmi, 2026-10): tempo 100–125 olağan, 89–130 ölçüldü. */
export const MOTION_FILM = {
  bpm: { min: 88, max: 140, default: 116 },
  beatsPerBar: 4,
  minSec: 10,
  maxSec: 180,
  maxScenes: 40,
  /** Sahne uzunluğu (vuruş). */
  sceneBeats: { min: 1, max: 32 },
} as const;

/** Hareket dili: ne söylediği (kinetic: iddia, data: kanıt, diagram: parçalar nasıl bağlı, grid: liste/çeşitlilik, field: hava, object: somut nesne). */
export const MotionLanguage = z.enum(["kinetic", "data", "diagram", "grid", "field", "object"]);
export type MotionLanguage = z.infer<typeof MotionLanguage>;

/** Sahneye giriş: cut (sert, vuruşta), flash (beyaz parlama), flip (renk alanı döner), flood (vurgu rengi taşar), iris, whip (savrulma), push (içinden geçme). */
export const MotionTransition = z.enum(["cut", "flash", "flip", "flood", "iris", "whip", "push"]);
export type MotionTransition = z.infer<typeof MotionTransition>;

/** Kamera: still, push (yavaş yaklaşma), pull (geri çekilme), drift (yana kayma), punch (ikinci vuruşta sert 1,25× yaklaşma). */
export const MotionCamera = z.enum(["still", "push", "pull", "drift", "punch"]);
export type MotionCamera = z.infer<typeof MotionCamera>;

/** Öğelerin vuruş aralığı: eighth (yarım vuruş, patlama), beat, half (iki vuruş), bar (ölçü). */
export const MotionPace = z.enum(["eighth", "beat", "half", "bar"]);
export type MotionPace = z.infer<typeof MotionPace>;
export const PACE_BEATS: Record<MotionPace, number> = { eighth: 0.5, beat: 1, half: 2, bar: 4 };

/** Zemin: paletin zemini, mürekkep (ters, koyu/açık döner) ya da vurgu rengi (renk alanı). */
export const MotionGround = z.enum(["ground", "ink", "accent"]);
export type MotionGround = z.infer<typeof MotionGround>;

/** Sahne başında vurgu sesi (sfx.ts). */
export const MotionHit = z.enum(["none", "hit", "impact", "riser", "subdrop", "whoosh", "pop"]);
export type MotionHit = z.infer<typeof MotionHit>;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const short = (max: number) => z.string().trim().min(1).max(max);

export const MotionKinetic = z.object({
  lines: z.array(short(48)).min(1).max(4).describe("1-4 short lines, at most ~6 words each, in the episode language"),
  mode: z.enum(["slam", "rise", "words", "chapter"]).describe("slam: lines scale down hard onto the frame; rise: lines rise out of a mask; words: one word per pace step; chapter: a big counter with a label"),
  highlight: z.string().max(40).optional().describe("One word or phrase from the lines to put in an accent pill"),
  chapter: z.object({ index: z.number().int().min(1).max(20), total: z.number().int().min(1).max(20) }).optional(),
});
export type MotionKinetic = z.infer<typeof MotionKinetic>;

export const MotionPoint = z.object({ label: short(28), value: z.number().finite() });

export const MotionData = z.object({
  chart: z.enum(["bars", "line", "count"]).describe("bars from zero; a line that draws then marks its point; or one number counting up"),
  title: short(60),
  unit: z.string().max(12).optional().describe("Unit after values, e.g. %, ms, M"),
  points: z.array(MotionPoint).max(8).default([]).describe("bars/line: 2-8 points in order"),
  highlight: z.number().int().min(0).max(7).optional().describe("Index of the point the scene is about"),
  callout: z.string().max(60).optional().describe("Short note that lands on the highlighted point"),
  count: z
    .object({ to: z.number().finite(), from: z.number().finite().default(0), decimals: z.number().int().min(0).max(2).default(0), prefix: z.string().max(4).default(""), suffix: z.string().max(8).default("") })
    .optional(),
  source: z.string().max(80).optional().describe("Where the numbers come from, only if the brief names it"),
});
export type MotionData = z.infer<typeof MotionData>;

export const MotionNode = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,16}$/),
  label: short(24),
  col: z.number().int().min(0).max(3),
  row: z.number().int().min(0).max(3),
});
export const MotionDiagram = z.object({
  nodes: z.array(MotionNode).min(2).max(8),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().max(20).optional() })).max(10).default([]),
  packets: z.boolean().default(true).describe("Dots travel along the edges once they are drawn"),
  highlight: z.string().optional().describe("Node id that lights up last"),
  title: z.string().max(60).optional(),
});
export type MotionDiagram = z.infer<typeof MotionDiagram>;

export const MotionCard = z.object({
  title: short(32),
  body: z.string().max(70).optional(),
  stat: z.string().max(12).optional().describe("A short figure on the card, only from the brief"),
  image: z.number().int().min(0).max(11).optional().describe("Index of a supplied image (logo/screenshot) shown in the card"),
});
export const MotionGrid = z.object({
  cards: z.array(MotionCard).min(1).max(9),
  mode: z.enum(["grid", "montage"]).default("grid").describe("grid: cards assemble into a grid; montage: one card fills the frame per pace step, cut on the beat"),
  title: z.string().max(60).optional(),
});
export type MotionGrid = z.infer<typeof MotionGrid>;

export const MotionField = z.object({
  kind: z.enum(PARTICLE_EFFECTS),
  title: z.string().max(48).optional(),
  subtitle: z.string().max(70).optional(),
});
export type MotionField = z.infer<typeof MotionField>;

export const MotionObject = z.object({
  preset: z.enum(THREE_PRESETS),
  title: z.string().max(48).optional(),
  caption: z.string().max(70).optional(),
  image: z.number().int().min(0).max(11).optional().describe("A supplied image (logo) shown at the object's centre instead of a title"),
});
export type MotionObject = z.infer<typeof MotionObject>;

export const MotionScene = z.object({
  id: z.string().regex(/^m\d{1,2}$/).describe("m1, m2, … in order"),
  language: MotionLanguage,
  beats: z.number().int().min(MOTION_FILM.sceneBeats.min).max(MOTION_FILM.sceneBeats.max),
  pace: MotionPace.default("beat"),
  transition: MotionTransition.default("cut"),
  camera: MotionCamera.default("still"),
  ground: MotionGround.default("ground"),
  hit: MotionHit.default("none"),
  kinetic: MotionKinetic.optional(),
  data: MotionData.optional(),
  diagram: MotionDiagram.optional(),
  grid: MotionGrid.optional(),
  field: MotionField.optional(),
  object: MotionObject.optional(),
  /** Anlatım açıksa bu sahnede söylenen cümle (bölüm dilinde). */
  narration: z.string().max(400).default(""),
  /** Kod doldurur: veri brifte yoksa sahne "temsili veri" rozeti taşır. */
  illustrative: z.boolean().optional(),
});
export type MotionScene = z.infer<typeof MotionScene>;

/** Ritim çizelgesindeki bir bölüm: kanca, kurulum, duruş, zirve, çözülme; uzunluğu ölçü, enerjisi 0–10. */
export const MotionSection = z.object({
  name: z.enum(["hook", "build", "stop", "peak", "resolve"]),
  bars: z.number().int().min(1).max(32),
  energy: z.number().int().min(0).max(10),
});
export type MotionSection = z.infer<typeof MotionSection>;

export const MotionPalette = z.object({ ground: hex, ink: hex, accent: hex, alt: hex.describe("A second ground for colour flips") });
export type MotionPalette = z.infer<typeof MotionPalette>;

export const MotionFilm = z.object({
  title: short(80),
  bpm: z.number().int().min(MOTION_FILM.bpm.min).max(MOTION_FILM.bpm.max),
  route: z.enum(["continuous", "montage", "hybrid"]),
  palette: MotionPalette,
  type: Typography.shape.pair,
  sections: z.array(MotionSection).min(1).max(12).describe("Rhythm sheet in playback order; its bars should cover the whole film"),
  scenes: z.array(MotionScene).min(1).max(MOTION_FILM.maxScenes),
});
export type MotionFilm = z.infer<typeof MotionFilm>;

/** Timeline'da filmin bütününe ait görünüm (her sahne kendi visual'ında). Görseller render klasörüne kopyalanan yollardır. */
export const MotionLook = z.object({
  bpm: z.number().positive(),
  palette: MotionPalette,
  type: Typography.shape.pair,
  images: z.array(z.string()).default([]),
  /** Ritim çizelgesi: müzik bölümleri bunlardan (video/src/motion-film/score.ts). */
  sections: z.array(MotionSection).default([]),
});
export type MotionLook = z.infer<typeof MotionLook>;

/** Sahnenin dili ile içeriği uyuşuyor mu (yönetmen JSON şeması bunu zorlayamaz; normalizasyon uymayanı atar). */
export function sceneContent(scene: MotionScene): boolean {
  switch (scene.language) {
    case "kinetic":
      return !!scene.kinetic;
    case "data":
      return !!scene.data && (scene.data.chart === "count" ? !!scene.data.count : scene.data.points.length >= 2);
    case "diagram":
      return !!scene.diagram;
    case "grid":
      return !!scene.grid;
    case "field":
      return !!scene.field;
    case "object":
      return !!scene.object;
  }
}

/** Bir vuruşun saniyesi. */
export const beatSec = (bpm: number) => 60 / bpm;

/**
 * Sahnelerin kareleri: sınırlar vuruş ızgarasından yuvarlanır (birikmiş vuruştan), böylece uzun filmde kayma birikmez ve
 * her kesme bir vuruşun en yakın karesindedir.
 */
export function sceneFrames(scenes: readonly { beats: number }[], bpm: number, fps: number): { fromFrame: number; frames: number }[] {
  const at = (beat: number) => Math.round(beat * beatSec(bpm) * fps);
  let beat = 0;
  return scenes.map((s) => {
    const from = at(beat);
    beat += s.beats;
    return { fromFrame: from, frames: Math.max(1, at(beat) - from) };
  });
}
