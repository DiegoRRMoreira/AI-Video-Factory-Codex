import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalizedError, msg } from "@ys/core";
import { runMediaTool } from "@ys/video/tools";

/**
 * Footage modunun ffmpeg/ffprobe adımları (kullanıcının verdiği video ve resimler). Girdi yerel dosya yoludur: kaynak
 * videolar yüzlerce MB olabilir, her adımda belleğe alınıp yeniden yazılmaz. Çıktılar küçük (kare, ses, kesilmiş parça)
 * ve depoya bayt olarak gider.
 */

export const FOOTAGE_MEDIA = {
  /** Kurgu ajanına giden kare yüksekliği (px): içerik okunur, görsel token ucuz kalır. */
  frameHeight: 360,
  /** STT'ye giden ses: tek kanal 16 kHz yeter, dosya küçük kalır. */
  sttRate: 16_000,
  /** Kaynak sesin render'a giden kopyası. */
  audioRate: 48_000,
  /** contain kadrajında arkadaki bulanık dolgu. */
  blur: 24,
  /** Bulanık dolgu biraz karartılır: önündeki görüntü öne çıksın. */
  dim: -0.08,
};

export interface MediaInfo {
  kind: "video" | "image";
  durationMs: number;
  width: number;
  height: number;
  /** Videoda ses akışı var mı (konuşma dökümü ve kaynak ses bunu ister). */
  audio: boolean;
}

interface ProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

/** ffprobe JSON çıktısından ölçüler; telefon videolarının dönüş bilgisi (90°/270°) en ve boyu değiştirir. */
export function parseProbe(json: string, kind: "video" | "image"): MediaInfo {
  let data: { streams?: ProbeStream[]; format?: { duration?: string } };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    throw new LocalizedError(msg("err.media.probe", { output: json.slice(0, 200) }));
  }
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && s.width && s.height);
  if (!video) throw new LocalizedError(msg("err.footage.noVideo"));
  const rotation = Math.abs(Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0)) % 180;
  const [width, height] = rotation === 90 ? [video.height!, video.width!] : [video.width!, video.height!];
  const sec = Number.parseFloat(data.format?.duration ?? "");
  if (kind === "video" && !(sec > 0)) throw new LocalizedError(msg("err.media.probe", { output: json.slice(0, 200) }));
  return {
    kind,
    durationMs: kind === "video" ? Math.round(sec * 1000) : 0,
    width,
    height,
    audio: kind === "video" && streams.some((s) => s.codec_type === "audio"),
  };
}

export async function probeMedia(file: string, kind: "video" | "image"): Promise<MediaInfo> {
  const { stdout } = await runMediaTool("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation:format=duration",
    "-of",
    "json",
    file,
  ]);
  return parseProbe(stdout, kind);
}

export type Fit = "cover" | "contain";

/**
 * Kaynağı dikey kareye oturtan filtre. cover: kareyi doldurur, yatayda `focusX` (0 sol … 1 sağ) noktasından kırpar
 * (yatay videonun ~%31'i kalır; öznenin yeri kurgu ajanından gelir). contain: görüntünün tamamı ortada, arkası aynı
 * görüntünün bulanık ve biraz karartılmış dolgusu (geniş manzara, yazılı ekran).
 */
export function frameFilter(fit: Fit, focusX: number, width: number, height: number): string {
  const f = Math.min(1, Math.max(0, focusX));
  const fill = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-${width})*${f}:(ih-${height})/2`;
  if (fit === "cover") return `${fill},setsar=1`;
  return `split=2[a][b];[a]${fill},boxblur=${FOOTAGE_MEDIA.blur}:2,eq=brightness=${FOOTAGE_MEDIA.dim}[bg];[b]scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
}

const sec = (ms: number) => (ms / 1000).toFixed(3);

