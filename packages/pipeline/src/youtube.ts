import type { YoutubeShortsOut, YoutubeWindowOut } from "@ys/agents";
import { LocalizedError, msg, type VectorMood, type WordTiming } from "@ys/core";
import { FOOTAGE, normalizePlan, type FootagePlan, type FootageSource } from "./footage.ts";

/**
 * YouTube'dan Short (22 Kas, kullanıcı: "YouTube URL'si verince indirip analiz ettirip hangi sahnede ne var, nereleri
 * kesmek gerek, nereden Short üretilir bulsun"). Sıra: yt-dlp videoyu, bilgi JSON'unu (bölümler, tekrar izlenme grafiği)
 * ve altyazıyı indirir → sahne kesimleri, kareler, sessizlikler ölçülür → video pencerelere bölünür, analist her pencereyi
 * kontakt sayfalarıyla inceler → seçici adayları sıralar → seçilen her aday ayrı bir footage Short bölümü olur. Bu dosya
 * saf hesaptır; yt-dlp ve ffmpeg adımları youtube-media.ts'te.
 */

export const YOUTUBE = {
  /** İndirilecek en uzun video (dk; YS_YOUTUBE_MAX_MIN ile değişir): 1080p bir saat ~1-2 GB. */
  maxMin: 90,
  /** Dikey kırpma 1080p'nin üçte birini kullanır: daha düşük çözünürlük Short'ta bulanık kalır. */
  height: 1080,
  /** İndirme 403 ile düşerse toplam deneme (akış adresi her çağrıda yenilenir). */
  downloadTries: 2,
  /** ffmpeg sahne puanı eşiği ve en kısa sahne (daha kısası öncekine katılır: flaş, hızlı kurgu). */
  sceneThreshold: 0.35,
  minSceneMs: 1500,
  /** Uzun sahnede bu aralıkla ek kare (konuşan kafa tek sahne olur ama içerik değişir). */
  extraEveryMs: 20_000,
  /** Analiz penceresi: süre ve kare sınırı (kare fazlaysa eşit aralıkla seyreltilir). */
  windowMs: 6 * 60_000,
  windowFrames: 48,
  /** Kontakt sayfası: 4×3 ızgara, hücre 320×180. */
  sheet: { cols: 4, rows: 3, width: 320, height: 180 },
  /** Analiste bildirilen en kısa sessizlik. */
  silenceMs: 1500,
  /** Aynı anda çalışan pencere analizi. */
  concurrency: 2,
  /** Aday sayısı ve Short süresi varsayılanları/sınırları. */
  count: 6,
  maxCount: 12,
  minSec: 20,
  maxSec: 60,
  /** Ardışık parçalar arasındaki bu kadar kısa boşluk birleşir. */
  joinMs: 400,
  /** İki aday bu oranda örtüşürse puanı düşük olan atılır. */
  overlap: 0.4,
  /** Tekrar izlenme grafiğinde analiste giden en çok nokta ve seçiciye giden zirve. */
  heatPoints: 24,
  heatPeaks: 8,
  /** Short bölümüne kopyalanan döküm payı (parça kenarlarının dışı). */
  wordPadMs: 1000,
};

export const youtubeMaxMs = () => Math.max(1, Number(process.env.YS_YOUTUBE_MAX_MIN) || YOUTUBE.maxMin) * 60_000;

export interface YoutubeInput {
  /** Kanonik adres (https://www.youtube.com/watch?v=<id>). */
  url: string;
  videoId: string;
  /** İstenen aday sayısı. */
  count: number;
  /** Short süresi sınırları (sn). */
  minSec: number;
  maxSec: number;
  /** Altyazı yoksa konuşma tanıma (STT, ücretli olabilir) kullanılsın mı. */
  transcribe?: boolean;
}

