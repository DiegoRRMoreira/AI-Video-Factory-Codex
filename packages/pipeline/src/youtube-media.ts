import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LocalizedError, msg } from "@ys/core";
import { runMediaTool } from "@ys/video/tools";
import { parseSilences } from "./align.ts";
import { YOUTUBE, type YtInfo } from "./youtube.ts";

/**
 * YouTube analizinin dış araç adımları: yt-dlp (bilgi, video, altyazı) ve ffmpeg (sahne kesimleri, küçük kareler,
 * kontakt sayfası, sessizlikler). yt-dlp'ye yalnız parseYoutubeUrl'ün kanonik adresi `--` ardından gider (kullanıcı girdisi
 * seçenek olarak okunamaz); kabuk kullanılmaz.
 */

const execFileP = promisify(execFile);

/** yt-dlp yolu: YS_YTDLP, yoksa PATH'teki yt-dlp. */
export const ytDlpPath = () => process.env.YS_YTDLP || "yt-dlp";

/** Uzun işler (bir saatlik videonun indirilmesi, kod çözme) için süre ve çıktı sınırı. */
const LONG = { timeout: 3 * 3600_000, maxBuffer: 256 * 1024 * 1024 };

export async function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileP(ytDlpPath(), args, { ...LONG, windowsHide: true, encoding: "utf8" });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") throw new LocalizedError(msg("err.youtube.noYtdlp", { path: ytDlpPath() }));
    const detail = (err.stderr ?? err.message).trim().split("\n").filter(Boolean).slice(-2).join(" | ");
    throw new LocalizedError(msg("err.youtube.ytdlp", { detail: detail.slice(0, 400) }));
  }
}

/** Videonun bilgi JSON'u (indirmeden). */
export async function youtubeInfo(url: string): Promise<YtInfo> {
  const { stdout } = await runYtDlp(["-J", "--no-playlist", "--no-warnings", "--", url]);
  try {
    return JSON.parse(stdout) as YtInfo;
  } catch {
    throw new LocalizedError(msg("err.youtube.ytdlp", { detail: stdout.slice(0, 200) }));
  }
}

/**
 * Videoyu en çok 1080p MP4 olarak indirir (önce H.264 + m4a: ffmpeg ve tarayıcı hızlı çözer). Çıktı `dir/video.mp4`;
 * birleştirme için ffmpeg gerekir (yt-dlp PATH'te arar).
 */
export async function downloadVideo(url: string, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const h = YOUTUBE.height;
  await runYtDlp([
    "-f",
    `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`,
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--no-part",
    "-o",
    join(dir, "video.%(ext)s"),
    "--",
    url,
  ]);
  const file = join(dir, "video.mp4");
  if (!existsSync(file)) throw new LocalizedError(msg("err.youtube.ytdlp", { detail: "video.mp4 not written" }));
  return file;
}

/** Seçilen altyazıyı json3 olarak indirir; yazılmadıysa undefined. */
export async function downloadCaptions(url: string, caption: { lang: string; auto: boolean }): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), "ys-subs-"));
  try {
    await runYtDlp([caption.auto ? "--write-auto-subs" : "--write-subs", "--sub-langs", caption.lang, "--sub-format", "json3", "--skip-download", "--no-playlist", "--no-warnings", "-o", join(dir, "subs.%(ext)s"), "--", url]);
    const file = join(dir, `subs.${caption.lang}.json3`);
    return existsSync(file) ? await readFile(file, "utf8") : undefined;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Sahne kesim anları (ms): yalnız anahtar kareler çözülür (bir saatlik 1080p video dakikalar yerine saniyeler sürer);
 * kesim en yakın anahtar kareye düşer, analiz için yeter (Short kenarları kelimelere oturur).
 */
export async function detectScenes(file: string): Promise<number[]> {
  const { stderr } = await runMediaTool(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-skip_frame", "nokey", "-i", file, "-an", "-sn", "-vf", `scale=320:-2,select=gt(scene\\,${YOUTUBE.sceneThreshold}),showinfo`, "-f", "null", "-"],
    true,
    LONG,
  );
  return [...stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000));
}

/** Küçük kare (kontakt sayfası hücresi ve Stüdyo'daki sahne resmi): 320×180, en-boy korunur, siyah dolgu. */
export async function thumbAt(file: string, atMs: number): Promise<Uint8Array> {
  const { width: w, height: h } = YOUTUBE.sheet;
  const dir = await mkdtemp(join(tmpdir(), "ys-thumb-"));
  try {
    const out = join(dir, "t.jpg");
    await runMediaTool("ffmpeg", ["-y", "-v", "error", "-ss", (atMs / 1000).toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`, "-q:v", "5", out]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Kareleri bir kontakt sayfasında birleştirir (soldan sağa, yukarıdan aşağıya; eksik hücreler boş). */
export async function contactSheet(frames: Uint8Array[]): Promise<Uint8Array> {
  const { cols, rows } = YOUTUBE.sheet;
  const dir = await mkdtemp(join(tmpdir(), "ys-sheet-"));
  try {
    await Promise.all(frames.map((f, i) => writeFile(join(dir, `f${String(i + 1).padStart(3, "0")}.jpg`), f)));
    const out = join(dir, "sheet.jpg");
    await runMediaTool("ffmpeg", ["-y", "-v", "error", "-framerate", "1", "-i", join(dir, "f%03d.jpg"), "-vf", `tile=${cols}x${rows}:padding=6:margin=6:color=black`, "-frames:v", "1", "-q:v", "4", out]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Uzun sessizlikler (analiste "ölü an" ipucu). */
export async function longSilences(file: string, durationMs: number): Promise<{ fromMs: number; toMs: number }[]> {
  const { stderr } = await runMediaTool("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-sn", "-af", `silencedetect=noise=-35dB:d=${YOUTUBE.silenceMs / 1000}`, "-f", "null", "-"], true, LONG);
  return parseSilences(stderr, durationMs).map((s) => ({ fromMs: s.start, toMs: s.end }));
}
