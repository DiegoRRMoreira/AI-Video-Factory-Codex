import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGY_BACKEND, formatText, isLocalizedError } from "@ys/core";
import { FsAssetStore, getJson, putJson, type AssetStore } from "@ys/storage";
import { fakeAcp } from "../../agents/test/acp-fake.ts";
import { discoverAcpBackend } from "../src/acp-settings.ts";
import { loadAcpSettings, loadAgentSettings, loadModelSettings, saveAcpSettings, saveModelSettings } from "../src/settings.ts";

const tempStore = (): AssetStore => new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-acp-settings-")));
const agy = { ...AGY_BACKEND, models: [{ id: "gemini-4-neon", name: "Gemini 4 Neon" }] };

describe("ACP ayarları", () => {
  it("ajan yoksa ACP seçimi düşer; ajan ve modeli varsa kalır; ajan silinince seçim de silinir", async () => {
    const store = tempStore();
    expect(await loadAcpSettings(store)).toEqual({ backends: [] });
    expect(await saveModelSettings(store, { "youtube-analyst": "acp:agy:gemini-4-neon", packager: "claude-haiku-5-5" })).toEqual({ packager: "claude-haiku-5-5" });
    expect((await saveAcpSettings(store, { backends: [agy, { id: "BAD" }] })).backends).toEqual([agy]);
    expect(await saveModelSettings(store, { "youtube-analyst": "acp:agy:gemini-4-neon", "youtube-curator": "acp:agy:yok" })).toEqual({ "youtube-analyst": "acp:agy:gemini-4-neon" });
    expect(await loadAgentSettings(store)).toEqual({ models: { "youtube-analyst": "acp:agy:gemini-4-neon" }, acp: [agy] });
    // Dosyadaki eski seçim okunurken de süzülür.
    await putJson(store, "settings/models.json", { "youtube-analyst": "acp:gone:x", packager: "claude-opus-5-5" });
    expect(await loadModelSettings(store)).toEqual({ packager: "claude-opus-5-5" });
    await saveModelSettings(store, { "youtube-analyst": "acp:agy:gemini-4-neon" });
    await saveAcpSettings(store, { backends: [] });
    expect(await getJson(store, "settings/models.json")).toEqual({});
  });

  it("hazır tanım dışındaki komut yalnız YS_ACP_COMMANDS ile; izin atlatan bayrak hiçbir zaman", async () => {
    const store = tempStore();
    const custom = { id: "claude", label: "Claude ACP", command: "claude-code-acp", args: [] };
    expect((await saveAcpSettings(store, { backends: [custom] })).backends).toEqual([]);
    process.env.YS_ACP_COMMANDS = " claude-code-acp ; other\ngemini   --experimental-acp";
    try {
      const raw = [
        custom,
        { ...custom, id: "bad", args: ["--dangerously-skip-permissions"] },
        // İzinli komut, izin listesinde olmayan argümanlarla: reddedilir.
        { ...custom, id: "args", args: ["--model", "x"] },
        { ...custom, id: "gem", command: "gemini", args: ["--experimental-acp"] },
      ];
      expect((await saveAcpSettings(store, { backends: raw })).backends.map((b) => b.id)).toEqual(["claude", "gem"]);
      expect((await loadAcpSettings(store)).backends.map((b) => b.id)).toEqual(["claude", "gem"]);
    } finally {
      delete process.env.YS_ACP_COMMANDS;
    }
    // İzin kaldırılınca kayıtlı ajan da okunmaz.
    expect((await loadAcpSettings(store)).backends).toEqual([]);
  });

  it("keşif modelleri ve görsel desteğini kayda yazar; tanımsız ajan ve keşif hatası çevrilebilir hata", async () => {
    const store = tempStore();
    await saveAcpSettings(store, { backends: [AGY_BACKEND, { ...AGY_BACKEND, id: "other", label: "Other" }] });
    const out = await discoverAcpBackend(store, "agy", fakeAcp({ config: true, image: true }).spawn);
    expect(out.acp.backends[0]).toMatchObject({ id: "agy", images: true, efforts: ["low", "medium", "high"], models: [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }] });
    expect(out.acp.backends[1]).toMatchObject({ id: "other", models: [] });
    expect(out.models).toEqual({});
    const err = async (p: Promise<unknown>) => {
      const e = await p.catch((x: unknown) => x);
      expect(isLocalizedError(e)).toBe(true);
      return formatText("en", (e as { text: never }).text);
    };
    expect(await err(discoverAcpBackend(store, "nope"))).toBe("Unknown ACP agent: nope");
    expect(await err(discoverAcpBackend(store, "other", fakeAcp({ initError: { code: 1, message: "login first" } }).spawn))).toBe("Could not list the models of Other: ACP initialize: login first");
  });
});
