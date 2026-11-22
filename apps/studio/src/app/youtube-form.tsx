"use client";

import { Film } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "./locale-provider";

const LANGS = ["tr", "en", "es", "pt-BR", "de", "fr", "ar", "hi", "ja", "id"];

/**
 * YouTube'dan Short (22 Kas): adres, rapor dili, aday sayısı, Short süresi, konuşma tanıma ve Short'ların sesleri; hak
 * onayı zorunlu. Gönderince analiz bölümü açılır ve iş hemen başlar (indirme → döküm → sahneler → analiz → adaylar).
 */
export function YoutubeForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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
          budgetUsd: Number(form.get("budgetUsd")),
          captions: form.get("captions") === "on",
          music: form.get("music") === "on",
          sfx: form.get("sfx") === "on",
          youtube: {
            url: form.get("url"),
            count: Number(form.get("count")),
            minSec: Number(form.get("minSec")),
            maxSec: Number(form.get("maxSec")),
            transcribe: form.get("transcribe") === "on",
            rights: form.get("rights") === "on",
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
          <div>
            <label className="label" htmlFor="url">{t("youtube.url")}</label>
            <input id="url" name="url" required className="field" placeholder="https://www.youtube.com/watch?v=…" />
          </div>
          <div>
            <label className="label" htmlFor="topic">{t("youtube.note")}</label>
            <textarea id="topic" name="topic" rows={2} className="field" placeholder={t("youtube.note.placeholder")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="label" htmlFor="count">{t("youtube.count")}</label>
              <input id="count" name="count" type="number" min={1} max={12} defaultValue={6} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="minSec">{t("youtube.minSec")}</label>
              <input id="minSec" name="minSec" type="number" min={15} max={180} defaultValue={20} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="maxSec">{t("youtube.maxSec")}</label>
              <input id="maxSec" name="maxSec" type="number" min={15} max={180} defaultValue={60} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="lang">{t("youtube.lang")}</label>
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

        <section className="card grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ["transcribe", "youtube.transcribe"],
              ["captions", "form.captions"],
              ["music", "form.music"],
              ["sfx", "form.sfx"],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line bg-panel-2 p-3 text-sm transition hover:border-muted">
              <input type="checkbox" name={name} defaultChecked className="mt-1" />
              <span>
                {t(label)}
                <span className="block text-xs text-muted">{t(`youtube.hint.${name}`)}</span>
              </span>
            </label>
          ))}
        </section>
      </div>

      <aside className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
        <div className="card grid gap-2 text-sm text-muted">
          <p>{t("youtube.flow")}</p>
          <p className="text-xs">{t("youtube.models")}</p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="rights" required className="mt-1" />
          <span>{t("youtube.rights")}</span>
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn-primary flex items-center justify-center gap-2" disabled={busy}>
          <Film size={16} /> {t(busy ? "youtube.starting" : "youtube.start")}
        </button>
      </aside>
    </form>
  );
}
