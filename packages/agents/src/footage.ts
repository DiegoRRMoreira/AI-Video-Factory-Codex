import { VectorMood, type WordTiming } from "@ys/core";
import { z } from "zod";
import { wordsPerMinute } from "./agents.ts";
import { models, runStructured, type AgentDeps, type AgentImage, type AgentResult } from "./runner.ts";

export const FootageSegmentOut = z.object({
  source: z.string().describe("Source id (f1, f2, ...)"),
  fromSec: z.number().min(0).describe("Start inside the source, seconds (0 for an image)"),
  toSec: z.number().min(0).describe("End inside the source, seconds; for an image the time it stays on screen (2-4 s)"),
  focusX: z
    .number()
    .min(0)
    .max(1)
    .describe("Horizontal position of the subject in the source frame, 0 = left edge, 0.5 = centre, 1 = right edge; a 9:16 crop keeps the part around it"),
  fit: z
    .enum(["cover", "contain"])
    .describe("cover: fill the vertical frame, cropping the sides around focusX (people, single subjects); contain: show the whole frame over a blurred copy (wide scenery, screens, text, several subjects far apart)"),
  audio: z
    .enum(["original", "ambient", "mute"])
    .describe("original: the source's own sound is the point (someone speaking, a reaction, music on stage) and plays at full level; ambient: its sound plays quietly under the narration; mute: silent. Images and silent videos are always mute"),
  why: z.string().describe("English, a few words: what this part shows"),
});

export const FootageEditOut = z.object({
  title: z.string().max(100).describe("Working title in the episode language, under 60 characters"),
  beats: z
    .array(
      z.object({
        narration: z
          .string()
          .describe("Voice-over for this beat in the episode language, spoken over its segments. Empty when narration is off or when an 'original' segment carries the beat with its own speech"),
        mood: VectorMood.describe("Music feel for this beat"),
        segments: z.array(FootageSegmentOut).min(1).max(4),
      }),
    )
    .min(1)
    .max(14)
    .describe("The Short in playback order: first beat is the hook, last one the payoff"),
  overlays: z
    .array(
      z.object({
        text: z.string().max(60).describe("On-screen text in the episode language; the user's own texts verbatim"),
        style: z.enum(["hook", "title", "label", "cta"]).describe("hook: the big opening line (beat 1 only); title: a section heading; label: names a person, place or thing; cta: a closing call to action (last beat only)"),
        beat: z.number().int().min(1).describe("1-based number of the beat it appears on"),
        position: z.enum(["top", "center", "bottom"]).describe("Keep text off faces; captions run along the bottom"),
      }),
    )
    .max(8),
});
export type FootageEditOut = z.infer<typeof FootageEditOut>;

export interface FootageEditSource {
  id: string;
  name: string;
  kind: "video" | "image";
  durationSec: number;
  width: number;
  height: number;
  audio: boolean;
  /** Örneklenen kareler (sırayla, ajana giden görseller bunlar). */
  frames: { atSec: number; image: AgentImage }[];
  /** Kaynağın konuşma dökümü (STT açıksa). */
  words?: WordTiming[];
}

export interface FootageEditInput {
  brief: string;
  lang: string;
  targetSec: number;
  narration: boolean;
  /** Kullanıcının ekranda görmek istediği yazılar (aynen). */
  texts: string[];
  sources: FootageEditSource[];
}

/** Dökümü zaman damgalı satırlara böler (ajan konuşmanın nerede başlayıp bittiğini görsün). */
export function transcriptLines(words: WordTiming[], gapMs = 700): string {
  const lines: string[] = [];
  let line: WordTiming[] = [];
  const flush = () => {
    if (line.length) lines.push(`  [${(line[0]!.startMs / 1000).toFixed(1)}–${(line.at(-1)!.endMs / 1000).toFixed(1)}] ${line.map((w) => w.text).join(" ")}`);
    line = [];
  };
  for (const w of words) {
    if (line.length && w.startMs - line.at(-1)!.endMs > gapMs) flush();
    line.push(w);
  }
  flush();
  return lines.join("\n");
}

/**
 * Kurgu ajanı (footage modu): kullanıcının videolarından ve resimlerinden istenen sürede dikey bir Short kurar. Kareleri
 * ve konuşma dökümünü görür; parçaları, kadraj odağını, sesi, anlatımı ve ekran yazılarını seçer. Süreler, kaynak
 * sınırları ve ses kuralları kodda zorlanır (pipeline footage.ts); burada yalnız kurgu kararları.
 */
