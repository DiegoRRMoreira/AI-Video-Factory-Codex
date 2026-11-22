import { describe, expect, it } from "vitest";
import { ElevenLabsSttAdapter } from "../src/index.ts";

const EL = "https://api.elevenlabs.io/v1";

function capture(response: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("ElevenLabs STT", () => {
  it("ses yoksa istek atmadan hata verir", async () => {
    const { fetch, calls } = capture({});
    await expect(new ElevenLabsSttAdapter("k").generate({ capability: "stt", quality: "standard" }, { fetch })).rejects.toThrow("ses dosyası");
    expect(calls).toHaveLength(0);
  });

  it("çok parçalı istek gönderir; boşluk ve ses olaylarını atar, zamanları ms yapar", async () => {
    const { fetch, calls } = capture({
      text: "Merhaba dünya",
      words: [
        { text: "Merhaba", start: 0.1234, end: 0.5, type: "word" },
        { text: " ", start: 0.5, end: 0.6, type: "spacing" },
        { text: "(laughter)", start: 0.6, end: 0.9, type: "audio_event" },
        { text: " dünya ", start: 1, end: 1.4 },
        { text: "eksik", start: 2 },
        { text: "  ", start: 2, end: 3, type: "word" },
      ],
    });
    const stt = new ElevenLabsSttAdapter("anahtar", "scribe_v2");
    const res = await stt.generate(
      { capability: "stt", quality: "standard", language: "tr", refs: [{ role: "source_audio", bytes: new Uint8Array([1, 2]), mimeType: "audio/wav" }] },
      { fetch },
    );
    expect(calls[0]!.url).toBe(`${EL}/speech-to-text`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ "xi-api-key": "anahtar" });
    const form = calls[0]!.init.body as FormData;
    expect([form.get("model_id"), form.get("timestamps_granularity"), form.get("language_code"), form.get("tag_audio_events")]).toEqual(["scribe_v2", "word", "tr", "false"]);
    expect((form.get("file") as Blob).size).toBe(2);
    expect(res.words).toEqual([
      { text: "Merhaba", startMs: 123, endMs: 500 },
      { text: "dünya", startMs: 1000, endMs: 1400 },
    ]);
    expect(JSON.parse(new TextDecoder().decode(res.files[0]!.bytes))).toEqual({ text: "Merhaba dünya", words: res.words });
    expect(res.files[0]!.mimeType).toBe("application/json");
    expect(stt).toMatchObject({ id: "elevenlabs:stt", capabilities: ["stt"], price: { unit: "per_minute", defaultSec: 60 } });
  });

  it("dil verilmezse alanı göndermez; kelime listesi yoksa boş döküm", async () => {
    const { fetch, calls } = capture({});
    const res = await new ElevenLabsSttAdapter("k").generate(
      { capability: "stt", quality: "standard", refs: [{ role: "source_audio", bytes: new Uint8Array([1]), mimeType: "audio/wav" }] },
      { fetch },
    );
    const form = calls[0]!.init.body as FormData;
    expect(form.get("language_code")).toBeNull();
    expect(form.get("model_id")).toBe("scribe_v1");
    expect(res.words).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode(res.files[0]!.bytes))).toEqual({ text: "", words: [] });
  });
});
