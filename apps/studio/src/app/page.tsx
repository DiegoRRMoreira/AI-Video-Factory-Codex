import Link from "next/link";
import { statusLabel } from "../lib/status";
import { sameSeries, seriesOf, STAGES, summarizeSeries, summaryStatus, type EpisodeSummary, type RunStatus } from "@ys/pipeline/light";
import { stylePackOf } from "@ys/core/styles";
import { episodeStyle, filterLibrary, libraryCosts, libraryFilters, libraryHref, libraryQueue, LIBRARY_QUEUES, LIBRARY_STATUSES, type LibraryParams } from "../lib/library";
import { Film, Plus } from "lucide-react";
import type { MessageKey } from "../lib/i18n";
import { kindLabel } from "../lib/episode-kind";
import { getI18n } from "../lib/locale";
import { ledgerEntries, repo } from "../lib/server";
import { Badge } from "./episodes/[id]/parts";
import { AutoRefresh } from "./auto-refresh";
import { DeleteEpisode } from "./delete-episode";

export const dynamic = "force-dynamic";

/** Kartın küçük resmi: ilk çekimin karesi, yoksa seçilen ilk konsept görseli. */
function thumbOf(e: EpisodeSummary): string | undefined {
  return e.thumbnail ? `/api/assets/${e.thumbnail}` : undefined;
}

const SEGMENT: Record<RunStatus | "pending", string> = {
  running: "bg-run animate-pulse",
  stalled: "bg-bad",
  error: "bg-bad",
  waiting: "bg-accent",
  done: "bg-ok",
  idle: "bg-panel-2",
  pending: "bg-panel-2",
};

/** "?series=Ad" o seriyi, "?series=-" serisizleri gösterir; parametre yoksa hepsi. */
const NO_SERIES = "-";

