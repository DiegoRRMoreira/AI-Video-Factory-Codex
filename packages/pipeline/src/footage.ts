import type { FootageEditOut } from "@ys/agents";
import { LocalizedError, msg, type Timeline, type TimelineOverlay, type VectorMood, type WordTiming } from "@ys/core";

/**
 * Footage modu (22 Kas, kullanıcı: "kaynak video ve resim vererek istenen süreli dikey short, üstünde altyazı, yazı ve
 * ses"): kullanıcının kendi videoları ve resimleri dikey bir Short'a kurgulanır. Sıra: kaynaklar ölçülür, kareler
 * örneklenir, konuşma dökülür (story aşaması) → kurgu ajanı parçaları, anlatımı ve yazıları seçer (script, onay kapısı)
 * → anlatım seslendirilir (voice) → vuruşlar ses süresine ve hedefe oturtulur (shots) → parçalar kesilir (clips) →
 * timeline (altyazı, ekran yazıları, kaynak ses, müzik, efekt) → render. Bu dosya saf hesaptır; ffmpeg adımları
 * footage-media.ts'te.
 */

export interface FootageSource {
  /** f1, f2 … (ajan bu kimlikle anar). */
  id: string;
  /** Depo anahtarı (assets/footage/<bölüm>/…). */
  key: string;
  /** Kullanıcının dosya adı (ajana bağlam, Stüdyo'da görünür). */
  name: string;
  ext: string;
  kind: "video" | "image";
  /** Videonun süresi; resimde 0. */
  durationMs: number;
  width: number;
  height: number;
  /** Videoda ses akışı var mı. */
  audio: boolean;
}

export interface FootageInput {
  sources: FootageSource[];
  /** Yapay anlatım (TTS) yazılsın mı. */
  narration: boolean;
  /** Kaynak videoların konuşması yazıya dökülsün mü (STT; altyazı ve kurgu için). */
  transcribe: boolean;
  /** Kullanıcının ekranda görmek istediği yazılar (aynen kullanılır). */
  texts: string[];
  /**
   * Stüdyo'dan yüklenmiş, henüz ölçülmemiş dosyalar (uploads/footage/…): Stüdyo ffprobe çalıştırmaz (Remotion yüklemez);
   * bölümün ilk aşaması ölçüp bölüme alır, bekleme alanından siler.
   */
  pending?: { key: string; name: string }[];
}

/** Stüdyo'nun yükleme bekleme alanı: içerik adresli, izinli uzantı. */
export const UPLOAD_KEY = /^uploads\/footage\/[0-9a-f]{24}\.(mp4|mov|webm|mkv|m4v|jpg|jpeg|png|webp)$/;

/** Kabul edilen kaynak türleri: uzantı → MIME. Başka biçim yüklenmez (ffmpeg'in her şeyi açması güvenlik yüzeyi). */
export const FOOTAGE_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4v: "video/x-m4v",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
export type FootageExt = keyof typeof FOOTAGE_TYPES;
export const isFootageExt = (ext: string): ext is FootageExt => Object.hasOwn(FOOTAGE_TYPES, ext);
export const footageKindOf = (ext: FootageExt): "video" | "image" => (FOOTAGE_TYPES[ext].startsWith("image/") ? "image" : "video");

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/**
 * Dosyanın ilk baytları uzantısına uyuyor mu (yükleme bekleme alanına girmeden; asıl ölçüm ffprobe ile bölümde).
 * MP4/MOV ailesinde ikinci kutu adı (ftyp, eski QuickTime'da moov/mdat/wide/free), Matroska/WebM'de EBML, resimlerde
 * kendi imzaları.
 */
