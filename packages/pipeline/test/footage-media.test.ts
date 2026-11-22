import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ list: [] as { tool: string; args: string[]; bundled?: boolean }[], stdout: "" }));
vi.mock("@ys/video/tools", () => ({
  runMediaTool: async (tool: string, args: string[], bundled?: boolean) => {
    calls.list.push({ tool, args, bundled });
    // ffmpeg çıktıyı son argümana yazar.
    if (tool === "ffmpeg") await writeFile(args.at(-1)!, new Uint8Array([7, 7]));
    return { stdout: calls.stdout, stderr: "" };
  },
}));

const { cutVideo, extractAudio, FOOTAGE_MEDIA, frameFilter, frameImage, parseProbe, probeMedia, sampleFrame } = await import("../src/footage-media.ts");
const { footageKindOf, isFootageExt, sniffFootage } = await import("../src/footage.ts");

beforeEach(() => {
  calls.list = [];
  calls.stdout = "";
});

describe("parseProbe", () => {
  const probe = (streams: unknown[], duration?: string) => JSON.stringify({ streams, format: duration ? { duration } : {} });

  it("video: ölçüler, süre ve ses akışı", () => {
    expect(parseProbe(probe([{ codec_type: "video", width: 1920, height: 1080 }, { codec_type: "audio" }], "12.3456"), "video")).toEqual({ kind: "video", durationMs: 12346, width: 1920, height: 1080, audio: true });
  });

  it("telefon videosunun dönüşü en ve boyu değiştirir (yan veri ya da etiket)", () => {
    expect(parseProbe(probe([{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{}, { rotation: -90 }] }], "3"), "video")).toMatchObject({ width: 1080, height: 1920, audio: false });
    expect(parseProbe(probe([{ codec_type: "video", width: 1920, height: 1080, tags: { rotate: "270" } }], "3"), "video")).toMatchObject({ width: 1080, height: 1920 });
    expect(parseProbe(probe([{ codec_type: "video", width: 1920, height: 1080, tags: { rotate: "180" } }], "3"), "video")).toMatchObject({ width: 1920, height: 1080 });
  });

  it("resim: süre ve ses yok sayılır", () => {
    expect(parseProbe(probe([{ codec_type: "video", width: 800, height: 600 }, { codec_type: "audio" }]), "image")).toEqual({ kind: "image", durationMs: 0, width: 800, height: 600, audio: false });
  });

  it("görüntü akışı, süre ya da geçerli JSON yoksa hata", () => {
    expect(() => parseProbe(probe([{ codec_type: "audio" }], "3"), "video")).toThrow("görüntü akışı yok");
    expect(() => parseProbe(JSON.stringify({}), "video")).toThrow("görüntü akışı yok");
    expect(() => parseProbe(probe([{ codec_type: "video", width: 10, height: 10 }]), "video")).toThrow("ffprobe");
    expect(() => parseProbe("bozuk", "video")).toThrow("ffprobe");
  });
});

