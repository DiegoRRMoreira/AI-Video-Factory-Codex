import { VectorMood, type WordTiming } from "@ys/core";
import { z } from "zod";
import { transcriptLines } from "./footage.ts";
import { models, runStructured, type AgentDeps, type AgentImage, type AgentResult } from "./runner.ts";

/**
 * YouTube'dan Short (22 Kas, kullanıcı: "YouTube URL'si verince videoyu indirip istediğim modelle analiz ettirip hangi
 * sahnede ne var, nereleri kesmek gerek, nereden Short üretilir bulsun"). Uzun video pencerelere bölünür: analist her
 * pencerenin kontakt sayfalarına (zaman damgalı kare ızgarası), konuşma dökümüne, tekrar izlenme grafiğine ve
 * sessizliklere bakar; seçici bütün pencerelerin adaylarını birleştirip sıralar. Süreler, sınırlar ve kelime sınırına
 * oturtma kodda (pipeline youtube.ts).
 */

export const YoutubeWindowOut = z.object({
  scenes: z
    .array(
      z.object({
        fromSec: z.number().min(0),
        toSec: z.number().min(0),
        summary: z.string().describe("What happens, in the episode language, one or two sentences"),
        people: z.string().describe("Who is on screen and what they do (no names unless shown or said), empty if nobody"),
        onScreenText: z.string().describe("Readable on-screen text or slides, empty if none"),
        energy: z.number().int().min(1).max(5).describe("1 = static, slow or empty; 5 = peak action, laughter, reveal"),
        quality: z.enum(["good", "shaky", "dark", "blurry", "static", "low_res"]).describe("Picture quality of the stretch"),
      }),
    )
    .describe("Every stretch of the window in order, merging contact-sheet cells that show the same scene"),
  cuts: z
    .array(
      z.object({
        fromSec: z.number().min(0),
        toSec: z.number().min(0),
        reason: z.enum(["dead_air", "filler", "repetition", "off_topic", "technical", "intro_outro", "sponsor"]),
        note: z.string().describe("Episode language, a few words"),
      }),
    )
    .describe("Stretches a tighter edit of the long video would cut"),
  moments: z
    .array(
      z.object({
        fromSec: z.number().min(0),
        toSec: z.number().min(0),
        title: z.string().max(100).describe("Episode language, what the Short would be called"),
        hook: z.string().max(60).describe("Episode language, 2-6 word on-screen hook for the first seconds"),
        why: z.string().describe("Episode language: why it works on its own as a Short"),
        score: z.number().int().min(1).max(10).describe("How strong it is as a standalone Short"),
        focusX: z.number().min(0).max(1).describe("Horizontal position of the main subject in the frame, 0 = left, 1 = right"),
        fit: z.enum(["cover", "contain"]).describe("cover if the subject fits a 9:16 crop around focusX, contain if the whole frame matters"),
      }),
    )
    .describe("Self-contained moments that could open or be a Short: a complete thought, a reaction, a reveal, a punchline"),
});
export type YoutubeWindowOut = z.infer<typeof YoutubeWindowOut>;

export interface YoutubeWindowInput {
  lang: string;
  title: string;
  /** Pencerenin videodaki yeri. */
  fromSec: number;
  toSec: number;
  durationSec: number;
  /** Kontakt sayfaları: her biri `cells` karelik ızgara, soldan sağa, yukarıdan aşağıya. */
  sheets: { image: AgentImage; cells: { atSec: number; scene: number }[] }[];
  words: WordTiming[];
  /** "Tekrar izlenme" grafiği (0-1), yoksa boş. */
  heatmap: { atSec: number; value: number }[];
  chapters: { fromSec: number; title: string }[];
  silences: { fromSec: number; toSec: number }[];
  shortSec: { min: number; max: number };
}

const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