export function sniffFootage(head: Uint8Array, ext: string): boolean {
  switch (ext) {
    case "mp4":
    case "m4v":
      return ascii(head, 4, 8) === "ftyp";
    case "mov":
      return ["ftyp", "moov", "mdat", "wide", "free"].includes(ascii(head, 4, 8));
    case "webm":
    case "mkv":
      return starts(head, [0x1a, 0x45, 0xdf, 0xa3]);
    case "jpg":
    case "jpeg":
      return starts(head, [0xff, 0xd8, 0xff]);
    case "png":
      return starts(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "webp":
      return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP";
    default:
      return false;
  }
}

export interface FootageScan {
  /** Kurgu ajanının gördüğü kareler (kaynak içi zaman). */
  frames: { atMs: number; key: string }[];
  /** Konuşma dökümü (kaynak içi zaman); döküm kapalıysa ya da sessizse yok. */
  words?: WordTiming[];
}

export type SegmentAudio = "original" | "ambient" | "mute";

export interface FootageSegment {
  source: string;
  fromMs: number;
  toMs: number;
  focusX: number;
  fit: "cover" | "contain";
  audio: SegmentAudio;
  why: string;
}

export interface FootageBeat {
  /** b1, b2 … (senaryodaki sahne kimliği de bu: seslendirme sahne başına çalışır). Çekimler b1-sh1, b1-sh2 … */
  id: string;
  narration: string;
  mood: VectorMood;
  segments: FootageSegment[];
}

export interface FootagePlan {
  title: string;
  beats: FootageBeat[];
  overlays: { text: string; style: TimelineOverlay["style"]; beat: string; position: TimelineOverlay["position"] }[];
}

/** Kesilmiş parça: zaman çizelgesindeki yeri ve kaynaktan nereden alındığı. */
export interface FootageCut {
  /** Çekim kimliği: <vuruş>-<sıra>. */
  id: string;
  beat: string;
  source: string;
  kind: "video" | "image";
  fromMs: number;
  toMs: number;
  /** Oynatma hızı (≤ 1): kaynak, ayrılan süreye yetmeyince yavaşlatılır. */
  speed: number;
  /** Yavaşlatma da yetmezse son karenin donduğu süre (ms); parça yine `durMs` sürer. */
  holdMs: number;
  /** Bölüm içindeki başlangıç ve süre. */
  startMs: number;
  durMs: number;
  focusX: number;
  fit: "cover" | "contain";
  audio: SegmentAudio;
  why: string;
}

export const FOOTAGE = {
  /** Shorts sınırları: YouTube 3 dk'ya kadar kabul eder; 15 sn altı kurgu değil. */
  minSec: 15,
  maxSec: 180,
  /** En kısa parça: daha kısası göz kırpması gibi okunur. */
  minSegMs: 800,
  /** Resmin ajan süre vermediğinde ekranda kaldığı süre. */
  imageMs: 3000,
  /**
   * Video parçası bu kadar uzun kesilir (kaynak izin verirse): çekim, sonrakinin geçişi boyunca onun altında sürer
   * (cutsOf; sahne geçişi 0,6 sn), donmuş son kare görünmesin.
   */
  tailMs: 700,
  /** Kaynak süreye yetmezse en çok bu kadar yavaşlatılır. */
  minSpeed: 0.6,
  /** Anlatım bittikten sonra vuruş bu kadar daha sürer (nefes). */
  voicePadMs: 300,
  /** Anlatımın altındaki kaynak ses (ambient) düzeyi. */
  ambientVolume: 0.15,
  /** Kurgu ajanına giden en çok kare (bütün kaynaklar). */
  frameBudget: 40,
  /** Kaynak başına kare sınırları ve aralığı. */
  framesMin: 2,
  framesMax: 12,
  frameEveryMs: 2500,
  /** Ekran yazısı süreleri. */
  hookMs: 3500,
  textMs: 4000,
  ctaMs: 3500,
  /** Resimdeki Ken Burns yakınlaşması. */
  zoom: 1.08,
};

/**
 * Kaynak başına örnekleme zamanları (kaynak içi ms): video süresine göre 2–12 kare, hepsi en çok `frameBudget`; resim
 * tek kare. Kareler aralığın ortasından alınır (ilk ve son karede siyah geçiş olabilir).
 */
export function frameTimes(sources: FootageSource[]): Record<string, number[]> {
  const videos = sources.filter((s) => s.kind === "video");
  const images = sources.length - videos.length;
  const budget = Math.max(videos.length * FOOTAGE.framesMin, FOOTAGE.frameBudget - images);
  const wanted = videos.map((v) => Math.min(FOOTAGE.framesMax, Math.max(FOOTAGE.framesMin, Math.ceil(v.durationMs / FOOTAGE.frameEveryMs))));
  const total = wanted.reduce((a, b) => a + b, 0);
  const scale = total > budget ? budget / total : 1;
  const out: Record<string, number[]> = {};
  for (const s of sources) {
    if (s.kind === "image") {
      out[s.id] = [0];
      continue;
    }
    const n = Math.max(FOOTAGE.framesMin, Math.floor(wanted[videos.indexOf(s)]! * scale));
    out[s.id] = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) / n) * s.durationMs));
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Ajanın kurgusunu kurallara oturtur: bilinmeyen kaynak ve çok kısa parça atılır, zamanlar kaynağa sığdırılır; resim
 * ve sessiz video susar; anlatım kapalıysa metin silinir; anlatımlı vuruşta kaynak konuşması ortam sesine iner (iki ses
 * üst üste anlaşılmaz, anlatım kazanır); kullanıcının yazıları eksikse eklenir. Boş kalan kurgu hatadır.
 */
