"use client";

import { AGY_BACKEND, type AcpBackend, type ModelSettings } from "@ys/core/models";
import { useState } from "react";
import { useI18n } from "../locale-provider";

export interface AcpSaved {
  acp: { backends: AcpBackend[] };
  models: ModelSettings;
}

/** Sunucunun JSON yanıtı; hata gövdesindeki `error` metni fırlatılır (yoksa durum kodu). */
async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? String(res.status));
  return body;
}

/**
 * ACP ajanları (Modeller sayfası): Agent Client Protocol konuşan ajan CLI'ları. Antigravity tek tıkla eklenir, başka bir
 * ajan komutuyla tanımlanır; modeller ajanın kendisinden bulunur (istem gönderilmez, kota harcanmaz).
 */
export function AcpAgents({ backends, onSaved }: { backends: AcpBackend[]; onSaved: (saved: AcpSaved) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState({ id: "", label: "", command: "", args: "" });

  const run = async (key: string, fn: () => Promise<AcpSaved>) => {
    setBusy(key);
    setError(undefined);
    try {
      onSaved(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const save = (list: AcpBackend[]) => call<AcpSaved>("/api/settings/acp", { method: "PUT", body: JSON.stringify({ backends: list }) });
  const discover = (id: string) => call<AcpSaved>("/api/settings/acp/discover", { method: "POST", body: JSON.stringify({ id }) });

  const addAgy = () =>
    run("agy", async () => {
      await save([...backends, AGY_BACKEND]);
      return discover(AGY_BACKEND.id);
    });
  const addCustom = () =>
    run("new", async () => {
      const backend: AcpBackend = { id: draft.id.trim(), label: draft.label.trim() || draft.id.trim(), command: draft.command.trim(), args: draft.args.split(/\s+/).filter(Boolean), models: [], efforts: [], images: false };
      const saved = await save([...backends, backend]);
      if (!saved.acp.backends.some((b) => b.id === backend.id)) throw new Error(t("models.acp.invalid"));
      setDraft({ id: "", label: "", command: "", args: "" });
      return discover(backend.id);
    });

  return (
    <section className="card">
      <h2 className="font-semibold">{t("models.acp.title")}</h2>
      <p className="mb-3 mt-1 text-xs text-muted">{t("models.acp.intro")}</p>
      <div className="grid gap-2.5">
        {backends.length === 0 && <p className="text-sm text-muted">{t("models.acp.none")}</p>}
        {backends.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/50 pb-2.5 text-sm last:border-0 last:pb-0">
            <div className="min-w-0">
              <div className="font-medium">{b.label}</div>
              <div className="text-xs text-muted">
                <code>{[b.command, ...b.args].join(" ")}</code> · {t("models.acp.count", { n: b.models.length })} · {t(b.images ? "models.acp.images" : "models.acp.noImages")}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost py-1 text-xs" disabled={!!busy} onClick={() => run(b.id, () => discover(b.id))}>
                {busy === b.id ? t("models.acp.discovering") : t("models.acp.discover")}
              </button>
              <button className="btn-ghost py-1 text-xs" disabled={!!busy} onClick={() => run(`rm-${b.id}`, () => save(backends.filter((x) => x.id !== b.id)))}>
                {t("models.acp.remove")}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        {!backends.some((b) => b.id === AGY_BACKEND.id) && (
          <button className="btn-primary py-1 text-xs" disabled={!!busy} onClick={addAgy}>
            {busy === "agy" ? t("models.acp.discovering") : t("models.acp.addAgy")}
          </button>
        )}
        {(["id", "label", "command", "args"] as const).map((field) => (
          <label key={field} className="grid gap-0.5 text-xs text-muted">
            {t(`models.acp.field.${field}`)}
            <input
              className="rounded-md border border-line bg-panel-2 px-2 py-1 text-sm"
              value={draft[field]}
              onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            />
          </label>
        ))}
        <button className="btn-ghost py-1 text-xs" disabled={!!busy || !draft.id.trim() || !draft.command.trim()} onClick={addCustom}>
          {busy === "new" ? t("models.acp.discovering") : t("models.acp.add")}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-bad">{t("models.acp.failed", { error })}</p>}
    </section>
  );
}
