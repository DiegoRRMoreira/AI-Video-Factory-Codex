import { MOTION_FILM, MotionFilm, MotionScene } from "@ys/core";
import { z } from "zod";
import { wordsPerMinute } from "./agents.ts";
import { MOTION_FILM_POLICY } from "./motion-design.ts";
import { models, runStructured, type AgentDeps, type AgentImage, type AgentResult } from "./runner.ts";

/** Yönetmenin çıktısı: film tarifi; "temsili veri" işaretini kod koyar, modelden istenmez. */
export const MotionFilmOut = MotionFilm.extend({
  scenes: z.array(MotionScene.omit({ illustrative: true })).min(1).max(MOTION_FILM.maxScenes).describe("The film in playback order"),
});
export type MotionFilmOut = z.infer<typeof MotionFilmOut>;

export interface MotionDirectInput {
  brief: string;
  lang: string;
  targetSec: number;
  /** Dikey (9:16) mi. */
  tall: boolean;
  narration: boolean;
  /** Kullanıcının marka renkleri (#RRGGBB). */
  colors: string[];
  /** Kullanıcının görselleri (logo, ekran görüntüsü): sırayla ajana gider, sahneler dizinle anar. */
  images: { name: string; image: AgentImage }[];
  /** Düzeltme turu: önceki film ve denetim notları. */
  revise?: { film: MotionFilm; notes: string[] };
}

/**
 * Hareketli grafik filminin yönetmeni (motion modu): brif, marka renkleri ve görsellerden ritim çizelgesi ile sahneleri
 * (JSON) yazar. Çizim, zamanlama, müzik ve denetim koddadır; ajan yalnız tarif verir (modelin kodu çalışmaz).
 */
export function motionDirector(input: MotionDirectInput, deps?: AgentDeps): Promise<AgentResult<MotionFilmOut>> {
  const words = Math.round((input.targetSec * wordsPerMinute({ lang: input.lang })) / 60);
  const narration = input.narration
    ? `Narration is ON: give each scene a "narration" sentence in ${input.lang}, about ${Math.round(words * 0.75)} words in total. Scenes stretch on the beat to fit their sentence, so keep each sentence within the scene's length (about ${(wordsPerMinute({ lang: input.lang }) / 60).toFixed(1)} words per second). On-screen text supports the voice, it does not repeat it word for word.`
    : "Narration is OFF: every narration is empty. The on-screen text, the cuts and the music tell the story.";
  const colors = input.colors.length ? `Brand colours (use them; the accent must be one of them): ${input.colors.join(", ")}.` : "No brand colours given: choose a palette that fits the subject.";
  const images = input.images.length
    ? `Supplied images (attached in this order; refer to them by index in grid cards or the object scene, e.g. a logo in the final object scene):\n${input.images.map((im, i) => `${i}: ${im.name}`).join("\n")}`
    : "No images supplied: do not set any image index.";
  const revise = input.revise ? `\n\nRevise this film. Keep what works and fix these problems found by the code check:\n${input.revise.notes.map((n) => `- ${n}`).join("\n")}\n\nPrevious film:\n${JSON.stringify(input.revise.film)}` : "";
  return runStructured(
    {
      name: "motion-director",
      model: models().fast,
      effort: "medium",
      schema: MotionFilmOut,
      images: input.images.map((im) => im.image),
      system: `You direct short motion-graphics films that code renders frame by frame. You write the plan as JSON; you never write code.
${MOTION_FILM_POLICY}
- Frame: ${input.tall ? "vertical 9:16 (Shorts/Reels): fewer, larger elements; at most 4 grid cards or 5 diagram nodes per scene" : "horizontal 16:9"}.
- Scene length is in beats (one beat = 60 / bpm seconds). Elements of a scene enter one per pace step from the cut, and all must enter within about 70 % of the scene, so a scene needs at least elements × pace beats ÷ 0.7. The code lengthens scenes whose text would not be readable.
- Diagram nodes sit on a 4 × 4 grid (col, row 0-3); left-to-right reading order. Each node id is lowercase.
- Scene ids are m1, m2, … in order. The first scene opens with a plain cut.`,
      prompt: `Brief: ${input.brief}\nLanguage of all on-screen text: ${input.lang}\nTarget length: about ${Math.round(input.targetSec)} s (${MOTION_FILM.minSec}-${MOTION_FILM.maxSec} s allowed)\n${narration}\n${colors}\n${images}${revise}`,
    },
    deps,
  );
}
