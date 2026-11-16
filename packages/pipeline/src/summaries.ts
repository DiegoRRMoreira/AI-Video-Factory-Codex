import { createHash } from "node:crypto";
import { LocalizedError, msg } from "@ys/core";
import { type AssetStore } from "@ys/storage";
import { progressOf, runStatusOf, STALL_AFTER_MS, type Progress, type RunStatus } from "./estimate.ts";
import { draftBelow, STAGES, type EpisodeState, type Stage } from "./state.ts";
import { sameSeries, seriesOf } from "./series.ts";

export interface EpisodeSummary {
  version: 1;
  revision: string;
  id: string;
  createdAt: string;
  input: EpisodeState["input"];
  title?: string;
  style?: { pack?: string };
  done: EpisodeState["done"];
  heartbeatAt?: string;
  status: { status: RunStatus; stage?: Stage };
  progress?: Progress;
  progressStartedAt?: string;
  thumbnail?: string;
  render?: { at: string; exportId?: string };
  waitingFor?: EpisodeState["waitingFor"];
  voiceSec: number;
  counts: { shots: number; activity: number; claims: number; draftBelow: number };
}
interface Envelope { version: 1; sourceVersion: string; checksum: string; summary: EpisodeSummary }
interface Pending { version: 1; pending: string }
export interface SummaryNotice { id: string; reason: "unreadable" | "pending" }
export interface SummaryList { episodes: EpisodeSummary[]; notices: SummaryNotice[] }
export interface SummaryQuery { offset?: number; limit?: number; q?: string; series?: string; status?: RunStatus; sort?: "oldest" | "newest" }
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const envelope = (summary: EpisodeSummary, sourceVersion: string): Envelope => ({ version: 1, sourceVersion, checksum: digest(summary), summary });
export const episodeRevision = (state: EpisodeState) => createHash("sha256").update(JSON.stringify(state)).digest("hex");
export const summaryKey = (id: string) => `episodes/${id}/summary.json`;
const sourceKey = (id: string) => `episodes/${id}/state.json`;
const trim = (v: string | undefined, n: number) => v?.slice(0, n);

/** Yalnız kart/izleme verisi; çizimler, senaryo, ham günlük ve kanıtlar burada tutulmaz. */
export function summarizeEpisode(state: EpisodeState): EpisodeSummary {
  const i = state.input, first = state.shots?.[0]?.id, status = runStatusOf(state), progress = progressOf(state);
  return {
    version: 1, revision: episodeRevision(state), id: state.id, createdAt: state.createdAt,
    input: { topic: trim(i.topic, 500)!, lang: trim(i.lang, 20)!, targetSec: i.targetSec, tier: i.tier, aiClipRatio: i.aiClipRatio,
      budgetUsd: i.budgetUsd, width: i.width, height: i.height, fps: i.fps, motionMode: i.motionMode,
      series: trim(i.series, 80), stylePack: trim(i.stylePack, 160), customStyleId: trim(i.customStyleId, 160),
      lineStyle: i.lineStyle, voiceId: trim(i.voiceId, 300) },
    title: trim(state.story?.title, 300), style: state.style ? { pack: trim(state.style.pack, 160) } : undefined,
    done: Object.fromEntries(Object.entries(state.done).filter(([k]) => STAGES.includes(k as Stage))) as EpisodeState["done"],
    heartbeatAt: state.heartbeatAt ?? (status.stage ? state.stats?.[status.stage]?.startedAt : undefined), status, progress,
    progressStartedAt: progress ? state.stats![progress.stage]!.startedAt : undefined, waitingFor: state.waitingFor,
    thumbnail: trim((first && (state.keyframes?.[first] ?? state.stills?.[first])?.key) || Object.values(state.concept?.selected ?? {})[0]?.key, 1000),
    render: state.render ? { at: state.render.at, exportId: state.render.exportId } : undefined,
    voiceSec: Object.values(state.voice ?? {}).reduce((n, v) => n + v.durationMs, 0) / 1000,
    counts: { shots: state.shots?.length ?? 0, activity: state.activity?.length ?? 0, claims: state.render?.research?.claims ?? 0, draftBelow: draftBelow(state).length },
  };
}

