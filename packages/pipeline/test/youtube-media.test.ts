import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** yt-dlp sahtesi: argümanları kaydeder; -o kalıbına göre dosya yazar ya da verilen hatayla düşer. */
const yt = vi.hoisted(() => ({
  calls: [] as { file: string; args: string[] }[],
  stdout: "",
  error: undefined as (Error & { code?: string; stderr?: string }) | undefined,
  write: true,
  /** Bu kadar çağrı daha `error` ile düşer (sonra başarılı). */
  failTimes: 0,
}));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<object>()),
  execFile: (file: string, args: string[], _opts: unknown, cb: (e: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    yt.calls.push({ file, args });
    if (yt.error && yt.failTimes !== 0) {
      if (yt.failTimes > 0) yt.failTimes--;
      return void cb(yt.error);
    }
    const at = args.indexOf("-o");
    const o = at >= 0 ? args[at + 1] : undefined;
    const done = () => cb(null, { stdout: yt.stdout, stderr: "" });
    if (!o || !yt.write) return void done();
    const lang = args.includes("--sub-langs") ? args[args.indexOf("--sub-langs") + 1] : undefined;
    const out = lang ? o.replace("%(ext)s", `${lang}.json3`) : o.replace("%(ext)s", "mp4");
    void writeFile(out, lang ? '{"events":[]}' : "video").then(done);
  },
}));

const ff = vi.hoisted(() => ({ calls: [] as { tool: string; args: string[]; opts?: unknown }[], stderr: "" }));
vi.mock("@ys/video/tools", () => ({
  runMediaTool: async (tool: string, args: string[], _bundled?: boolean, opts?: unknown) => {
    ff.calls.push({ tool, args, opts });
    const out = args.at(-1)!;
    if (out !== "-") await writeFile(out, new Uint8Array([9]));
    return { stdout: "", stderr: ff.stderr };
  },
}));

const { contactSheet, detectScenes, downloadCaptions, downloadVideo, longSilences, runYtDlp, thumbAt, youtubeInfo, ytDlpPath } = await import("../src/youtube-media.ts");

const URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

beforeEach(() => {
  yt.calls = [];
  yt.stdout = "";
  yt.error = undefined;
  yt.write = true;
  yt.failTimes = -1;
  ff.calls = [];
  ff.stderr = "";
});
afterEach(() => {
  delete process.env.YS_YTDLP;
});

describe("yt-dlp", () => {
  it("yol ortamdan; adres her zaman `--` ardından gider", async () => {
    expect(ytDlpPath()).toBe("yt-dlp");
    process.env.YS_YTDLP = "C:\\tools\\yt-dlp.exe";
    yt.stdout = JSON.stringify({ id: "x", duration: 3 });
    expect(await youtubeInfo(URL)).toEqual({ id: "x", duration: 3 });
    expect(yt.calls[0]).toEqual({ file: "C:\\tools\\yt-dlp.exe", args: ["-J", "--no-playlist", "--no-warnings", "--", URL] });
  });

  it("kurulu değilse yol gösteren hata; çalışma hatası stderr'in son satırlarıyla; JSON değilse hata", async () => {
    yt.error = Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
    await expect(runYtDlp(["x"])).rejects.toThrow("yt-dlp bulunamadı (yt-dlp)");
    yt.error = Object.assign(new Error("Command failed"), { stderr: "WARNING: a\n\nERROR: Video unavailable\nERROR: Private video\n" });
    await expect(runYtDlp(["x"])).rejects.toThrow("yt-dlp hatası: ERROR: Video unavailable | ERROR: Private video");
    yt.error = new Error("killed");
    await expect(runYtDlp(["x"])).rejects.toThrow("yt-dlp hatası: killed");
    yt.error = undefined;
    yt.stdout = "<html>";
    await expect(youtubeInfo(URL)).rejects.toThrow("yt-dlp hatası: <html>");
  });

  it("video en çok 1080p MP4 iner; dosya yazılmadıysa hata", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ys-ytm-")), "dl");
    expect(await downloadVideo(URL, dir)).toBe(join(dir, "video.mp4"));
    const args = yt.calls[0]!.args;
    expect(args[1]).toBe("bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b");
    expect(args.slice(-2)).toEqual(["--", URL]);
    yt.write = false;
    await expect(downloadVideo(URL, join(dir, "other"))).rejects.toThrow("video.mp4 not written");
  });

  it("indirme 403 ile düşerse bir kez yeniden denenir; başka hata ya da ikinci 403 düşürür", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ys-ytm-")), "dl");
    yt.error = Object.assign(new Error("Command failed"), { stderr: "ERROR: unable to download video data: HTTP Error 403: Forbidden" });
    yt.failTimes = 1;
    expect(await downloadVideo(URL, dir)).toBe(join(dir, "video.mp4"));
    expect(yt.calls).toHaveLength(2);
    yt.calls = [];
    yt.failTimes = 2;
    await expect(downloadVideo(URL, dir)).rejects.toThrow("HTTP Error 403");
    expect(yt.calls).toHaveLength(2);
    yt.calls = [];
    yt.error = Object.assign(new Error("Command failed"), { stderr: "ERROR: Private video" });
    yt.failTimes = 1;
    await expect(downloadVideo(URL, dir)).rejects.toThrow("Private video");
    expect(yt.calls).toHaveLength(1);
  });

  it("altyazı json3 olarak iner (elle ya da otomatik); yazılmadıysa undefined", async () => {
    expect(await downloadCaptions(URL, { lang: "tr", auto: false })).toBe('{"events":[]}');
    expect(yt.calls[0]!.args.slice(0, 6)).toEqual(["--write-subs", "--sub-langs", "tr", "--sub-format", "json3", "--skip-download"]);
    yt.write = false;
    expect(await downloadCaptions(URL, { lang: "en-orig", auto: true })).toBeUndefined();
    expect(yt.calls[1]!.args[0]).toBe("--write-auto-subs");
  });
});

describe("ffmpeg adımları", () => {
  it("sahne kesimleri anahtar karelerden okunur", async () => {
    ff.stderr = "[Parsed_showinfo_2] n:0 pts:1 pts_time:12.5 x\n[Parsed_showinfo_2] n:1 pts_time: 61.004\nother";
    expect(await detectScenes("v.mp4")).toEqual([12500, 61004]);
    expect(ff.calls[0]!.args).toEqual(expect.arrayContaining(["-skip_frame", "nokey", "scale=320:-2,select=gt(scene\\,0.35),showinfo"]));
    expect(ff.calls[0]!.opts).toMatchObject({ maxBuffer: 256 * 1024 * 1024 });
  });

  it("küçük kare ve kontakt sayfası; sessizlikler", async () => {
    expect(await thumbAt("v.mp4", 1500)).toEqual(new Uint8Array([9]));
    expect(ff.calls[0]!.args.slice(0, 6)).toEqual(["-y", "-v", "error", "-ss", "1.500", "-i"]);
    expect(await contactSheet([new Uint8Array([1]), new Uint8Array([2])])).toEqual(new Uint8Array([9]));
    expect(ff.calls[1]!.args).toContain("tile=4x3:padding=6:margin=6:color=black");
    ff.stderr = "silence_start: 10\nsilence_end: 12.5\nsilence_start: 50";
    expect(await longSilences("v.mp4", 60_000)).toEqual([
      { fromMs: 10_000, toMs: 12_500 },
      { fromMs: 50_000, toMs: 60_000 },
    ]);
    expect(ff.calls[2]!.args).toContain("silencedetect=noise=-35dB:d=1.5");
  });
});

