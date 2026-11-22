import { stylePackOf } from "@ys/core/styles";
import { listLibraryCharacters, loadStyleSamples, summarizeSeries } from "@ys/pipeline/light";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getI18n } from "../../../lib/locale";
import { repo, store } from "../../../lib/server";
import { NewEpisodeForm } from "../../new-episode-form";
import { FootageForm } from "../../footage-form";

export const dynamic = "force-dynamic";

/**
 * Yeni bölüm sayfası: form tam genişlikte. "?series=Ad" ile açılırsa ayarlar o serinin son bölümünden dolar;
 * "?kind=footage" kendi görüntünden Short formunu açar.
 */
export default async function NewEpisodePage({ searchParams }: { searchParams: Promise<{ series?: string; kind?: string }> }) {
  const [list, { t }, params, library, samples] = await Promise.all([repo().summaries(), getI18n(), searchParams, listLibraryCharacters(store()), loadStyleSamples(store())]);
  const series = summarizeSeries(list.episodes.filter((e) => e.input.topic !== "render demo"));
  // Karakter bankasından seçilebilenler: stili bir paketle yeniden kurulabilenler.
  const bank = library.filter((c) => c.pack && stylePackOf(c.pack));
  const footage = params.kind === "footage";
  const tab = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm ${on ? "bg-accent/15 text-accent" : "text-muted hover:text-white"}`;
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <Link href="/" className="flex w-fit items-center gap-1 text-sm text-muted hover:text-white">
          <ArrowLeft size={14} /> {t("form.back")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t(footage ? "footage.title" : "form.title")}</h1>
        <p className="text-sm text-muted">{t(footage ? "footage.subtitle" : "form.subtitle")}</p>
        <nav className="mt-2 flex gap-2">
          <Link href="/episodes/new" className={tab(!footage)} aria-current={footage ? undefined : "page"}>{t("footage.tab.topic")}</Link>
          <Link href="/episodes/new?kind=footage" className={tab(footage)} aria-current={footage ? "page" : undefined}>{t("footage.tab.footage")}</Link>
        </nav>
      </div>
      {footage ? <FootageForm /> : <NewEpisodeForm series={series} initialSeries={params.series || undefined} bank={bank} samples={samples} />}
    </div>
  );
}