export function footageEditor(input: FootageEditInput, deps?: AgentDeps): Promise<AgentResult<FootageEditOut>> {
  const images: AgentImage[] = [];
  const sources = input.sources
    .map((s) => {
      const first = images.length + 1;
      images.push(...s.frames.map((f) => f.image));
      const frames = s.frames.length
        ? `  frames: images ${first}–${images.length} at ${s.frames.map((f) => `${f.atSec.toFixed(1)}s`).join(", ")}`
        : "  frames: none";
      const head = `${s.id} "${s.name}": ${s.kind}, ${s.width}×${s.height}${s.kind === "video" ? `, ${s.durationSec.toFixed(1)} s, ${s.audio ? "has sound" : "silent"}` : ""}`;
      const speech = s.words?.length ? `\n  speech:\n${transcriptLines(s.words)}` : s.kind === "video" && s.audio && s.words ? "\n  speech: none detected" : "";
      return `${head}\n${frames}${speech}`;
    })
    .join("\n\n");
  const words = Math.round((input.targetSec * wordsPerMinute({ lang: input.lang })) / 60);
  const narration = input.narration
    ? `Narration is ON: write a voice-over in ${input.lang}, about ${Math.round(words * 0.8)} words in total for the whole Short (it is spoken at a normal pace; leave room for 'original' beats). Short sentences, concrete, no filler; the first line is a hook.`
    : "Narration is OFF: every beat's narration is empty. Let the footage, its own sound and the on-screen texts tell the story.";
  const texts = input.texts.length ? `The user's own on-screen texts, use each one verbatim as an overlay where it fits:\n${input.texts.map((t) => `- ${t}`).join("\n")}` : "The user gave no on-screen texts.";
  return runStructured(
    {
      name: "footage-editor",
      model: models().fast,
      effort: "medium",
      schema: FootageEditOut,
      images,
      system: `You are a short-form video editor. From the user's own videos and images you cut one vertical 9:16 Short (YouTube Shorts, Reels, TikTok) of the requested length.
- Open on the strongest moment: the first 2 seconds decide whether people keep watching. End on a payoff.
- Use only what the frames and speech show; never invent events. Prefer moments with clear action, faces and reactions; skip shaky, blurry, dark or empty stretches.
- Segments are 1.5-6 s, sources may be reused at different times, keep a steady rhythm. Never cut through the middle of a spoken sentence you keep as 'original': start and end it on the speech line boundaries given.
- The frame is vertical: give focusX where the main subject sits in the source; use 'contain' when cropping would lose what matters.
- On-screen texts are short (2-6 words), never cover faces, at most one hook and one call to action.
- All times are inside the given source durations.`,
      prompt: `Brief: ${input.brief}\nLanguage: ${input.lang}\nTarget length: ${Math.round(input.targetSec)} s\n${narration}\n${texts}\n\nSources (frames are attached in this order):\n${sources}`,
    },
    deps,
  );
}

export const FootageCheckOut = z.object({
  parts: z.array(
    z.object({
      id: z.string().describe("Part id as given"),
      evidence: z.string().describe("English, one sentence: what the vertical frame shows of the main subject compared with the source frame"),
      verdict: z
        .enum(["ok", "subject_cut", "empty"])
        .describe("ok: the main subject is whole and readable in the vertical frame; subject_cut: the crop cuts off or loses the main subject (a face, a person, the key object, on-screen text) that the source frame shows; empty: the frame is black, blurred or shows nothing"),
      focusX: z.number().min(0).max(1).describe("Horizontal position of the main subject in the SOURCE frame, 0 = left edge, 1 = right edge"),
      fit: z.enum(["cover", "contain"]).describe("cover if the subject fits in a 9:16 crop around focusX; contain if it is wider (several people far apart, a wide scene, a screen or text) and needs the whole frame"),
    }),
  ),
});
export type FootageCheckOut = z.infer<typeof FootageCheckOut>;

export interface FootageCheckPart {
  id: string;
  why: string;
  /** Kesilmiş dikey parçanın ortasından kare. */
  cut: AgentImage;
  /** Aynı anın kaynak karesi (yatay olabilir). */
  source: AgentImage;
}

/**
 * Footage kare denetçisi (ucuz katman): her parçanın dikey karesini kaynağın aynı anıyla karşılaştırır; kırpma özneyi
 * keserse öznenin kaynaktaki yerini ve uygun kadrajı söyler (düzeltmeyi kod uygular, parça yeniden kesilir).
 */
export function footageInspector(parts: FootageCheckPart[], deps?: AgentDeps): Promise<AgentResult<FootageCheckOut>> {
  return runStructured(
    {
      name: "footage-inspector",
      model: models().cheap,
      effort: "low",
      schema: FootageCheckOut,
      images: parts.flatMap((p) => [p.source, p.cut]),
      system: `You check the vertical 9:16 crops of a Short cut from the user's own footage. For each part you get two images: first the SOURCE frame, then the VERTICAL frame made from it. Judge only framing: is the main subject (what the part is about) whole and readable in the vertical frame? Write the evidence first, then the verdict; the verdict must follow the evidence. Always give where the main subject sits horizontally in the source frame and whether it fits a 9:16 crop.`,
      prompt: `Parts (images come in pairs in this order: source, vertical):\n${parts.map((p, i) => `${i + 1}. ${p.id}: ${p.why || "no description"} (images ${2 * i + 1}–${2 * i + 2})`).join("\n")}`,
    },
    deps,
  );
}