/** Analiz bölümünün ilerlemesi ve raporu (her alt adımdan sonra kaydedilir; yarıda kalan iş kaldığı yerden sürer). */
export interface YoutubeState {
  meta?: YoutubeMeta;
  /** Seçilen altyazı; null: video altyazı sunmuyor. */
  captions?: { lang: string; auto: boolean } | null;
  video?: { key: string; durationMs: number; width: number; height: number; audio: boolean };
  /** Döküm (kelimeler kütüphanede, durum dosyası küçük kalsın). */
  transcript?: { key?: string; source: "manual" | "auto" | "stt" | "none"; words: number };
  scenes?: YoutubeScene[];
  frames?: YoutubeFrame[];
  silences?: { fromMs: number; toMs: number }[];
  /** Biten pencere analizleri (parmak iziyle). */
  windows?: { sig: string; out: YoutubeWindowOut }[];
  report?: YoutubeReport;
  /** Bu analizden üretilen Short bölümleri. */
  shorts?: { candidate: string; episodeId: string }[];
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be", "www.youtu.be"]);

/**
 * YouTube adresini (watch, shorts, live, embed, youtu.be ya da çıplak kimlik) kanonik adrese çevirir. yt-dlp'ye yalnız bu
 * kanonik adres gider: kullanıcı girdisi seçenek olarak yorumlanamaz, başka siteye istek gitmez.
 */
export function parseYoutubeUrl(raw: string): { videoId: string; url: string } | undefined {
  const text = raw.trim();
  let id: string | undefined;
  if (VIDEO_ID.test(text)) id = text;
  else {
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
      return undefined;
    }
    if (!/^https?:$/.test(u.protocol) || !HOSTS.has(u.hostname.toLowerCase())) return undefined;
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname.toLowerCase().endsWith("youtu.be")) id = parts[0];
    else if (parts[0] === "watch") id = u.searchParams.get("v") ?? undefined;
    else if (["shorts", "live", "embed", "v"].includes(parts[0] ?? "")) id = parts[1];
  }
  return id && VIDEO_ID.test(id) ? { videoId: id, url: `https://www.youtube.com/watch?v=${id}` } : undefined;
}