export function summaryStatus(summary: EpisodeSummary, now = Date.now()): EpisodeSummary["status"] {
  return summary.status.status === "running" && now - Date.parse(summary.heartbeatAt ?? summary.createdAt) > STALL_AFTER_MS
    ? { ...summary.status, status: "stalled" } : summary.status;
}

/** Sayaç değişmese de geçen süreye bağlı tahmin her hafif sorguda yenilenir. */
export function summaryProgress(summary: EpisodeSummary, now = Date.now()): Progress | undefined {
  const p = summary.progress;
  if (!p || !summary.progressStartedAt) return p;
  const elapsed = (now - Date.parse(summary.progressStartedAt)) / 1000;
  return { ...p, etaSec: p.done > 0 && p.total > p.done ? elapsed / p.done * (p.total - p.done) : undefined };
}

/** Kaynak değişmeden türetilmiş indeks sürümü değişmez. İnsan düzenleme parmak izlerine alan eklemez. */
export async function saveEpisodeSnapshot(store: AssetStore, state: EpisodeState): Promise<void> {
  const bytes = encode(state);
  if (!store.version || !store.compareAndSwap || !store.putVersioned) { await store.put(sourceKey(state.id), bytes, "application/json"); return; }
  const summary = summarizeEpisode(state), pending = encode({ version: 1, pending: summary.revision } satisfies Pending);
  await store.put(summaryKey(state.id), pending, "application/json");
  const sourceVersion = await store.putVersioned(sourceKey(state.id), bytes, "application/json");
  await store.compareAndSwap(summaryKey(state.id), pending, encode(envelope(summary, sourceVersion)), "application/json");
}

/** Eski/bozuk/kesilmiş indeks kaynağı değiştirmeden onarılır; yarışta başka yazarı ezmeyiz. */
export async function readEpisodeSummary(store: AssetStore, id: string, force = false): Promise<{ summary: EpisodeSummary; pending: boolean }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await store.version?.(sourceKey(id));
    if (before === null) throw new LocalizedError(msg("err.episode.notFound", { id }));
    const raw = await store.get(summaryKey(id));
    let head: Partial<Envelope & Pending> | undefined;
    try { head = raw ? JSON.parse(new TextDecoder().decode(raw)) as typeof head : undefined; } catch { /* Kaynaktan yeniden kurulur. */ }
    if (!force && before !== undefined && head?.version === 1 && head.sourceVersion === before && head.summary?.id === id && head.summary.version === 1 && /^[a-f0-9]{64}$/.test(head.summary.revision) && head.checksum === digest(head.summary)) return { summary: head.summary, pending: false };
    const bytes = await store.get(sourceKey(id));
    if (!bytes) throw new LocalizedError(msg("err.episode.notFound", { id }));
    const after = await store.version?.(sourceKey(id));
    if (before !== after) continue;
    const state = JSON.parse(new TextDecoder().decode(bytes)) as EpisodeState;
    if (state.id !== id) throw new LocalizedError(msg("err.summary.identity", { id }));
    const summary = summarizeEpisode(state);
    if (!force && head?.pending && head.pending !== summary.revision) return { summary, pending: true };
    if (after === undefined || !store.compareAndSwap) return { summary, pending: false };
    if (await store.compareAndSwap(summaryKey(id), raw, encode(envelope(summary, after!)), "application/json")) return { summary, pending: false };
  }
  throw new LocalizedError(msg("err.summary.changed", { id }));
}

export function querySummaries(list: SummaryList, query: SummaryQuery = {}) {
  const term = (query.q ?? "").trim().toLocaleLowerCase("tr");
  const episodes = list.episodes.filter((e) => (!term || `${e.title ?? ""} ${e.input.topic}`.toLocaleLowerCase("tr").includes(term))
    && (query.series === undefined || (query.series === "-" ? !seriesOf(e) : sameSeries(seriesOf(e), query.series)))
    && (!query.status || summaryStatus(e).status === query.status))
    .sort((a, b) => (query.sort === "oldest" ? 1 : -1) * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0)), limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 20)));
  return { episodes: episodes.slice(offset, offset + limit), total: episodes.length, offset, limit, notices: list.notices };
}
