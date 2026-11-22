"use client";

import { Clapperboard, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { VOICES } from "../lib/voices";
import { useI18n } from "./locale-provider";

const LANGS = ["tr", "en", "es", "pt-BR", "de", "fr", "ar", "hi", "ja", "id"];
/** Sunucunun kabul ettiği uzantılar (api/footage, @ys/pipeline FOOTAGE_TYPES). */
export const FOOTAGE_ACCEPT = ".mp4,.mov,.webm,.mkv,.m4v,.jpg,.jpeg,.png,.webp";

interface Item {
  id: number;
  file: File;
  status: "uploading" | "done" | "error";
  key?: string;
  error?: string;
}

/** Tek dosyayı bekleme alanına yükler; gövde dosyanın kendisidir. */
async function uploadFile(file: File): Promise<{ key: string } | { error: string }> {
  try {
    const res = await fetch("/api/footage", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
    return res.ok && body.key ? { key: body.key } : { error: body.error ?? res.statusText };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Kendi görüntünden Short (footage modu, 22 Kas): videolar ve resimler seçilince hemen yüklenir; süre, anlatım, konuşma
 * dökümü, ekran yazıları ve ses seçenekleri; gönderince bölüm açılır ve kurgu yazılır (kurgu onayında durur).
 */
export function FootageForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [next, setNext] = useState(1);

  async function add(files: File[]) {
    const fresh = files.map((file, i) => ({ id: next + i, file, status: "uploading" as const }));
    setNext(next + files.length);
    setItems((list) => [...list, ...fresh]);
    // Sırayla: büyük videolar aynı anda yüklenince sunucunun belleği şişmesin.
    for (const item of fresh) {
      const res = await uploadFile(item.file);
      setItems((list) => list.map((x) => (x.id === item.id ? { ...x, ...("key" in res ? { status: "done", key: res.key } : { status: "error", error: res.error }) } : x)));
    }
  }

  const ready = items.filter((i) => i.status === "done");
  const uploading = items.some((i) => i.status === "uploading");

  async function submit(form: FormData) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/episodes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: form.get("topic"),
          lang: form.get("lang"),
          voiceId: form.get("voiceId"),
          budgetUsd: Number(form.get("budgetUsd")),
          captions: form.get("captions") === "on",
          music: form.get("music") === "on",
          sfx: form.get("sfx") === "on",
          footage: {
            uploads: ready.map((i) => ({ key: i.key, name: i.file.name })),
            sec: Number(form.get("sec")),
            narration: form.get("narration") === "on",
            transcribe: form.get("transcribe") === "on",
            texts: String(form.get("texts")).split("\n"),
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? t("form.failed"));
        setBusy(false);
        return;
      }
      router.push(`/episodes/${body.id}`);
    } catch {
      setError(t("form.failed"));
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid content-start gap-6">
        <section className="card grid gap-4">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{t("footage.files")}</h2>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel-2 p-6 text-sm hover:border-muted">
            <Upload size={16} /> {t("footage.pick")}
            <input
              type="file"
              multiple
              accept={FOOTAGE_ACCEPT}
              className="sr-only"
              data-testid="footage-input"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) void add(files);
              }}
            />
          </label>
          <p className="text-xs text-muted">{t("footage.pickHint")}</p>
          {items.length > 0 && (
            <ul className="grid gap-1 text-sm">
              {items.map((i) => (
                <li key={i.id} data-status={i.status} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="truncate">{i.file.name}</span>
                  <span className={`shrink-0 text-xs ${i.status === "error" ? "text-bad" : "text-muted"}`}>
                    {i.status === "error" ? i.error : t(i.status === "done" ? "footage.uploaded" : "footage.uploading")}
                  </span>
                  <button type="button" aria-label={t("footage.remove")} className="shrink-0 text-muted hover:text-bad" disabled={i.status === "uploading"} onClick={() => setItems((list) => list.filter((x) => x.id !== i.id))}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card grid gap-4">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{t("footage.story")}</h2>
          <div>
            <label className="label" htmlFor="topic">{t("footage.brief")}</label>
            <textarea id="topic" name="topic" rows={3} className="field" placeholder={t("footage.brief.placeholder")} />
          </div>
          <div>
            <label className="label" htmlFor="texts">{t("footage.texts")}</label>
            <textarea id="texts" name="texts" rows={3} className="field" placeholder={t("footage.texts.placeholder")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="label" htmlFor="sec">{t("footage.sec")}</label>
              <input id="sec" name="sec" type="number" min={15} max={180} step={1} defaultValue={30} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="lang">{t("form.lang")}</label>
              <select id="lang" name="lang" className="field" defaultValue="tr">
                {LANGS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="voiceId">{t("form.voice")}</label>
              <select id="voiceId" name="voiceId" className="field" defaultValue={VOICES[0]?.id}>
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{t(v.label)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="budgetUsd">{t("form.budget")}</label>
              <input id="budgetUsd" name="budgetUsd" type="number" min={1} defaultValue={5} className="field" />
            </div>
          </div>
        </section>

        <section className="card grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(
            [
              ["narration", "footage.narration"],
              ["transcribe", "footage.transcribe"],
              ["captions", "form.captions"],
              ["music", "form.music"],
              ["sfx", "form.sfx"],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-panel-2 p-3 text-sm transition hover:border-muted">
              <input type="checkbox" name={name} defaultChecked className="mt-1" />
              <span>
                {t(label)}
                <span className="block text-xs text-muted">{t(`footage.hint.${name}`)}</span>
              </span>
            </label>
          ))}
        </section>
      </div>

      <aside className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card grid gap-1 text-sm text-muted">
          <p>{t("footage.summary", { n: ready.length })}</p>
          <p className="text-xs">{t("footage.flow")}</p>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn-primary justify-center py-3 text-base" disabled={busy || uploading || !ready.length}>
          <Clapperboard size={16} /> {busy ? t("form.submitting") : uploading ? t("footage.waitUploads") : t("footage.submit")}
        </button>
      </aside>
    </form>
  );
}