/** Analiz bölümünün girdisi: adres doğrulanır, sayılar sınırlara çekilir. */
export function youtubeInput(raw: { url: string; count?: number; minSec?: number; maxSec?: number; transcribe?: boolean }): YoutubeInput {
  const parsed = parseYoutubeUrl(raw.url);
  if (!parsed) throw new LocalizedError(msg("err.youtube.url", { url: raw.url.slice(0, 200) }));
  const minSec = Math.round(clamp(raw.minSec ?? YOUTUBE.minSec, FOOTAGE.minSec, FOOTAGE.maxSec));
  const maxSec = Math.round(clamp(raw.maxSec ?? YOUTUBE.maxSec, minSec, FOOTAGE.maxSec));
  return { ...parsed, count: Math.round(clamp(raw.count ?? YOUTUBE.count, 1, YOUTUBE.maxCount)), minSec, maxSec, ...(raw.transcribe === false ? { transcribe: false } : {}) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface YoutubeMeta {
  videoId: string;
  title: string;
  channel: string;
  durationMs: number;
  width: number;
  height: number;
  /** Videonun dili (yt-dlp `language`), bilinmiyorsa yok. */
  language?: string;
  description: string;
  chapters: { fromMs: number; toMs: number; title: string }[];
  heatmap: { fromMs: number; toMs: number; value: number }[];
}

/** yt-dlp bilgi JSON'unun kullanılan kısmı (`-J`). */
export interface YtInfo {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  width?: number;
  height?: number;
  language?: string | null;
  description?: string;
  is_live?: boolean;
  chapters?: { start_time?: number; end_time?: number; title?: string }[] | null;
  heatmap?: { start_time?: number; end_time?: number; value?: number }[] | null;
  subtitles?: Record<string, unknown[]> | null;
  automatic_captions?: Record<string, unknown[]> | null;
}

const ms = (sec: number | undefined) => Math.round((sec ?? 0) * 1000);

/** Bilgi JSON'undan analizin kullandığı alanlar; canlı yayın ve süresiz video reddedilir. */
export function metaOf(info: YtInfo, videoId: string): YoutubeMeta {
  if (info.is_live || !(Number(info.duration) > 0)) throw new LocalizedError(msg("err.youtube.live"));
  const durationMs = ms(info.duration);
  return {
    videoId,
    title: (info.title ?? videoId).slice(0, 300),
    channel: (info.channel ?? info.uploader ?? "").slice(0, 200),
    durationMs,
    width: info.width ?? 0,
    height: info.height ?? 0,
    ...(info.language ? { language: info.language } : {}),
    description: (info.description ?? "").slice(0, 2000),
    chapters: (info.chapters ?? []).map((c) => ({ fromMs: ms(c.start_time), toMs: Math.min(durationMs, ms(c.end_time)), title: (c.title ?? "").slice(0, 200) })),
    heatmap: (info.heatmap ?? []).map((h) => ({ fromMs: ms(h.start_time), toMs: Math.min(durationMs, ms(h.end_time)), value: clamp(h.value ?? 0, 0, 1) })),
  };
}

/**
 * Hangi altyazı indirilir: videonun dilinde elle yazılmış, yoksa bölüm dilinde elle yazılmış, yoksa videonun dilindeki
 * otomatik altyazı (YouTube'da özgün dil `<dil>-orig` ya da `<dil>`), yoksa bölüm dilinde otomatik. Çevrilmiş otomatik
 * altyazılar zaman damgası taşısa da çeviridir: alınmaz.
 */
export function pickCaptions(info: YtInfo, lang: string): { lang: string; auto: boolean } | undefined {
  const base = (l: string) => l.toLowerCase().split(/[-_]/)[0]!;
  const manual = Object.keys(info.subtitles ?? {}).filter((l) => l !== "live_chat");
  const auto = Object.keys(info.automatic_captions ?? {});
  const spoken = info.language ? base(info.language) : undefined;
  const find = (list: string[], want: string | undefined) => (want ? (list.find((l) => l.toLowerCase() === want) ?? list.find((l) => base(l) === want)) : undefined);
  const hand = find(manual, spoken) ?? find(manual, base(lang));
  if (hand) return { lang: hand, auto: false };
  const orig = auto.find((l) => l.endsWith("-orig") && (!spoken || base(l) === spoken)) ?? (spoken ? auto.find((l) => l.toLowerCase() === spoken) : undefined);
  const machine = orig ?? (spoken ? undefined : auto.find((l) => l.toLowerCase() === base(lang)));
  return machine ? { lang: machine, auto: true } : undefined;
}

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; aAppend?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[];
}

/**
 * YouTube json3 altyazısını kelime zamanlarına çevirir. Otomatik altyazıda her parçanın kendi zamanı var; elle
 * yazılmışta satır bir parçadır, süresi kelimelere harf sayısıyla bölünür. Kelime, sonrakinin başına kadar sürer.
 */
export function parseJson3(text: string): WordTiming[] {
  let data: Json3;
  try {
    data = JSON.parse(text) as Json3;
  } catch {
    return [];
  }
  const out: WordTiming[] = [];
  for (const ev of data.events ?? []) {
    const start = ev.tStartMs ?? 0;
    const end = start + (ev.dDurationMs ?? 0);
    const segs = (ev.segs ?? []).filter((s) => (s.utf8 ?? "").trim());
    segs.forEach((seg, i) => {
      const from = start + (seg.tOffsetMs ?? 0);
      const to = i + 1 < segs.length ? start + (segs[i + 1]!.tOffsetMs ?? 0) : end;
      const words = seg.utf8!.replace(/\s+/g, " ").trim().split(" ");
      const letters = words.reduce((n, w) => n + w.length, 0);
      let at = from;
      for (const w of words) {
        const len = to > from ? ((to - from) * w.length) / letters : 0;
        out.push({ text: w, startMs: Math.round(at), endMs: Math.round(at + len) });
        at += len;
      }
    });
  }
  // Yuvarlanan (kayan) otomatik altyazı olaylarında aynı kelime iki kez gelebilir: başlangıcı aynı olan tekrar atılır.
  const words = out.sort((a, b) => a.startMs - b.startMs).filter((w, i, all) => i === 0 || w.startMs !== all[i - 1]!.startMs || w.text !== all[i - 1]!.text);
  // Kelime sonrakinin başlangıcını geçmez (örtüşen olaylar).
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (next && w.endMs > next.startMs) w.endMs = Math.max(w.startMs, next.startMs);
  });
  return words;
}

