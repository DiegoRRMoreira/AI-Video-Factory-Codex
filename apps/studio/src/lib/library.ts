import { sameSeries, seriesOf, summaryStatus, type EpisodeSummary, type RunStatus } from "@ys/pipeline/light";
import type { CostEntry } from "@ys/media-gateway";

export const LIBRARY_QUEUES = ["script", "concept", "preview", "failed", "missing", "ready"] as const;
export type LibraryQueue = typeof LIBRARY_QUEUES[number];
export const LIBRARY_STATUSES: RunStatus[] = ["running", "waiting", "error", "stalled", "idle", "done"];
export type LibraryParams = Partial<Record<"q" | "series" | "style" | "status" | "queue" | "sort" | "page", string | string[]>>;
export interface LibraryFilters { q?: string; series?: string; style?: string; status?: RunStatus; queue?: LibraryQueue; sort?: "oldest" }

export function libraryFilters(params: LibraryParams): LibraryFilters {
  const str = (key: keyof LibraryParams, max: number) => typeof params[key] === "string" ? params[key].trim().slice(0, max) || undefined : undefined;
  const status = str("status", 20), queue = str("queue", 20);
  return { q: str("q", 500), series: str("series", 80), style: str("style", 160),
    status: LIBRARY_STATUSES.includes(status as RunStatus) ? status as RunStatus : undefined,
    queue: LIBRARY_QUEUES.includes(queue as LibraryQueue) ? queue as LibraryQueue : undefined,
    sort: str("sort", 20) === "oldest" ? "oldest" : undefined };
}

export const episodeStyle = (e: EpisodeSummary) => e.style?.pack ?? e.input.stylePack ?? "auto";

/** Kayıtlı üretim durumudur; dosya sağlığı veya editöryal yayın onayı anlamına gelmez. */
export function libraryQueue(e: EpisodeSummary): LibraryQueue | undefined {
  const s = summaryStatus(e);
  if (s.status === "running") return undefined;
  if (s.status === "error" || s.status === "stalled") return "failed";
  if (s.status === "waiting") return s.stage === "render" ? "preview" : s.stage === "voice" ? "concept" : "script";
  if (!e.render && (e.done.timeline || e.done.render || s.status === "done")) return "missing";
  if (e.render && e.done.render) return "ready";
  return undefined;
}

export function filterLibrary(episodes: EpisodeSummary[], filters: LibraryFilters): EpisodeSummary[] {
  // Sayfalama sonradan yapılır; KPI ve kuyruk sayıları bütün eşleşen kümeyi kapsar.
  const term = filters.q?.toLocaleLowerCase("tr");
  return episodes.filter(e => (!term || `${e.title ?? ""} ${e.input.topic}`.toLocaleLowerCase("tr").includes(term))
    && (filters.series === undefined || (filters.series === "-" ? !seriesOf(e) : sameSeries(seriesOf(e), filters.series)))
    && (!filters.status || summaryStatus(e).status === filters.status)
    && (!filters.style || episodeStyle(e) === filters.style)
    && (!filters.queue || libraryQueue(e) === filters.queue))
    .sort((a, b) => (filters.sort === "oldest" ? 1 : -1) * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}

export function libraryHref(filters: LibraryFilters, changes: Partial<LibraryFilters> & { page?: number } = {}): string {
  const values = { ...filters, ...changes }, query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, String(value));
  return query.size ? `/?${query}` : "/";
}

export function libraryCosts(episodes: EpisodeSummary[], entries: CostEntry[]) {
  const byId = new Map(episodes.map(e => [e.id, { media: 0, agents: 0, total: 0 }]));
  for (const entry of entries) {
    const cost = byId.get(entry.episodeId!);
    if (!cost || entry.cacheHit) continue;
    if (entry.capability === "llm") cost.agents += entry.estimateMicros;
    else cost.media += entry.estimateMicros;
    cost.total += entry.estimateMicros;
  }
  const totals = [...byId.values()].reduce((a, c) => ({ media: a.media + c.media, agents: a.agents + c.agents, total: a.total + c.total }), { media: 0, agents: 0, total: 0 });
  return { byId, ...totals, budget: episodes.reduce((n, e) => n + e.input.budgetUsd, 0) };
}