/** Geçici klasörde çalışır, çıktı dosyasını okuyup klasörü siler. */
async function withOutput(name: string, fn: (out: string) => Promise<void>): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "ys-footage-"));
  try {
    const out = join(dir, name);
    await fn(out);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Kurgu ajanı için tek kare (JPEG, küçük). Resimde zaman yok sayılır. */
export function sampleFrame(file: string, atMs: number, kind: "video" | "image"): Promise<Uint8Array> {
  return withOutput("frame.jpg", (out) =>
    runMediaTool("ffmpeg", [
      "-y",
      "-v",
      "error",
      ...(kind === "video" ? ["-ss", sec(atMs)] : []),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      `scale=-2:${FOOTAGE_MEDIA.frameHeight}`,
      "-q:v",
      "5",
      out,
    ]).then(() => undefined),
  );
}

/**
 * Ses (WAV). stt: tek kanal 16 kHz (döküm); değilse 48 kHz stereo (render'daki kaynak ses). Aralık verilmezse tamamı;
 * speed < 1 görüntüyle aynı oranda yavaşlatır (atempo, perde korunur).
 */
export function extractAudio(file: string, opts: { stt?: boolean; fromMs?: number; toMs?: number; speed?: number } = {}): Promise<Uint8Array> {
  const range = opts.fromMs !== undefined && opts.toMs !== undefined ? ["-ss", sec(opts.fromMs), "-to", sec(opts.toMs)] : [];
  return withOutput("audio.wav", (out) =>
    runMediaTool("ffmpeg", [
      "-y",
      "-v",
      "error",
      ...range,
      "-i",
      file,
      "-vn",
      ...(opts.speed && opts.speed < 1 ? ["-af", `atempo=${opts.speed}`] : []),
      "-ac",
      opts.stt ? "1" : "2",
      "-ar",
      String(opts.stt ? FOOTAGE_MEDIA.sttRate : FOOTAGE_MEDIA.audioRate),
      "-c:a",
      "pcm_s16le",
      out,
    ]).then(() => undefined),
  );
}

export interface CutOptions {
  fromMs: number;
  toMs: number;
  focusX: number;
  fit: Fit;
  width: number;
  height: number;
  fps: number;
  /** Kaynak süreye yetmezse yavaşlatma (0.5–1): 0.8 → parça 1/0.8 kat uzun oynar. */
  speed?: number;
  /** Sonuna eklenecek donmuş son kare (ms): kaynak bitince parça ve geçiş payı yine dolsun. */
  padMs?: number;
}

/**
 * Videodan sessiz, dikey, sabit fps parça (H.264): render ayrıca normalleştirmez (çekim türü "footage"). Ses ayrı
 * izdir (extractAudio): Remotion'un parça önbelleği sessiz parçalar yazar, ses EpisodeAudio'dan gelir.
 */
export function cutVideo(file: string, o: CutOptions): Promise<Uint8Array> {
  const speed = o.speed && o.speed < 1 ? `,setpts=PTS/${o.speed}` : "";
  const pad = o.padMs && o.padMs > 0 ? `,tpad=stop_mode=clone:stop_duration=${sec(o.padMs)}` : "";
  // Remotion'un ffmpeg'inde fps filtresi yok: yedeğe düşmez (normalizeClip gibi).
  return withOutput("cut.mp4", (out) =>
    runMediaTool(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-ss",
        sec(o.fromMs),
        "-to",
        sec(o.toMs),
        "-i",
        file,
        "-an",
        "-vf",
        `${frameFilter(o.fit, o.focusX, o.width, o.height)}${speed}${pad},fps=${o.fps}`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-g",
        String(o.fps),
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        out,
      ],
      false,
    ).then(() => undefined),
  );
}

/** Resmi dikey kareye oturtur (JPEG); üstüne render'da Ken Burns hareketi gelir. */
export function frameImage(file: string, o: { focusX: number; fit: Fit; width: number; height: number }): Promise<Uint8Array> {
  return withOutput("still.jpg", (out) =>
    runMediaTool("ffmpeg", ["-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", frameFilter(o.fit, o.focusX, o.width, o.height), "-q:v", "2", out]).then(
      () => undefined,
    ),
  );
}