export function normalizePlan(out: FootageEditOut, input: FootageInput, opts: { addMissingTexts?: boolean } = {}): FootagePlan {
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const beats: FootageBeat[] = [];
  const beatOf = new Map<number, string>();
  out.beats.forEach((b, i) => {
    const narration = input.narration ? b.narration.trim() : "";
    const segments = b.segments.flatMap((seg): FootageSegment[] => {
      const src = byId.get(seg.source);
      if (!src) return [];
      let fromMs: number, toMs: number;
      if (src.kind === "image") {
        const len = (seg.toSec - seg.fromSec) * 1000;
        fromMs = 0;
        toMs = Math.round(len >= FOOTAGE.minSegMs ? len : FOOTAGE.imageMs);
      } else {
        fromMs = Math.round(clamp(seg.fromSec * 1000, 0, src.durationMs));
        toMs = Math.round(clamp(seg.toSec * 1000, 0, src.durationMs));
        if (toMs - fromMs < FOOTAGE.minSegMs) return [];
      }
      const silent = src.kind === "image" || !src.audio;
      const audio: SegmentAudio = silent ? "mute" : seg.audio === "original" && narration ? "ambient" : seg.audio;
      return [{ source: src.id, fromMs, toMs, focusX: clamp(seg.focusX, 0, 1), fit: seg.fit, audio, why: seg.why }];
    });
    if (!segments.length) return;
    const id = `b${beats.length + 1}`;
    beatOf.set(i + 1, id);
    beats.push({ id, narration, mood: b.mood, segments });
  });
  if (!beats.length) throw new LocalizedError(msg("err.footage.emptyPlan"));
  const overlays: FootagePlan["overlays"] = out.overlays.flatMap((o) => {
    const beat = beatOf.get(o.beat);
    const text = o.text.trim();
    return beat && text ? [{ text, style: o.style, beat, position: o.position }] : [];
  });
  // Kullanıcının yazısı kurguda yoksa sırayla vuruşlara dağıtılır (verdiği yazı kaybolmasın).
  // Elle düzenlemede kullanıcı kendi yazısını bilerek silmiş olabilir: yeniden eklenmez.
  const missing = opts.addMissingTexts === false ? [] : input.texts.map((t) => t.trim()).filter((t) => t && !overlays.some((o) => o.text === t));
  missing.forEach((text, i) => {
    const beat = beats[Math.min(beats.length - 1, Math.floor(((i + 0.5) / missing.length) * beats.length))]!.id;
    overlays.push({ text, style: "label", beat, position: "top" });
  });
  return { title: out.title.trim(), beats, overlays };
}