/** Pencere analisti: kontakt sayfaları + döküm → sahneler, kesilecek yerler, Short anları. */
export function youtubeAnalyst(input: YoutubeWindowInput, deps?: AgentDeps): Promise<AgentResult<YoutubeWindowOut>> {
  const sheets = input.sheets
    .map((s, i) => `Sheet ${i + 1}: ${s.cells.map((c, j) => `#${j + 1} ${c.atSec.toFixed(1)}s (scene ${c.scene})`).join(", ")}`)
    .join("\n");
  const speech = input.words.length ? transcriptLines(input.words) : "  (no speech found)";
  const heat = input.heatmap.length
    ? `Replay graph (how often viewers rewatch each moment, 0-1): ${input.heatmap.map((h) => `${h.atSec.toFixed(0)}s=${h.value.toFixed(2)}`).join(" ")}`
    : "No replay graph.";
  const chapters = input.chapters.length ? `Chapters: ${input.chapters.map((c) => `${c.fromSec.toFixed(0)}s "${c.title}"`).join(", ")}` : "No chapters.";
  const silences = input.silences.length ? `Silences: ${input.silences.map((s) => `${s.fromSec.toFixed(1)}-${s.toSec.toFixed(1)}s`).join(", ")}` : "No long silences.";
  return runStructured(
    {
      name: "youtube-analyst",
      model: models().fast,
      effort: "medium",
      schema: YoutubeWindowOut,
      images: input.sheets.map((s) => s.image),
      system: `You analyse one window of a long video to log its scenes, find what a tighter edit would cut, and find moments that work as vertical Shorts.
- Each attached image is a contact sheet: a grid of frames read left to right, top to bottom; the cell list says each frame's time and scene number.
- Use only what the frames and the transcript show. Never invent events, names or quotes.
- All times are seconds from the start of the whole video and stay inside the window.
- A Short moment must stand on its own without the rest of the video: a complete thought, a question and its answer, a reaction, a reveal, a punchline. It starts on the first word of a sentence and ends after the last word of one, using the transcript times. Prefer ${input.shortSec.min}-${input.shortSec.max} s; a strong moment may be shorter if a neighbouring window continues it.
- Replay graph peaks show what viewers rewatch; chapters show the video's own structure.
- Write summaries, notes, titles and hooks in ${input.lang}.`,
      prompt: `Video: "${input.title}" (${clock(input.durationSec)} long)
Window: ${clock(input.fromSec)} to ${clock(input.toSec)} (${input.fromSec.toFixed(1)}-${input.toSec.toFixed(1)} s)

Contact sheets (attached in this order):
${sheets}

Transcript:
${speech}

${heat}
${chapters}
${silences}`,
    },
    deps,
  );
}

export const YoutubeShortsOut = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().max(100).describe("Episode language, under 60 characters"),
        hook: z.string().max(60).describe("Episode language, 2-6 word on-screen hook for the first seconds"),
        why: z.string().describe("Episode language: why this works as a Short"),
        score: z.number().int().min(1).max(10),
        mood: VectorMood.describe("Music feel"),
        segments: z
          .array(
            z.object({
              fromSec: z.number().min(0),
              toSec: z.number().min(0),
              focusX: z.number().min(0).max(1),
              fit: z.enum(["cover", "contain"]),
            }),
          )
          .min(1)
          .max(8)
          .describe("Parts of the long video in playback order; several parts cut out filler inside the moment (jump cuts)"),
      }),
    )
    .describe("Best first"),
});
export type YoutubeShortsOut = z.infer<typeof YoutubeShortsOut>;

export interface YoutubeCuratorInput {
  lang: string;
  title: string;
  durationSec: number;
  count: number;
  shortSec: { min: number; max: number };
  /** Pencerelerin anları (zaman sırasıyla). */
  moments: YoutubeWindowOut["moments"];
  /** Sahne günlüğünün kısa hâli: zaman + özet + enerji. */
  scenes: { fromSec: number; toSec: number; summary: string; energy: number }[];
  /** Pencerelerin kesilecek yerleri (Short'un içinden de atılabilir). */
  cuts: YoutubeWindowOut["cuts"];
  heatmapPeaks: { atSec: number; value: number }[];
}

/** Seçici: pencerelerin anlarını birleştirir (pencere sınırında bölünenleri), en iyi N Short'u kurar ve sıralar. */
export function youtubeCurator(input: YoutubeCuratorInput, deps?: AgentDeps): Promise<AgentResult<YoutubeShortsOut>> {
  const moments = input.moments.map((m) => `- ${m.fromSec.toFixed(1)}-${m.toSec.toFixed(1)}s [${m.score}/10] ${m.title}: ${m.why} (hook "${m.hook}", focusX ${m.focusX}, ${m.fit})`).join("\n");
  const scenes = input.scenes.map((s) => `- ${s.fromSec.toFixed(0)}-${s.toSec.toFixed(0)}s (energy ${s.energy}) ${s.summary}`).join("\n");
  const cuts = input.cuts.map((c) => `- ${c.fromSec.toFixed(1)}-${c.toSec.toFixed(1)}s ${c.reason}: ${c.note}`).join("\n");
  const peaks = input.heatmapPeaks.length ? input.heatmapPeaks.map((p) => `${p.atSec.toFixed(0)}s (${p.value.toFixed(2)})`).join(", ") : "none";
  return runStructured(
    {
      name: "youtube-curator",
      model: models().fast,
      effort: "medium",
      schema: YoutubeShortsOut,
      system: `You pick the best vertical Shorts from a long video, using an analyst's notes on each part of it.
- Return up to ${input.count} candidates, best first, that do not overlap each other.
- Each is ${input.shortSec.min}-${input.shortSec.max} s in total. Join moments split across a window boundary into one; drop filler inside a candidate by splitting it into parts (jump cuts) only where a sentence ends.
- The first seconds must hook: open on the strongest line or image, not on a greeting or a setup.
- Use only times from the notes; never invent content. Titles and hooks in ${input.lang}.`,
      prompt: `Video: "${input.title}" (${input.durationSec.toFixed(0)} s)

Moments found:
${moments || "- none"}

Scene log:
${scenes || "- none"}

Stretches to cut:
${cuts || "- none"}

Replay peaks: ${peaks}`,
    },
    deps,
  );
}
