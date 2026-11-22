import { discoverAcp, type AcpSpawn } from "@ys/agents";
import { LocalizedError, msg, type AcpSettings, type ModelSettings } from "@ys/core";
import type { AssetStore } from "@ys/storage";
import { loadAcpSettings, loadModelSettings, saveAcpSettings } from "./settings.ts";

/**
 * Tanımlı bir ACP ajanının modellerini, düşünme seviyelerini ve görsel desteğini bulup kaydına yazar (initialize +
 * session/new; istem gönderilmez, kota harcanmaz). Modeller sayfasının "Modelleri bul" düğmesi.
 */
export async function discoverAcpBackend(store: AssetStore, id: unknown, spawn?: AcpSpawn): Promise<{ acp: AcpSettings; models: ModelSettings }> {
  const settings = await loadAcpSettings(store);
  const backend = settings.backends.find((b) => b.id === id);
  if (!backend) throw new LocalizedError(msg("err.acp.unknown", { id: String(id) }));
  let found: Awaited<ReturnType<typeof discoverAcp>>;
  try {
    found = await discoverAcp(backend, spawn);
  } catch (e) {
    throw new LocalizedError(msg("err.acp.discover", { label: backend.label, detail: (e as Error).message.slice(0, 300) }));
  }
  const acp = await saveAcpSettings(store, { backends: settings.backends.map((b) => (b.id === backend.id ? { ...b, ...found } : b)) });
  return { acp, models: await loadModelSettings(store) };
}