/** Kurgunun senaryosu: vuruş başına bir sahne (seslendirme sahne başına çalışır). */
export function planScript(plan: FootagePlan) {
  return {
    scenes: plan.beats.map((b) => ({ id: b.id, beatId: b.id, narration: b.narration, visualIntent: b.segments.map((s) => s.why).join("; "), emotion: b.mood, location: "" })),
  };
}

const MOODS = ["neutral", "day", "warm", "cool", "night", "dramatic"] as const;
const FITS = ["cover", "contain"] as const;
const AUDIOS = ["original", "ambient", "mute"] as const;
const STYLES = ["hook", "title", "label", "cta"] as const;
const POSITIONS = ["top", "center", "bottom"] as const;
/** Elle düzenlemenin sınırları (ajanınkinden geniş: kullanıcı parça ekleyemez ama bölmeleri birleştirebilir). */
export const PLAN_EDIT = { beats: 20, segments: 8, overlays: 12, text: 60, why: 200 };

/**
 * Stüdyo'dan gelen elle düzenlenmiş kurguyu (FootagePlan biçimi, güvenilmez) ajan çıktısı biçimine çevirir; biçim
 * bozuksa çevrilebilir hata. Anlatım senaryodaki güncel metinden gelir (anlatım ayrı düzenlenir). Kurallar sonra
 * normalizePlan'da uygulanır (kaynağa sığdırma, sessiz kaynak, anlatım kazanır).
 */
export function readPlanEdit(raw: unknown, narrations: Record<string, string>): FootageEditOut {
  const bad = () => new LocalizedError(msg("err.footage.editInvalid"));
  const obj = (v: unknown) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);
  const plan = obj(raw);
  const beats = Array.isArray(plan?.beats) ? plan.beats : undefined;
  const overlays = Array.isArray(plan?.overlays) ? plan.overlays : undefined;
  if (!plan || !beats?.length || beats.length > PLAN_EDIT.beats || !overlays || overlays.length > PLAN_EDIT.overlays) throw bad();
  const ids: string[] = [];
  const out: FootageEditOut = {
    title: typeof plan.title === "string" ? plan.title.slice(0, 100) : "",
    beats: beats.map((b) => {
      const beat = obj(b);
      const segments = Array.isArray(beat?.segments) ? beat.segments : undefined;
      const mood = pick(MOODS, beat?.mood);
      if (!beat || typeof beat.id !== "string" || !mood || !segments?.length || segments.length > PLAN_EDIT.segments) throw bad();
      ids.push(beat.id);
      return {
        narration: narrations[beat.id] ?? (typeof beat.narration === "string" ? beat.narration : ""),
        mood,
        segments: segments.map((s) => {
          const seg = obj(s);
          const fromMs = num(seg?.fromMs), toMs = num(seg?.toMs), focusX = num(seg?.focusX);
          const fit = pick(FITS, seg?.fit), audio = pick(AUDIOS, seg?.audio);
          if (!seg || typeof seg.source !== "string" || fromMs === undefined || toMs === undefined || focusX === undefined || !fit || !audio) throw bad();
          return { source: seg.source, fromSec: Math.max(0, fromMs) / 1000, toSec: Math.max(0, toMs) / 1000, focusX: Math.min(1, Math.max(0, focusX)), fit, audio, why: typeof seg.why === "string" ? seg.why.slice(0, PLAN_EDIT.why) : "" };
        }),
      };
    }),
    overlays: [],
  };
  out.overlays = overlays.map((o) => {
    const overlay = obj(o);
    const style = pick(STYLES, overlay?.style), position = pick(POSITIONS, overlay?.position);
    const beat = typeof overlay?.beat === "string" ? ids.indexOf(overlay.beat) + 1 : 0;
    if (!overlay || typeof overlay.text !== "string" || !style || !position || beat < 1) throw bad();
    return { text: overlay.text.slice(0, PLAN_EDIT.text), style, beat, position };
  });
  return out;
}

const lengthOf = (s: FootageSegment) => s.toMs - s.fromMs;

