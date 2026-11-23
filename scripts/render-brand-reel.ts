import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { musicTrack, MUSIC_RATE } from "../packages/video/src/music.ts";
import { wavFile } from "../packages/video/src/sfx.ts";
import type { Timeline } from "../packages/core/src/index.ts";

interface Title { from: number; to: number; text: string; x: number; y: number; size: number; color?: string }
interface Config { sourceVideo: string; logo: string; outputDirectory: string; accent: string; duration: number; outroStart: number; titles: Title[] }
const configPath = resolve(process.argv[2] ?? "examples/reels/brand.example.json");
const config = JSON.parse(await readFile(configPath, "utf8")) as Config;
const root = resolve(import.meta.dirname, "..");
const fromConfig = (path: string) => resolve(dirname(configPath), path);
const source = fromConfig(config.sourceVideo);
const logo = fromConfig(config.logo);
const output = fromConfig(config.outputDirectory);
if (!/^#[0-9a-f]{6}$/i.test(config.accent) || !Number.isFinite(config.duration) || config.duration <= 0 || config.duration > 180 || !Number.isFinite(config.outroStart) || config.outroStart <= 0 || config.outroStart >= config.duration) throw new Error("Invalid accent, duration or outroStart.");
await Promise.all([access(source), access(logo)]);
await mkdir(output, { recursive: true });
const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
let ffmpeg = process.env.YS_FFMPEG_BIN ? join(process.env.YS_FFMPEG_BIN, exe) : exe;
if (!process.env.YS_FFMPEG_BIN) {
  const tools = join(root, ".data/tools/ffmpeg");
  for (const entry of await readdir(tools, { withFileTypes: true }).catch(() => [])) {
    const candidate = join(tools, entry.name, "bin", exe);
    if (entry.isDirectory()) { try { await access(candidate); ffmpeg = candidate; break; } catch { /* Try PATH when no portable build exists. */ } }
  }
}
const sharp = createRequire(resolve(root, "packages/pipeline/package.json"))("sharp");
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.88"/><stop offset="0.32" stop-color="#000" stop-opacity="0.70"/><stop offset="0.58" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#shade)"/></svg>')).png().toFile(join(output, "shade.png"));
const stamp = (t: number) => `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
const lines = config.titles.map((title) => {
  if (![title.from, title.to, title.x, title.y, title.size].every(Number.isFinite) || title.from < 0 || title.to <= title.from || title.to > config.duration || title.size < 8 || title.size > 180 || !/^#[0-9a-f]{6}$/i.test(title.color ?? "#FFFFFF")) throw new Error("Invalid title timing, position, size or color.");
  const color = (title.color ?? "#FFFFFF").slice(1).match(/../g)!.reverse().join("");
  const text = title.text.replace(/[{}\\\r\n]/g, " ");
  return `Dialogue: 0,${stamp(title.from)},${stamp(title.to)},Title,,0,0,0,,{\\an7\\pos(${title.x},${title.y})\\fs${title.size}\\b1\\c&H${color}&\\fad(180,100)}${text}`;
});
await writeFile(join(output, "titles.ass"), `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Title,Arial,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n${lines.join("\n")}\n`);
const frames = Math.round(config.duration * 30);
const timeline = { fps: 30, durationInFrames: frames, visuals: [], speech: [], captions: [], audio: [{ role: "voice", fromFrame: 0, durationInFrames: Math.round(config.outroStart * 30) }] } as unknown as Timeline;
await writeFile(join(output, "music.wav"), wavFile(musicTrack(timeline, "brand-reel").samples, MUSIC_RATE));
const end = config.outroStart;
const accent = config.accent.replace("#", "0x");
const filter = [
  "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[raw]",
  `[raw][3:v]overlay=0:0,drawbox=x=90:y=170:w=420:h=140:color=white:t=fill:enable='lt(t,${end})',drawbox=x=0:y=0:w=1080:h=1920:color=white:t=fill:enable='gte(t,${end})',drawbox=x=140:y=775:w=140:h=10:color=${accent}:t=fill:enable='gte(t,${end})',drawbox=x=140:y=1078:w=660:h=118:color=${accent}:t=fill:enable='gte(t,${end})'[base]`,
  "[1:v]split=2[smallin][largein]",
  "[smallin]scale=360:-1[small]",
  "[largein]scale=800:-1[large]",
  `[base][small]overlay=x=120:y=196:enable='lt(t,${end})'[branded]`,
  `[branded][large]overlay=x=140:y=520:enable='gte(t,${end})',ass=titles.ass,format=yuv420p[v]`,
  `[0:a]aresample=48000,apad,atrim=0:${config.duration},afade=t=out:st=${config.duration - 0.4}:d=0.4[voice]`,
  "[2:a]aresample=48000,volume=0.85[music]",
  `[voice][music]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9,atrim=0:${config.duration}[a]`,
].join(";\n");
await writeFile(join(output, "edit-filter.txt"), filter);
const args = ["-y", "-hide_banner", "-loglevel", "warning", "-i", source, "-loop", "1", "-i", logo, "-i", "music.wav", "-loop", "1", "-i", "shade.png", "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-t", String(config.duration), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-threads", "4", "brand-reel.mp4"];
const code = await new Promise<number | null>((done, reject) => { const child = spawn(ffmpeg, args, { cwd: output, stdio: "inherit", windowsHide: true }); child.on("error", reject); child.on("exit", done); });
if (code !== 0) throw new Error(`Reels encoding failed (${code}). Check FFmpeg with libass and that the source includes audio.`);
console.log(join(output, "brand-reel.mp4"));