export interface YoutubeScene {
  fromMs: number;
  toMs: number;
}

/** ffmpeg'in sahne kesim anlarından sahneler; çok kısa sahne sonrakine katılır (videonun sonundaki öncekine). */
export function scenesFrom(cutsMs: number[], durationMs: number): YoutubeScene[] {
  const edges = [...new Set(cutsMs.map((c) => Math.round(c)).filter((c) => c > 0 && c < durationMs))].sort((a, b) => a - b);
  const scenes: YoutubeScene[] = [];
  let from = 0;
  for (const at of [...edges, durationMs]) {
    if (at - from < YOUTUBE.minSceneMs && at < durationMs) continue;
    if (at - from < YOUTUBE.minSceneMs && scenes.length) scenes.at(-1)!.toMs = at;
    else scenes.push({ fromMs: from, toMs: at });
    from = at;
  }
  return scenes;
}

/** Sahnenin kare anları: ortası, uzun sahnede ayrıca her `extraEveryMs`. */
export function sceneFrameTimes(scene: YoutubeScene): number[] {
  const len = scene.toMs - scene.fromMs;
  const n = Math.max(1, Math.round(len / YOUTUBE.extraEveryMs));
  return Array.from({ length: n }, (_, i) => Math.round(scene.fromMs + ((i + 0.5) * len) / n));
}

export interface YoutubeFrame {
  atMs: number;
  /** Sahnenin sırası (1'den). */
  scene: number;
  key: string;
}

export interface YoutubeWindow {
  fromMs: number;
  toMs: number;
  frames: YoutubeFrame[];
}

/**
 * Pencereler: sahneler sırayla `windowMs`'i doldurana kadar aynı pencereye girer (sahne bölünmez; tek sahne pencereden
 * uzunsa kendi penceresidir). Kare sınırını aşan pencere eşit aralıkla seyreltilir.
 */
export function planWindows(scenes: YoutubeScene[], frames: YoutubeFrame[]): YoutubeWindow[] {
  const windows: YoutubeWindow[] = [];
  for (const [i, s] of scenes.entries()) {
    const last = windows.at(-1);
    const own = frames.filter((f) => f.scene === i + 1);
    if (last && s.toMs - last.fromMs <= YOUTUBE.windowMs) {
      last.toMs = s.toMs;
      last.frames.push(...own);
    } else windows.push({ fromMs: s.fromMs, toMs: s.toMs, frames: own });
  }
  for (const w of windows) {
    if (w.frames.length <= YOUTUBE.windowFrames) continue;
    const step = w.frames.length / YOUTUBE.windowFrames;
    w.frames = Array.from({ length: YOUTUBE.windowFrames }, (_, i) => w.frames[Math.floor(i * step)]!);
  }
  return windows;
}

/** Kareleri kontakt sayfalarına böler (sayfa başına cols × rows). */
export function sheetsOf<T>(frames: T[]): T[][] {
  const per = YOUTUBE.sheet.cols * YOUTUBE.sheet.rows;
  return Array.from({ length: Math.ceil(frames.length / per) }, (_, i) => frames.slice(i * per, (i + 1) * per));
}

/** Tekrar izlenme grafiğinin pencereye düşen kısmı, en çok `heatPoints` noktaya ortalanarak. */
export function heatmapIn(heatmap: YoutubeMeta["heatmap"], fromMs: number, toMs: number): { atSec: number; value: number }[] {
  const inside = heatmap.filter((h) => h.toMs > fromMs && h.fromMs < toMs);
  const group = Math.max(1, Math.ceil(inside.length / YOUTUBE.heatPoints));
  const out: { atSec: number; value: number }[] = [];
  for (let i = 0; i < inside.length; i += group) {
    const part = inside.slice(i, i + group);
    out.push({ atSec: (part[0]!.fromMs + part.at(-1)!.toMs) / 2000, value: part.reduce((n, h) => n + h.value, 0) / part.length });
  }
  return out;
}