/**
 * Vuruşları ses süresine ve hedefe oturtur. Vuruşun payı, ajanın kurgusundaki uzunluğunun hedefe ölçeklenmiş hâlidir
 * (yalnız konuşmadan oluşan vuruşlar kendi uzunluğunda, hedeften düşülür);
 * anlatımı (+ nefes) ve tam sesle çalan kaynak konuşması bundan uzunsa o kazanır (söz kesilmez). Vuruş içinde konuşan
 * parça kendi uzunluğunu korur, kalan süre diğer parçalara uzunluklarıyla orantılı dağılır. Video parçası uzaması
 * gerekince önce kaynakta ileri (sonra geri) uzar, yetmezse `minSpeed`e kadar yavaşlar, o da yetmezse son karesi
 * donar (`holdMs`): parça hiç kısalmaz, vuruşlar kaymaz, bir anlatım ötekinin üstüne binmez. Resim istenen kadar kalır.
 * Anlatımı olan vuruşta kaynağın konuşması ortam sesine iner (kurgu sonradan değişse de iki ses üst üste çalmaz).
 */
export function fitCuts(plan: FootagePlan, sources: FootageSource[], voiceMs: Record<string, number>, targetMs: number): FootageCut[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const natural = plan.beats.map((b) => b.segments.reduce((a, s) => a + lengthOf(s), 0));
  const audioOf = (beat: FootageBeat, s: FootageSegment): SegmentAudio => (voiceMs[beat.id] && s.audio === "original" ? "ambient" : s.audio);
  // Yalnız konuşan parçalardan oluşan vuruş esnemez: hedeften düşülür, kalan esneyen vuruşlara oranla dağılır.
  const rigid = plan.beats.map((b) => b.segments.every((s) => audioOf(b, s) === "original"));
  const rigidMs = natural.reduce((a, n, i) => a + (rigid[i] ? n : 0), 0);
  const total = natural.reduce((a, n, i) => a + (rigid[i] ? 0 : n), 0);
  const room = Math.max(0, targetMs - rigidMs);
  const cuts: FootageCut[] = [];
  let cursor = 0;
  plan.beats.forEach((beat, bi) => {
    const fixed = beat.segments.filter((s) => audioOf(beat, s) === "original");
    const fixedMs = fixed.reduce((a, s) => a + lengthOf(s), 0);
    const flex = beat.segments.filter((s) => audioOf(beat, s) !== "original");
    const voice = voiceMs[beat.id] ? voiceMs[beat.id]! + FOOTAGE.voicePadMs : 0;
    const share = Math.round((natural[bi]! / total) * room);
    // Esnek parça yoksa vuruş, konuşan parçaların toplamıdır.
    const beatMs = flex.length ? Math.max(share, voice, fixedMs + flex.length * FOOTAGE.minSegMs) : fixedMs;
    const flexNatural = flex.reduce((a, s) => a + lengthOf(s), 0);
    let left = beatMs - fixedMs;
    let flexLeft = flexNatural;
    for (const seg of beat.segments) {
      const src = byId.get(seg.source)!;
      const audio = audioOf(beat, seg);
      let dur: number;
      if (audio === "original") dur = lengthOf(seg);
      else {
        dur = Math.max(FOOTAGE.minSegMs, Math.round((lengthOf(seg) / flexLeft) * left));
        left -= dur;
        flexLeft -= lengthOf(seg);
      }
      let { fromMs, toMs } = seg;
      let speed = 1;
      let holdMs = 0;
      if (src.kind === "video") {
        if (dur <= toMs - fromMs) toMs = fromMs + dur;
        else {
          toMs = Math.min(src.durationMs, fromMs + dur);
          fromMs = Math.max(0, toMs - dur);
          const have = toMs - fromMs;
          if (have < dur) speed = Math.max(FOOTAGE.minSpeed, have / dur);
          // Yavaşlatma da yetmezse (kaynak bitti) son kare kalan süre boyunca durur.
          holdMs = Math.max(0, dur - Math.round(have / speed));
        }
      } else toMs = dur;
      cuts.push({ id: `${beat.id}-sh${cuts.filter((c) => c.beat === beat.id).length + 1}`, beat: beat.id, source: seg.source, kind: src.kind, fromMs, toMs, speed, holdMs, startMs: cursor, durMs: dur, focusX: seg.focusX, fit: seg.fit, audio, why: seg.why });
      cursor += dur;
    }
  });
  return cuts;
}

