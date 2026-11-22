import { cleanAcpSettings, cleanModelSettings, type AcpBackend, type AcpSettings, type ModelSettings } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";

const MODELS_KEY = "settings/models.json";
const ACP_KEY = "settings/acp.json";

/**
 * Hazır tanımların dışında çalıştırılmasına izin verilen ACP komut satırları (sunucu ortamı; argümanlarıyla tam satır,
 * noktalı virgül ya da satır sonuyla ayrılır; ör. "claude-code-acp; gemini --experimental-acp").
 */
export const allowedAcpCommands = (): string[] =>
  (process.env.YS_ACP_COMMANDS ?? "")
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Tanımlı ACP ajanları (Stüdyo → Modeller). Dosya yoksa ya da bozuksa hiç ajan yok. */
export async function loadAcpSettings(store: AssetStore): Promise<AcpSettings> {
  return cleanAcpSettings(await getJson(store, ACP_KEY), allowedAcpCommands());
}

/** Yalnız geçerli ajanlar yazılır; artık var olmayan bir ajanın modeline bağlı seçimler de düşer. */
export async function saveAcpSettings(store: AssetStore, raw: unknown): Promise<AcpSettings> {
  const clean = cleanAcpSettings(raw, allowedAcpCommands());
  await putJson(store, ACP_KEY, clean);
  await putJson(store, MODELS_KEY, cleanModelSettings(await getJson(store, MODELS_KEY), clean.backends));
  return clean;
}

/**
 * Ajan çağrılarının ayarları: model seçimi ve ACP ajanları birlikte. ACP seçimleri yalnız tanımlı bir ajanın
 * keşfedilmiş modeliyse kalır (silinen ajan çağrıyı düşürmesin).
 */
export async function loadAgentSettings(store: AssetStore): Promise<{ models: ModelSettings; acp: AcpBackend[] }> {
  const { backends } = await loadAcpSettings(store);
  return { models: cleanModelSettings(await getJson(store, MODELS_KEY), backends), acp: backends };
}

/** Kullanıcının ajan başına model seçimi (Stüdyo → Modeller). Dosya yoksa ya da bozuksa boş: varsayılanlar geçerli. */
export async function loadModelSettings(store: AssetStore): Promise<ModelSettings> {
  return (await loadAgentSettings(store)).models;
}

/** Yalnız geçerli seçimler yazılır; varsayılanla aynı olan seçim de saklanır (kullanıcı bilerek seçti). */
export async function saveModelSettings(store: AssetStore, raw: unknown): Promise<ModelSettings> {
  const { backends } = await loadAcpSettings(store);
  const clean = cleanModelSettings(raw, backends);
  await putJson(store, MODELS_KEY, clean);
  return clean;
}
