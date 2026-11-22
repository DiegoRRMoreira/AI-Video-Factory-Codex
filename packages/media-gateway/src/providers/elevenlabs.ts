import { LocalizedError, msg, type Capability } from "@ys/core";
import { charAlignmentToWords } from "../audio.ts";
import { fromBase64, requestBytes, requestJson } from "../http.ts";
import type {
  GenerateContext,
  GenerationRequest,
  GenerationResult,
  PriceRule,
  PriceSource,
  ProviderAdapter,
  ProviderLimits,
  Quota,
} from "../types.ts";

const BASE = "https://api.elevenlabs.io/v1";

/** Eşzamanlı üretim (uzun metin, müzik) dakikalar sürebilir; varsayılan 120 sn istek sınırı yetmez. */
const GENERATION_TIMEOUT_MS = 600_000;

/*
 * Fiyatlar: https://elevenlabs.io/pricing/api (31 Eki 2026). Eleven v3 TTS $0.08/1K karakter, Flash/Turbo $0.04/1K,
 * ses efekti $0.12/dk, müzik $0.15/dk.
 */
const PRICING_URL = "https://elevenlabs.io/pricing/api";
const PRICE_CHECKED = "2026-10-31";

const SOURCE: PriceSource = {
  url: PRICING_URL,
  checked: PRICE_CHECKED,
  note: msg("price.note.elevenlabs"),
};

/** Flash/Turbo modelleri v3'ün yarı fiyatı. */
const ttsPricePer1k = (model: string): number => (/flash|turbo/i.test(model) ? 0.04 : 0.08);

interface Subscription {
  tier: string;
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix?: number;
}

/** Hesabın aylık karakter kotası; bütün ElevenLabs ürünleri aynı kotadan düşer. */
async function subscriptionQuota(apiKey: string, ctx: GenerateContext): Promise<Quota> {
  const s = await requestJson<Subscription>(ctx.fetch, `${BASE}/user/subscription`, {
    headers: { "xi-api-key": apiKey },
    signal: ctx.signal,
  });
  return {
    unit: "chars",
    used: s.character_count,
    limit: s.character_limit,
    plan: s.tier,
    resetsAt: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : undefined,
  };
}

interface TimestampResponse {
  audio_base64: string;
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

/** Eleven v3 TTS + karakter hizalaması → kelime zamanlamaları (timeline'ın omurgası). */
export class ElevenLabsTtsAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["tts", "tts_timestamps"];
  readonly limits: ProviderLimits = { requiresVoiceId: true };
  readonly id = "elevenlabs:tts";
  readonly qualityPrior = 0.9;
  readonly price: PriceRule;
  readonly priceSource = SOURCE;

  constructor(
    private readonly apiKey: string,
    private readonly model = "eleven_v3",
  ) {
    this.price = { unit: "per_1k_chars", usd: ttsPricePer1k(model) };
  }