describe("ffmpeg adımları", () => {
  it("probeMedia ffprobe'u JSON çıktıyla çağırır", async () => {
    calls.stdout = JSON.stringify({ streams: [{ codec_type: "video", width: 4, height: 2 }], format: { duration: "1" } });
    expect(await probeMedia("a.mp4", "video")).toMatchObject({ width: 4, height: 2, durationMs: 1000 });
    expect(calls.list[0]).toMatchObject({ tool: "ffprobe" });
    expect(calls.list[0]!.args).toContain("json");
  });

  it("tür izin listesi", () => {
    expect([isFootageExt("mp4"), isFootageExt("MOV"), isFootageExt("gif"), isFootageExt("toString")]).toEqual([true, false, false, false]);
    expect([footageKindOf("mov"), footageKindOf("webp")]).toEqual(["video", "image"]);
  });

  it("dosya imzası uzantısına uymalı", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const box = (name: string) => new Uint8Array([0, 0, 0, 24, ...enc(name)]);
    expect([sniffFootage(box("ftyp"), "mp4"), sniffFootage(box("ftyp"), "m4v"), sniffFootage(box("moov"), "mp4")]).toEqual([true, true, false]);
    expect(["ftyp", "moov", "mdat", "wide", "free", "junk"].map((n) => sniffFootage(box(n), "mov"))).toEqual([true, true, true, true, true, false]);
    const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]);
    expect([sniffFootage(ebml, "webm"), sniffFootage(ebml, "mkv"), sniffFootage(new Uint8Array([0x1a]), "mkv")]).toEqual([true, true, false]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect([sniffFootage(jpeg, "jpg"), sniffFootage(jpeg, "jpeg"), sniffFootage(jpeg, "png")]).toEqual([true, true, false]);
    expect(sniffFootage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png")).toBe(true);
    expect([sniffFootage(enc("RIFF1234WEBPVP8"), "webp"), sniffFootage(enc("RIFF1234WAVE"), "webp")]).toEqual([true, false]);
    expect(sniffFootage(jpeg, "gif")).toBe(false);
  });

  it("kadraj filtresi: cover odaktan kırpar, contain bulanık dolgunun üstüne ortalar", () => {
    expect(frameFilter("cover", 1.4, 1080, 1920)).toBe("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*1:(ih-1920)/2,setsar=1");
    expect(frameFilter("cover", -1, 1080, 1920)).toContain("(iw-1080)*0:");
    const contain = frameFilter("contain", 0.25, 1080, 1920);
    expect(contain).toContain("[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*0.25:(ih-1920)/2");
    expect(contain).toContain(`boxblur=${FOOTAGE_MEDIA.blur}:2`);
    expect(contain).toContain("force_original_aspect_ratio=decrease:force_divisible_by=2[fg]");
    expect(contain).toContain("overlay=(W-w)/2:(H-h)/2,setsar=1");
  });

  it("kare: videoda zamana atlar, resimde atlamaz; küçük JPEG", async () => {
    expect(await sampleFrame("a.mp4", 1500, "video")).toEqual(new Uint8Array([7, 7]));
    await sampleFrame("a.jpg", 0, "image");
    expect(calls.list[0]!.args.slice(2, 6)).toEqual(["error", "-ss", "1.500", "-i"]);
    expect(calls.list[1]!.args).not.toContain("-ss");
    expect(calls.list[1]!.args).toContain(`scale=-2:${FOOTAGE_MEDIA.frameHeight}`);
  });

  it("ses: döküm için tek kanal 16 kHz; render için aralıklı, yavaşlatılmış 48 kHz stereo", async () => {
    await extractAudio("a.mp4", { stt: true });
    await extractAudio("a.mp4", { fromMs: 1000, toMs: 2500, speed: 0.8 });
    await extractAudio("a.mp4", { fromMs: 1000, speed: 1 });
    await extractAudio("a.mp4");
    const [stt, part, open, whole] = calls.list.map((c) => c.args);
    expect(stt).toEqual(expect.arrayContaining(["-ac", "1", "-ar", "16000"]));
    expect(stt).not.toContain("-ss");
    expect(part).toEqual(expect.arrayContaining(["-ss", "1.000", "-to", "2.500", "-af", "atempo=0.8", "-ac", "2", "-ar", "48000"]));
    expect(open).not.toContain("-ss");
    expect(open).not.toContain("-af");
    expect(whole).not.toContain("-af");
  });

  it("parça: sessiz, dikey, sabit fps; yavaşlatma pts ile; yedek ffmpeg kullanılmaz", async () => {
    await cutVideo("a.mp4", { fromMs: 0, toMs: 2000, focusX: 0.5, fit: "cover", width: 1080, height: 1920, fps: 30, speed: 0.75 });
    await cutVideo("a.mp4", { fromMs: 0, toMs: 2000, focusX: 0.5, fit: "cover", width: 1080, height: 1920, fps: 30 });
    const [slow, normal] = calls.list;
    expect(slow!.bundled).toBe(false);
    expect(slow!.args).toContain("-an");
    expect(slow!.args.find((a) => a.includes("setpts"))).toMatch(/,setpts=PTS\/0\.75,fps=30$/);
    expect(normal!.args.find((a) => a.includes("fps="))).not.toContain("setpts");
  });

  it("resim dikey kareye oturur", async () => {
    expect(await frameImage("a.png", { focusX: 0.5, fit: "contain", width: 1080, height: 1920 })).toEqual(new Uint8Array([7, 7]));
    expect(calls.list[0]!.args).toContain("-frames:v");
  });
});
