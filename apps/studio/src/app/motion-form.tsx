"use client";

import { Sparkles, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { VOICES } from "../lib/voices";
import { uploadFile } from "./footage-form";
import { useI18n } from "./locale-provider";

const LANGS = ["tr", "en", "es", "pt-BR", "de", "fr", "ar", "hi", "ja", "id"];
/** Filmde kullanılabilen görseller (@ys/pipeline MOTION_IMAGE_EXTS). */
export const MOTION_ACCEPT = ".jpg,.jpeg,.png,.webp";
/** Marka renkleri: virgül ya da boşlukla ayrılmış #RRGGBB'ler (en çok 6). */
export const colorsOf = (text: string) => [...new Set(text.split(/[\s,;]+/).map((c) => c.trim().toLowerCase()).filter((c) => /^#[0-9a-f]{6}$/.test(c)))].slice(0, 6);

interface Item {
  id: number;
  file: File;
  status: "uploading" | "done" | "error";
  key?: string;
  error?: string;
}

/**
 * Hareketli grafik filmi formu (22 Kas): brif, süre, kare oranı, marka renkleri, isteğe bağlı logo ve ekran görüntüleri
 * (footage yüklemesiyle), anlatım (varsayılan kapalı: müzik ve efekt). Gönderince bölüm açılır ve yönetmen filmi yazar
 * (senaryo onayında durur).
 */
export function MotionForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [next, setNext] = useState(1);
  const [colors, setColors] = useState("");
  const [narration, setNarration] = useState(false);

  async function add(files: File[]) {
    const fresh = files.map((file, i) => ({ id: next + i, file, status: "uploading" as const }));
    setNext(next + files.length);
    setItems((list) => [...list, ...fresh]);
    for (const item of fresh) {
      const res = await uploadFile(item.file);
      setItems((list) => list.map((x) => (x.id === item.id ? { ...x, ...("key" in res ? { status: "done", key: res.key } : { status: "error", error: res.error }) } : x)));
    }
  }

  const ready = items.filter((i) => i.status === "done");
  const uploading = items.some((i) => i.status === "uploading");
  const swatches = colorsOf(colors);

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
          motion: {
            uploads: ready.map((i) => ({ key: i.key, name: i.file.name })),
            sec: Number(form.get("sec")),
            vertical: form.get("aspect") === "vertical",
            colors: swatches,
            narration,
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
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{t("film.story")}</h2>
          <div>
            <label className="label" htmlFor="topic">{t("film.brief")}</label>
            <textarea id="topic" name="topic" rows={5} required className="field" placeholder={t("film.brief.placeholder")} />
            <p className="mt-1 text-xs text-muted">{t("film.brief.hint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="label" htmlFor="sec">{t("film.sec")}</label>
              <input id="sec" name="sec" type="number" min={10} max={180} step={1} defaultValue={30} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="aspect">{t("film.aspect")}</label>
              <select id="aspect" name="aspect" className="field" defaultValue="wide">
                <option value="wide">{t("film.aspect.wide")}</option>
                <option value="vertical">{t("film.aspect.vertical")}</option>
              </select>
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
              <label className="label" htmlFor="budgetUsd">{t("form.budget")}</label>
              <input id="budgetUsd" name="budgetUsd" type="number" min={1} defaultValue={5} className="field" />
            </div>
          </div>
        </section>

        <section className="card grid gap-4">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{t("film.brand")}</h2>
          <div>
            <label className="label" htmlFor="colors">{t("film.colors")}</label>
            <input id="colors" className="field" value={colors} placeholder="#2563eb, #f59e0b" onChange={(e) => setColors(e.target.value)} />
            <div className="mt-2 flex gap-1" data-testid="film-swatches">
              {swatches.map((c) => (
                <span key={c} title={c} className="h-6 w-6 rounded border border-line" style={{ background: c }} />
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel-2 p-5 text-sm hover:border-muted">
            <Upload size={16} /> {t("film.images")}
            <input
              type="file"
              multiple
              accept={MOTION_ACCEPT}
              className="sr-only"
              data-testid="motion-input"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) void add(files);
              }}
            />
          </label>
          <p className="text-xs text-muted">{t("film.images.hint")}</p>
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

        <section className="card grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-panel-2 p-3 text-sm transition hover:border-muted">
            <input type="checkbox" checked={narration} className="mt-1" onChange={(e) => setNarration(e.target.checked)} />
            <span>
              {t("film.narration")}
              <span className="block text-xs text-muted">{t("film.hint.narration")}</span>
            </span>
          </label>
          {(
            [
              ["captions", "form.captions"],
              ["music", "form.music"],
              ["sfx", "form.sfx"],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-panel-2 p-3 text-sm transition hover:border-muted">
              <input type="checkbox" name={name} defaultChecked className="mt-1" />
              <span>
                {t(label)}
                <span className="block text-xs text-muted">{t(`film.hint.${name}`)}</span>
              </span>
            </label>
          ))}
          {narration && (
            <div className="md:col-span-2">
              <label className="label" htmlFor="voiceId">{t("form.voice")}</label>
              <select id="voiceId" name="voiceId" className="field" defaultValue={VOICES[0]?.id}>
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{t(v.label)}</option>
                ))}
              </select>
            </div>
          )}
        </section>
      </div>

      <aside className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card grid gap-1 text-sm text-muted">
          <p>{t("film.summary", { n: ready.length, colors: swatches.length })}</p>
          <p className="text-xs">{t("film.flow")}</p>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn-primary justify-center py-3 text-base" disabled={busy || uploading}>
          <Sparkles size={16} /> {busy ? t("form.submitting") : uploading ? t("footage.waitUploads") : t("film.submit")}
        </button>
      </aside>
    </form>
  );
}
