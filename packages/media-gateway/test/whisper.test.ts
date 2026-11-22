import { existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createProvidersFromEnv, WhisperCppSttAdapter, whisperWords, type WhisperRun } from "../src/index.ts";

const OUT = JSON.stringify({
  transcription: [
    {
      tokens: [
        { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
        { text: " Mer", offsets: { from: 100, to: 300 } },
        { text: "haba", offsets: { from: 300, to: 520 } },
        { text: " dünya", offsets: { from: 600, to: 900 } },
        { text: "<|endoftext|>", offsets: { from: 900, to: 900 } },
        { text: " eksik" },
        { offsets: { from: 940, to: 945 } },
        { text: "   ", offsets: { from: 950, to: 960 } },
      ],
    },
    { tokens: [{ text: " yeni", offsets: { from: 1200, to: 1500 } }] },
    {},
  ],
});

describe("whisper.cpp", () => {
  it("tokenleri kelimelere birleştirir, özel tokenleri ve zamansızları atar", () => {
    expect(whisperWords(OUT)).toEqual([
      { text: "Merhaba", startMs: 100, endMs: 520 },
      { text: "dünya", startMs: 600, endMs: 900 },
      { text: "yeni", startMs: 1200, endMs: 1500 },
    ]);
    expect(whisperWords("{}")).toEqual([]);
    // Boşluksuz ilk token yeni kelime açar.
    expect(whisperWords(JSON.stringify({ transcription: [{ tokens: [{ text: "ab", offsets: { from: 0, to: 5 } }] }] }))).toEqual([{ text: "ab", startMs: 0, endMs: 5 }]);
  });

  it("sesi geçici dosyaya yazar, CLI'ı tam JSON için çağırır, dökümü döndürür ve geçici klasörü siler", async () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const run: WhisperRun = async (cmd, args) => {
      calls.push({ cmd, args });
      writeFileSync(`${args[args.indexOf("-of") + 1]}.json`, OUT);
    };
    const stt = new WhisperCppSttAdapter("whisper-cli", "ggml-base.bin", run);
    const res = await stt.generate({ capability: "stt", quality: "standard", language: "pt-BR", refs: [{ role: "source_audio", bytes: new Uint8Array([1]), mimeType: "audio/wav" }] }, { fetch });
    expect(calls[0]!.cmd).toBe("whisper-cli");
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["-m", "ggml-base.bin", "-l", "pt", "-ojf", "-np"]));
    expect(existsSync(calls[0]!.args[calls[0]!.args.indexOf("-f") + 1]!)).toBe(false);
    expect(res.words).toHaveLength(3);
    expect(JSON.parse(new TextDecoder().decode(res.files[0]!.bytes))).toMatchObject({ text: "Merhaba dünya yeni" });
    expect(stt).toMatchObject({ id: "local:whisper", local: true, price: { unit: "free" }, capabilities: ["stt"] });
    await stt.generate({ capability: "stt", quality: "standard", refs: [{ role: "source_audio", bytes: new Uint8Array([1]), mimeType: "audio/wav" }] }, { fetch });
    expect(calls[1]!.args).toEqual(expect.arrayContaining(["-l", "auto"]));
  });

  it("ses yoksa çalıştırmadan hata; CLI düşerse hata yukarı çıkar", async () => {
    const run: WhisperRun = async () => {
      throw new Error("model yok");
    };
    const stt = new WhisperCppSttAdapter("w", "m", run);
    await expect(stt.generate({ capability: "stt", quality: "standard" }, { fetch })).rejects.toThrow("ses dosyası");
    await expect(stt.generate({ capability: "stt", quality: "standard", refs: [{ role: "source_audio", bytes: new Uint8Array([1]), mimeType: "audio/wav" }] }, { fetch })).rejects.toThrow("model yok");
  });

  it("varsayılan çalıştırıcı gerçek süreci çağırır (olmayan dosya hata verir)", async () => {
    const stt = new WhisperCppSttAdapter("ys-olmayan-whisper-cli", "m");
    await expect(stt.generate({ capability: "stt", quality: "standard", refs: [{ role: "source_audio", bytes: new Uint8Array([1]), mimeType: "audio/wav" }] }, { fetch })).rejects.toThrow();
  });

  it("env ile kurulur", () => {
    const ids = createProvidersFromEnv({ YS_WHISPER: "w", YS_WHISPER_MODEL: "m" } as unknown as NodeJS.ProcessEnv).providers.map((p) => p.id);
    expect(ids).toContain("local:whisper");
    expect(createProvidersFromEnv({ YS_WHISPER: "w" } as unknown as NodeJS.ProcessEnv).providers.map((p) => p.id)).not.toContain("local:whisper");
  });
});