/** Vuruşların bölüm içindeki başlangıçları (ms). */
export function beatStarts(cuts: FootageCut[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cuts) out[c.beat] ??= c.startMs;
  return out;
}

/**
 * Tam sesle çalan parçaların konuşması (altyazı ve müziğin kısılması için): yalnız parçanın içindeki kelimeler, bölüm
 * zamanına taşınır (yavaşlatılmışsa ölçeklenir).
 */
export function sourceWords(cuts: FootageCut[], scans: Record<string, FootageScan>): WordTiming[] {
  return cuts.flatMap((c) => {
    if (c.audio !== "original") return [];
    return (scans[c.source]?.words ?? [])
      .filter((w) => w.startMs >= c.fromMs && w.endMs <= c.toMs)
      .map((w) => ({ text: w.text, startMs: Math.round(c.startMs + (w.startMs - c.fromMs) / c.speed), endMs: Math.round(c.startMs + (w.endMs - c.fromMs) / c.speed) }));
  });
}

/** Ekran yazılarının zamanları: kanca baştan, çağrı vuruşun sonunda, diğerleri vuruş başında; vuruştan taşmaz. */
export function overlayTimes(plan: FootagePlan, cuts: FootageCut[], fps: number): TimelineOverlay[] {
  const starts = beatStarts(cuts);
  const ends: Record<string, number> = {};
  for (const c of cuts) ends[c.beat] = c.startMs + c.durMs;
  const frame = (ms: number) => Math.round((ms / 1000) * fps);
  return plan.overlays.flatMap((o) => {
    const start = starts[o.beat], end = ends[o.beat];
    if (start === undefined || end === undefined) return [];
    const len = o.style === "hook" ? FOOTAGE.hookMs : o.style === "cta" ? FOOTAGE.ctaMs : FOOTAGE.textMs;
    const from = o.style === "cta" ? Math.max(start, end - len) : start;
    const to = Math.min(end, from + len);
    const fromFrame = frame(from), frames = frame(to) - fromFrame;
    if (frames <= 0) return [];
    const anim: TimelineOverlay["anim"] = o.style === "hook" ? "kinetic" : o.style === "cta" ? "pop" : "typewriter";
    return [{ text: o.text, style: o.style, fromFrame, durationInFrames: frames, position: o.position, anim }];
  });
}

/** Çekim geçişinin (cutsOf; sahne geçişi 0,6 sn) payı: kapak bu süre içinde alınmaz, iki görüntü karışık görünür. */
const CUT_CLEAR_MS = 700;

/**
 * Kapak karesinin anı (ms): kanca yazısı tamamen açık ve henüz kararmamışken (bitişinden 0,4 sn önce); kanca yoksa
 * Short'un üçte biri. O an bir çekim geçişine düşerse (22 Kas, gerçek render: iki çekim üst üste karışık göründü) geçiş
 * bittikten sonraki an alınır, kancanın içinde kalmıyorsa geçiş başlamadan hemen önceki an. Shorts kapağı videodan bir
 * karedir: dikey kalır, başlık zaten kancadadır.
 */
export function posterMs(timeline: Pick<Timeline, "fps" | "durationInFrames" | "overlays" | "visuals">): number {
  const hook = timeline.overlays?.find((o) => o.style === "hook");
  const total = (timeline.durationInFrames / timeline.fps) * 1000;
  const until = hook ? ((hook.fromFrame + hook.durationInFrames) / timeline.fps) * 1000 - 300 : total;
  let t = hook ? until - 100 : total / 3;
  const v = timeline.visuals.slice(1).find((x) => (x.fromFrame / timeline.fps) * 1000 <= t && t < ((x.fromFrame + x.durationInFrames) / timeline.fps) * 1000);
  const start = v ? (v.fromFrame / timeline.fps) * 1000 : 0;
  if (v && t - start < CUT_CLEAR_MS) t = start + CUT_CLEAR_MS <= until ? start + CUT_CLEAR_MS : start - 100;
  return Math.max(0, Math.round(t));
}