/** Grafiğin en yüksek `heatPeaks` noktası (seçiciye). */
export function heatPeaks(heatmap: YoutubeMeta["heatmap"]): { atSec: number; value: number }[] {
  return [...heatmap]
    .sort((a, b) => b.value - a.value)
    .slice(0, YOUTUBE.heatPeaks)
    .map((h) => ({ atSec: (h.fromMs + h.toMs) / 2000, value: h.value }))
    .sort((a, b) => a.atSec - b.atSec);
}

export interface YoutubeCandidate {
  /** c1, c2 … (sıra = seçicinin sırası, en iyi ilk). */
  id: string;
  title: string;
  hook: string;
  why: string;
  score: number;
  mood: VectorMood;
  segments: { fromMs: number; toMs: number; focusX: number; fit: "cover" | "contain" }[];
  durationMs: number;
}

/** Kenarı kelimenin içine düşen parça kelime sınırına çekilir: başlangıç kelimenin başına, son kelimenin sonuna. */
function snap(at: number, words: WordTiming[], edge: "start" | "end"): number {
  const inside = words.find((w) => w.startMs < at && at < w.endMs);
  return inside ? (edge === "start" ? inside.startMs : inside.endMs) : at;
}

const lengthOf = (segs: { fromMs: number; toMs: number }[]) => segs.reduce((n, s) => n + s.toMs - s.fromMs, 0);

/**
 * Seçicinin adaylarını kurallara uydurur: parçalar videonun içinde ve kelime sınırında, çok yakın parçalar birleşir,
 * çok kısalar atılır; toplam süre sınırı aşarsa sondan kırpılır, altında kalırsa son parça videoda ilerleyerek uzar
 * (yetmezse aday atılır); başka bir adayla çok örtüşen düşük puanlı aday atılır.
 */
export function normalizeCandidates(out: YoutubeShortsOut, meta: YoutubeMeta, words: WordTiming[], input: Pick<YoutubeInput, "count" | "minSec" | "maxSec">): YoutubeCandidate[] {
  const minMs = input.minSec * 1000;
  const maxMs = input.maxSec * 1000;
  const kept: YoutubeCandidate[] = [];
  const ranked = out.candidates.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i);
  for (const { c } of ranked) {
    let segs = c.segments
      .map((s) => {
        const fromMs = clamp(snap(ms(s.fromSec), words, "start"), 0, meta.durationMs);
        const toMs = clamp(snap(ms(s.toSec), words, "end"), 0, meta.durationMs);
        return { fromMs, toMs, focusX: clamp(s.focusX, 0, 1), fit: s.fit };
      })
      .filter((s) => s.toMs - s.fromMs >= FOOTAGE.minSegMs);
    segs = segs.reduce<typeof segs>((acc, s) => {
      const prev = acc.at(-1);
      if (prev && s.fromMs >= prev.fromMs && s.fromMs <= prev.toMs + YOUTUBE.joinMs) prev.toMs = Math.max(prev.toMs, s.toMs);
      else acc.push({ ...s });
      return acc;
    }, []);
    if (!segs.length) continue;
    // Uzunsa sondan kırp (son parça en az minSegMs kalmazsa atılır).
    while (lengthOf(segs) > maxMs) {
      const last = segs.at(-1)!;
      const over = lengthOf(segs) - maxMs;
      if (last.toMs - last.fromMs - over >= FOOTAGE.minSegMs) last.toMs -= over;
      else segs.pop();
    }
    // Kısaysa son parça ilerler, video biterse ilk parça geriye uzar.
    const short = minMs - lengthOf(segs);
    if (short > 0) {
      const last = segs.at(-1)!;
      const forward = Math.min(short, meta.durationMs - last.toMs);
      last.toMs += forward;
      segs[0]!.fromMs = Math.max(0, segs[0]!.fromMs - (short - forward));
    }
    if (!segs.length || lengthOf(segs) < minMs) continue;
    const overlaps = kept.some((k) => {
      let shared = 0;
      for (const a of segs) for (const b of k.segments) shared += Math.max(0, Math.min(a.toMs, b.toMs) - Math.max(a.fromMs, b.fromMs));
      return shared > YOUTUBE.overlap * Math.min(lengthOf(segs), k.durationMs);
    });
    if (overlaps) continue;
    kept.push({ id: "", title: c.title.trim(), hook: c.hook.trim(), why: c.why.trim(), score: c.score, mood: c.mood, segments: segs, durationMs: lengthOf(segs) });
    if (kept.length >= input.count) break;
  }
  return kept.map((k, i) => ({ ...k, id: `c${i + 1}` }));
}