  quota(ctx: GenerateContext): Promise<Quota> {
    return subscriptionQuota(this.apiKey, ctx);
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    if (!req.voiceId || !req.text) throw new LocalizedError(msg("gw.eleven.missing"));
    const res = await requestJson<TimestampResponse>(
      ctx.fetch,
      `${BASE}/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: req.text,
          model_id: this.model,
          ...(req.language ? { language_code: req.language } : {}),
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        }),
        signal: ctx.signal,
        timeoutMs: GENERATION_TIMEOUT_MS,
      },
    );
    const a = res.alignment;
    return {
      files: [{ bytes: fromBase64(res.audio_base64), mimeType: "audio/mpeg" }],
      words: a
        ? charAlignmentToWords(a.characters, a.character_start_times_seconds, a.character_end_times_seconds)
        : undefined,
    };
  }
}

interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  type?: string;
}

/**
 * Konuşmadan metin (ElevenLabs Scribe): kaynak videonun sesinden kelime zamanlı döküm (footage modu altyazısı).
 * verified: false — uç ve alan adları belgelerden (https://elevenlabs.io/docs/api-reference/speech-to-text/convert),
 * gerçek çağrıyla doğrulanmadı. Fiyat ~$0.40/saat (fiyat sayfası, 22 Kas 2026, doğrulanmadı). Sonuç dosyası dökümün
 * JSON'udur (önbellek ve defter için); kelimeler `words` alanında, boşluk ve ses olayları atılır.
 */
export class ElevenLabsSttAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["stt"];
  readonly limits: ProviderLimits = {};
  readonly id = "elevenlabs:stt";
  readonly qualityPrior = 0.9;
  readonly price: PriceRule = { unit: "per_minute", usd: 0.4 / 60, defaultSec: 60 };
  readonly priceSource: PriceSource = { url: PRICING_URL, checked: "2026-11-22", note: msg("price.note.stt") };

  constructor(
    private readonly apiKey: string,
    private readonly model = "scribe_v1",
  ) {}

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const audio = req.refs?.find((r) => r.role === "source_audio");
    if (!audio) throw new LocalizedError(msg("gw.stt.missing"));
    const form = new FormData();
    form.append("model_id", this.model);
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    // Scribe ISO 639 dil kodu bekler: bölge eki atılır (pt-BR → pt).
    if (req.language) form.append("language_code", req.language.split("-")[0]!);
    form.append("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }), "audio");
    const res = await requestJson<{ text?: string; words?: ScribeWord[] }>(ctx.fetch, `${BASE}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: form,
      signal: ctx.signal,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    const words = (res.words ?? [])
      .filter((w) => (w.type ?? "word") === "word" && w.text.trim() && w.start !== undefined && w.end !== undefined)
      .map((w) => ({ text: w.text.trim(), startMs: Math.max(0, Math.round(w.start! * 1000)), endMs: Math.max(0, Math.round(w.end! * 1000)) }));
    const json = JSON.stringify({ text: res.text ?? "", words });
    return { files: [{ bytes: new TextEncoder().encode(json), mimeType: "application/json" }], words };
  }
}

/** Ses efekti üretimi. Kanal SFX kütüphanesini bir kez doldurmak için (§18). */
export class ElevenLabsSfxAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["sfx"];
  readonly limits: ProviderLimits = { maxDurationSec: 30 };
  readonly id = "elevenlabs:sfx";
  readonly qualityPrior = 0.85;
  // Süre verilmezse ElevenLabs süreyi prompt'tan tahmin eder (en çok 30 sn): tahmin üst sınırla yapılır.
  readonly price: PriceRule = { unit: "per_minute", usd: 0.12, defaultSec: 30 };
  readonly priceSource: PriceSource = { url: PRICING_URL, checked: PRICE_CHECKED, note: msg("price.note.sfx") };

  constructor(private readonly apiKey: string) {}

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const audio = await requestBytes(ctx.fetch, `${BASE}/sound-generation`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: req.prompt,
        ...(req.durationSec !== undefined ? { duration_seconds: req.durationSec } : {}),
      }),
      signal: ctx.signal,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    return { files: [{ bytes: audio.bytes, mimeType: "audio/mpeg" }] };
  }
}

/** Eleven Music: ticari lisanslı müzik. Kanal müzik kütüphanesi için tek seferlik üretim (§18). */
export class ElevenLabsMusicAdapter implements ProviderAdapter {
  readonly local = false;
  readonly capabilities: readonly Capability[] = ["music"];
  readonly limits: ProviderLimits = { minDurationSec: 10, maxDurationSec: 300 };
  readonly id = "elevenlabs:music";
  readonly qualityPrior = 0.85;
  readonly price: PriceRule = { unit: "per_minute", usd: 0.15 };
  readonly priceSource: PriceSource = { url: PRICING_URL, checked: PRICE_CHECKED, note: "Eleven Music" };

  /**
   * model: https://elevenlabs.io/docs/api-reference/music/compose → music_v1 (API varsayılanı), music_v2, music_v2_5.
   * Açıkça gönderilir ki API varsayılanı değişince ses/fiyat sessizce değişmesin.
   */
  constructor(
    private readonly apiKey: string,
    private readonly model = "music_v1",
  ) {}

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const audio = await requestBytes(ctx.fetch, `${BASE}/music`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: req.prompt,
        music_length_ms: Math.round((req.durationSec ?? 60) * 1000),
        model_id: this.model,
        // Kanal müziği anlatımın altında çalar: vokal istenmez.
        force_instrumental: true,
      }),
      signal: ctx.signal,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    return { files: [{ bytes: audio.bytes, mimeType: "audio/mpeg" }] };
  }
}