export interface FootageAssets {
  /** Çekim → kesilmiş görüntünün anahtarı (video parçası ya da dikey resim). */
  visual: Record<string, string>;
  /** Çekim → kaynak sesin anahtarı (yalnız sesi çalan parçalar). */
  audio: Record<string, string>;
}

export interface FootageTimelineInput {
  episodeId: string;
  lang: string;
  fps: number;
  width: number;
  height: number;
  plan: FootagePlan;
  cuts: FootageCut[];
  assets: FootageAssets;
  /** Vuruş → anlatım sesi (anahtar, süre, kelimeler). */
  voice: Record<string, { key: string; durationMs: number; words: WordTiming[] }>;
  scans: Record<string, FootageScan>;
}

/**
 * Footage timeline'ı: parçalar sırayla (video parçası "footage", resim Ken Burns'lü "still_motion"), anlatım vuruş
 * başında, kaynak sesi parçasının altında (konuşma tam, ortam kısık), altyazı anlatımın ve korunan konuşmanın
 * kelimeleri, ekran yazıları. Müzik ve efekt sonra eklenir (bölümün timeline aşaması).
 */
export function footageTimeline(t: FootageTimelineInput): Timeline {
  const frame = (ms: number) => Math.round((ms / 1000) * t.fps);
  const starts = beatStarts(t.cuts);
  const mood = new Map(t.plan.beats.map((b) => [b.id, b.mood]));
  const end = t.cuts.reduce((a, c) => Math.max(a, c.startMs + c.durMs), 0);
  const visuals: Timeline["visuals"] = t.cuts.map((c, i) => {
    const fromFrame = frame(c.startMs);
    const base = { shotId: c.id, assetUrl: t.assets.visual[c.id]!, fromFrame, durationInFrames: Math.max(1, frame(c.startMs + c.durMs) - fromFrame), ambience: "none" as const, playbackRate: 1, mood: mood.get(c.beat) };
    return c.kind === "video"
      ? { ...base, kind: "footage" as const }
      : { ...base, kind: "still_motion" as const, motion: { type: "ken_burns" as const, zoomFrom: 1, zoomTo: FOOTAGE.zoom, panX: i % 2 ? -0.3 : 0.3 } };
  });
  const audio: Timeline["audio"] = [];
  const words: WordTiming[] = [];
  for (const beat of t.plan.beats) {
    const v = t.voice[beat.id];
    if (!v || starts[beat.id] === undefined) continue;
    const at = starts[beat.id]!;
    audio.push({ role: "voice", assetUrl: v.key, fromFrame: frame(at), durationInFrames: Math.max(1, frame(v.durationMs)), volume: 1 });
    words.push(...v.words.map((w) => ({ ...w, startMs: w.startMs + at, endMs: w.endMs + at })));
  }
  for (const c of t.cuts) {
    const key = t.assets.audio[c.id];
    if (!key || c.audio === "mute") continue;
    audio.push({ role: "source", assetUrl: key, fromFrame: frame(c.startMs), durationInFrames: Math.max(1, frame(c.startMs + c.durMs) - frame(c.startMs)), volume: c.audio === "original" ? 1 : FOOTAGE.ambientVolume });
  }
  words.push(...sourceWords(t.cuts, t.scans));
  words.sort((a, b) => a.startMs - b.startMs);
  return {
    episodeId: t.episodeId,
    lang: t.lang,
    fps: t.fps,
    width: t.width,
    height: t.height,
    durationInFrames: Math.max(1, frame(end)),
    visuals,
    audio,
    captions: words,
    speech: words,
    vectorAssets: {},
    palette: [],
    lineStyle: "outline",
    texture: "none",
    overlays: overlayTimes(t.plan, t.cuts, t.fps),
  };
}
