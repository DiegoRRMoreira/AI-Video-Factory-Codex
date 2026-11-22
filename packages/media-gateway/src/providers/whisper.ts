import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LocalizedError, msg, type Capability, type WordTiming } from "@ys/core";
import type { GenerateContext, GenerationRequest, GenerationResult, PriceRule, ProviderAdapter, ProviderLimits } from "../types.ts";

/** whisper.cpp çağrısı; testler sahtesini verir. */
export type WhisperRun = (cmd: string, args: string[], signal?: AbortSignal) => Promise<unknown>;
const execRun: WhisperRun = (cmd, args, signal) => promisify(execFile)(cmd, args, { signal, maxBuffer: 64 * 1024 * 1024 });

interface WhisperToken {
  text?: string;
  offsets?: { from?: number; to?: number };
}

/**
 * whisper.cpp tam JSON çıktısından kelimeler: tokenler alt kelime parçalarıdır; boşlukla başlayan token yeni kelime
 * açar, özel tokenler ("[_BEG_]", "[_TT_…]", "<|…|>") atılır. Zaman ms (offsets).
 */
export function whisperWords(json: string): WordTiming[] {
  const data = JSON.parse(json) as { transcription?: { tokens?: WhisperToken[] }[] };
  const words: WordTiming[] = [];
  for (const segment of data.transcription ?? []) {
    for (const token of segment.tokens ?? []) {
      const text = token.text ?? "";
      if (!text.trim() || /^\s*(\[_|<\|)/.test(text) || token.offsets?.from === undefined || token.offsets.to === undefined) continue;
      const last = words.at(-1);
      if (last && !/^\s/.test(text)) {
        last.text += text;
        last.endMs = Math.max(last.endMs, token.offsets.to);
      } else words.push({ text: text.trim(), startMs: token.offsets.from, endMs: token.offsets.to });
    }
  }
  return words;
}

/**
 * Yerel konuşmadan metin (whisper.cpp, ücretsiz): maliyet önceliği kuralı gereği kuruluysa Scribe'dan önce seçilir.
 * `YS_WHISPER` çalıştırılabilir dosya (whisper-cli), `YS_WHISPER_MODEL` ggml modeli. Çıktı tam JSON (`-ojf`).
 * verified: false — bayraklar ve JSON biçimi whisper.cpp belgelerinden, bu makinede gerçek çağrıyla denenmedi.
 */
export class WhisperCppSttAdapter implements ProviderAdapter {
  readonly local = true;
  readonly capabilities: readonly Capability[] = ["stt"];
  readonly limits: ProviderLimits = {};
  readonly id = "local:whisper";
  readonly qualityPrior = 0.8;
  readonly price: PriceRule = { unit: "free" };

  constructor(
    private readonly bin: string,
    private readonly model: string,
    private readonly run: WhisperRun = execRun,
  ) {}

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const audio = req.refs?.find((r) => r.role === "source_audio");
    if (!audio) throw new LocalizedError(msg("gw.stt.missing"));
    const dir = await mkdtemp(join(tmpdir(), "ys-whisper-"));
    try {
      const input = join(dir, "audio.wav");
      const out = join(dir, "out");
      await writeFile(input, audio.bytes);
      const lang = req.language?.split("-")[0] ?? "auto";
      await this.run(this.bin, ["-m", this.model, "-f", input, "-l", lang, "-ojf", "-of", out, "-np"], ctx.signal);
      const raw = await readFile(`${out}.json`, "utf8");
      const words = whisperWords(raw);
      const json = JSON.stringify({ text: words.map((w) => w.text).join(" "), words });
      return { files: [{ bytes: new TextEncoder().encode(json), mimeType: "application/json" }], words };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