/** Pencere çıktılarının birleşik raporu (Stüdyo'da sahne günlüğü ve kesim önerileri). */
export interface YoutubeReport {
  scenes: (YoutubeWindowOut["scenes"][number] & { frameKey?: string })[];
  cuts: YoutubeWindowOut["cuts"];
  moments: YoutubeWindowOut["moments"];
  candidates: YoutubeCandidate[];
}

/** Pencere çıktılarını zaman sırasıyla birleştirir; sahneye kendi aralığındaki ilk kareyi bağlar (Stüdyo'da küçük resim). */
export function mergeWindows(outs: YoutubeWindowOut[], frames: YoutubeFrame[], durationMs: number): Omit<YoutubeReport, "candidates"> {
  const within = <T extends { fromSec: number; toSec: number }>(list: T[]) =>
    list
      .map((x) => ({ ...x, fromSec: clamp(x.fromSec, 0, durationMs / 1000), toSec: clamp(x.toSec, 0, durationMs / 1000) }))
      .filter((x) => x.toSec > x.fromSec)
      .sort((a, b) => a.fromSec - b.fromSec);
  const scenes = within(outs.flatMap((o) => o.scenes)).map((s) => {
    const frame = frames.find((f) => f.atMs >= s.fromSec * 1000 && f.atMs < s.toSec * 1000);
    return frame ? { ...s, frameKey: frame.key } : s;
  });
  return { scenes, cuts: within(outs.flatMap((o) => o.cuts)), moments: within(outs.flatMap((o) => o.moments)) };
}

/** Adayın kurgusu: anlatımsız, özgün sesli; en çok dört parçalık vuruşlar, ilk vuruşta kanca yazısı. */
export function candidatePlan(c: YoutubeCandidate, source: FootageSource): FootagePlan {
  const beats: { narration: string; mood: VectorMood; segments: { source: string; fromSec: number; toSec: number; focusX: number; fit: "cover" | "contain"; audio: "original"; why: string }[] }[] = [];
  for (let i = 0; i < c.segments.length; i += 4) {
    beats.push({
      narration: "",
      mood: c.mood,
      segments: c.segments.slice(i, i + 4).map((s) => ({ source: source.id, fromSec: s.fromMs / 1000, toSec: s.toMs / 1000, focusX: s.focusX, fit: s.fit, audio: "original" as const, why: c.title })),
    });
  }
  const overlays = c.hook ? [{ text: c.hook.slice(0, 60), style: "hook" as const, beat: 1, position: "top" as const }] : [];
  return normalizePlan({ title: c.title, beats, overlays }, { sources: [source], narration: false, transcribe: false, texts: [] }, { addMissingTexts: false });
}

/** Adayın parçalarına (payla) düşen kelimeler: Short bölümünün altyazısı bunlardan. */
export function candidateWords(words: WordTiming[], c: YoutubeCandidate): WordTiming[] {
  return words.filter((w) => c.segments.some((s) => w.endMs > s.fromMs - YOUTUBE.wordPadMs && w.startMs < s.toMs + YOUTUBE.wordPadMs));
}