export default async function Home({ searchParams }: { searchParams: Promise<LibraryParams> }) {
  const [list, entries, { t, fmt, locale }, params] = await Promise.all([repo().summaries(), ledgerEntries(), getI18n(), searchParams]);
  const everything = list.episodes.filter((e) => e.input.topic !== "render demo");
  const series = summarizeSeries(everything);
  const filters = libraryFilters(params), filter = filters.series;
  const episodes = filterLibrary(everything, filters);
  const queueBase = filterLibrary(everything, { ...filters, queue: undefined });
  const styles = [...new Set([...everything.map(episodeStyle), ...(filters.style ? [filters.style] : [])])].sort();
  const unseries = everything.filter((e) => !seriesOf(e)).length;
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 0;
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 0 ? Math.min(requestedPage, Math.max(0, Math.ceil(episodes.length / 20) - 1)) : 0;
  const paged = { episodes: episodes.slice(page * 20, (page + 1) * 20), total: episodes.length };
  const pageHref = (p: number) => libraryHref(filters, { page: p });
  const costs = libraryCosts(episodes, entries);
  const statuses = new Map(episodes.map((e) => [e.id, summaryStatus(e)]));
  const running = [...statuses.values()].filter((s) => s.status === "running").length;

  return (
    <div className="grid gap-8">
      <section className="grid content-start gap-5">
        <AutoRefresh everyMs={running ? 4000 : 30_000} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{filter && filter !== NO_SERIES ? t("series.label", { name: filter }) : t("home.title")}</h1>
          {/* Seri sayfasındaysa yeni bölüm o serinin ayarlarıyla açılır. */}
          <Link href={filter && filter !== NO_SERIES ? `/episodes/new?series=${encodeURIComponent(filter)}` : "/episodes/new"} className="btn-primary">
            <Plus size={16} /> {t("nav.new")}
          </Link>
        </div>
        {series.length > 0 && (
          <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("series.filter")}>
            <Link href={libraryHref(filters, { series: undefined })} className={`chip ${filter === undefined ? "chip-on" : ""}`}>
              {t("series.all")} <span className="text-muted">{everything.length}</span>
            </Link>
            {series.map((s) => (
              <Link
                key={s.name}
                href={libraryHref(filters, { series: s.name })}
                className={`chip ${filter !== undefined && sameSeries(filter, s.name) ? "chip-on" : ""}`}
              >
                {s.name} <span className="text-muted">{s.episodes}</span>
              </Link>
            ))}
            {unseries > 0 && (
              <Link href={libraryHref(filters, { series: NO_SERIES })} className={`chip ${filter === NO_SERIES ? "chip-on" : ""}`}>
                {t("series.none")} <span className="text-muted">{unseries}</span>
              </Link>
            )}
          </nav>
        )}
        <form method="get" action="/" role="search" aria-label={t("library.search")} className="card grid min-w-0 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="min-w-0"><span className="label">{t("library.search")}</span><input className="field" name="q" defaultValue={filters.q} maxLength={500} type="search" placeholder={t("library.searchHint")} /></label>
          <label><span className="label">{t("library.status")}</span><select className="field" name="status" defaultValue={filters.status ?? ""}><option value="">{t("series.all")}</option>{LIBRARY_STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</select></label>
          <label><span className="label">{t("form.stylePack")}</span><select className="field" name="style" defaultValue={filters.style ?? ""}><option value="">{t("series.all")}</option>{styles.map(s => <option key={s} value={s}>{stylePackOf(s)?.name[locale] ?? (s === "auto" ? t("form.stylePack.auto") : s === "custom" ? t("form.stylePack.custom") : s)}</option>)}</select></label>
          <label><span className="label">{t("library.sort")}</span><select className="field" name="sort" defaultValue={filters.sort ?? "newest"}><option value="newest">{t("library.newest")}</option><option value="oldest">{t("library.oldest")}</option></select></label>
          {filter !== undefined && <input type="hidden" name="series" value={filter} />}
          {filters.queue && <input type="hidden" name="queue" value={filters.queue} />}
          <div className="flex flex-wrap items-end gap-2"><button className="btn-primary" type="submit">{t("library.apply")}</button><Link href="/" className="btn-ghost">{t("library.clear")}</Link></div>
        </form>
        <section className="grid min-w-0 gap-2" aria-label={t("library.queue")}>
          <h2 className="text-sm font-semibold">{t("library.queue")}</h2>
          <nav className="flex flex-wrap gap-2" aria-label={t("library.queue")}>
            <Link href={libraryHref(filters, { queue: undefined })} className={`chip ${!filters.queue ? "chip-on" : ""}`} aria-current={!filters.queue ? "page" : undefined}>{t("series.all")} · {queueBase.length}</Link>
            {LIBRARY_QUEUES.map(q => <Link key={q} href={libraryHref(filters, { queue: q })} className={`chip ${filters.queue === q ? "chip-on" : ""}`} aria-current={filters.queue === q ? "page" : undefined}>{t(`library.queue.${q}`)} · {queueBase.filter(e => libraryQueue(e) === q).length}</Link>)}
          </nav>
          <p className="text-xs text-muted">{t("library.queueHint")}</p>
        </section>
        <p className="text-xs text-muted">{t("library.scope", { n: episodes.length })} {t("library.budget", { usd: fmt.usd(costs.budget) })}</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi label={t("home.kpi.episodes")} value={fmt.number(episodes.length)} />
          <Kpi label={t("home.kpi.videos")} value={fmt.number(episodes.filter((e) => e.render).length)} />
          <Kpi label={t("library.media")} value={fmt.usd(costs.media / 1_000_000)} />
          <Kpi label={t("library.agents")} value={fmt.usd(costs.agents / 1_000_000)} />
          <Kpi label={t("home.kpi.spent")} value={fmt.usd(costs.total / 1_000_000)} />
          <Kpi label={t("home.kpi.running")} value={fmt.number(running)} tone={running ? "text-run" : undefined} />
        </div>
        {episodes.length === 0 && <p role="status" className="text-muted">{t(everything.length ? "library.empty" : "home.empty")}</p>}
        {list.notices.length > 0 && <p role="alert" className="text-sm text-accent">{t("home.indexWarning", { n: list.notices.length })}</p>}
        <ul className="grid gap-3 xl:grid-cols-2">
          {paged.episodes.map((e) => {
            const st = statuses.get(e.id)!;
            const thumb = thumbOf(e);
            const usd = costs.byId.get(e.id)!.total / 1_000_000;
            const queue = libraryQueue(e);
            return (
              <li key={e.id} className="relative">
                <Link href={`/episodes/${e.id}`} className="card flex gap-4 p-3 transition hover:border-muted">
                  <div className="relative hidden aspect-video w-44 shrink-0 overflow-hidden rounded-lg bg-panel-2 sm:block">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <Film size={22} className="absolute inset-0 m-auto text-muted/40" />
                    )}
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-1 content-between gap-2 py-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {seriesOf(e) && filter === undefined && <div className="text-[11px] font-medium text-accent">{seriesOf(e)}</div>}
                        <div className="break-words font-medium">{e.title ?? e.input.topic}</div>
                        <div className="mt-1 text-xs text-muted">
                          {e.input.lang.toUpperCase()} · {fmt.duration(e.input.targetSec)} · {t(kindLabel(e.input))} ·{" "}
                          {fmt.date(e.createdAt)}
                        </div>
                        {queue && <p className="mt-1 text-xs text-accent">{t(`library.queue.${queue}`)}</p>}
                      </div>
                      <Badge status={st.status}>{statusLabel(t, st)}</Badge>
                    </div>
                    <div className="flex items-center gap-3 pr-8">
                      <ol className="flex flex-1 gap-0.5" aria-label={t("home.stages", { done: Object.keys(e.done).length, total: STAGES.length })}>
                        {STAGES.map((s) => (
                          <li
                            key={s}
                            title={t(`stage.${s}` as MessageKey)}
                            className={`h-1.5 flex-1 rounded-full ${e.done[s] ? SEGMENT.done : st.stage === s ? SEGMENT[st.status] : SEGMENT.pending}`}
                          />
                        ))}
                      </ol>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {Object.keys(e.done).length}/{STAGES.length} · {fmt.usd(usd)}
                      </span>
                    </div>
                  </div>
                </Link>
                {/* Kartın dışında: bağlantının içine düğme konamaz. */}
                <DeleteEpisode id={e.id} title={e.title ?? e.input.topic} running={st.status === "running"} />
              </li>
            );
          })}
        </ul>
        {(page > 0 || paged.total > 20) && <nav className="flex items-center gap-3" aria-label={t("home.pages")}>
          {page > 0 && <Link className="btn-ghost" href={pageHref(page - 1)}>{t("quality.previous")}</Link>}
          <span className="text-sm text-muted">{t("home.page", { n: page + 1, total: Math.max(1, Math.ceil(paged.total / 20)) })}</span>
          {(page + 1) * 20 < paged.total && <Link className="btn-ghost" href={pageHref(page + 1)}>{t("quality.next")}</Link>}
        </nav>}
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
