"use client";

import { statusLabel } from "../../../lib/status";
import { formatText } from "@ys/core/messages";
import type { QualityIssue, Stage } from "@ys/pipeline/light";
import type { IssueRequest } from "./review-workspace";
import { ArrowLeft, Mic, Pencil, Play, RefreshCw, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorKey } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n";
import type { EpisodeResponse, EpisodeStatusResponse } from "../../../lib/types";
import { useI18n } from "../../locale-provider";
import { ActivityLine, ActivityTab } from "./activity";
import { CostsTab } from "./costs-panel";
import { OverviewTab } from "./overview";
import { Badge, Bar, gateTab, modeOf, nextWork, STAGE_GROUPS, STATUS_TONE, StatusIcon, stageKey, TABS, type Act, type Tab } from "./parts";
import { ConceptTab, ScriptTab, ShotsTab } from "./steps";

export function EpisodeView({ id }: { id: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<EpisodeResponse>();
  const [shotsData, setShotsData] = useState<EpisodeResponse>();
  const [issueRequest, setIssueRequest] = useState<IssueRequest>();
  const [focusScene, setFocusScene] = useState<{ id: string; seq: number; episodeId: string }>();
  const [error, setError] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [tab, setTabState] = useState<Tab>();
  const [logStage, setLogStage] = useState<Stage>();
  const [, tick] = useState(0);
  const requestId = useRef(0);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const loadedResponse = useRef<EpisodeResponse | undefined>(undefined);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const headers = { "x-ys-status": "1", "x-ys-panel": tab ?? "auto" };
      const res = await fetch(`/api/episodes/${id}`, { cache: "no-store", signal: controller.signal, headers });
      if (!res.ok) throw new Error("Episode request failed");
      const response = (await res.json()) as EpisodeResponse | EpisodeStatusResponse;
      if (request !== requestId.current) return;
      let next: EpisodeResponse;
      if ("state" in response) next = response;
      else {
        if (typeof response.revision !== "string" || !response.status) throw new Error("Invalid episode status response");
        const cached = loadedResponse.current;
        if (cached && response.revision === cached.revision) {
          setData({ ...cached, status: response.status, progress: response.progress });
          setLoadFailed(false);
          return;
        }
        const detail = await fetch(`/api/episodes/${id}`, { cache: "no-store", signal: controller.signal, headers: { "x-ys-panel": tab ?? "auto" } });
        if (!detail.ok) throw new Error("Episode panel request failed");
        next = await detail.json() as EpisodeResponse;
        if (!next.state) throw new Error("Invalid episode panel response");
      }
      if (request === requestId.current) {
        setData(next);
        if (!next.panel || next.panel === "shots") setShotsData(next);
        loadedResponse.current = next;
        setLoadFailed(false);
      }
    } catch {
      // Eski veya kaldırılmış isteğin hatası güncel ekranı bozamaz; sunucunun ham hatasını göstermeyiz.
      if (request === requestId.current) setLoadFailed(true);
    } finally {
      clearTimeout(timeout);
      if (inFlight.current === controller) inFlight.current = undefined;
      if (request === requestId.current) setRefreshing(false);
    }
  }, [id, tab]);

  // Önceki bölümün ya da kaldırılan bileşenin yanıtı sonradan durumu değiştiremez.
  useEffect(() => () => { requestId.current++; loadedResponse.current = undefined; inFlight.current?.abort(); }, [id]);

  const live = data?.status.status === "running";
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(() => void poll(), live ? 1500 : 5000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh, live, retry]);
  // "x sn önce" ve geçen süre her saniye güncellensin.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sekme adres çubuğunda (#shots) tutulur: yenilemede ve paylaşılan bağlantıda aynı yer açılır.
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.includes(h)) setTabState(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    history.replaceState(null, "", `#${next}`);
  };

  const act: Act = useCallback(
    async (action) => {
      setPending(true);
      setError(undefined);
      // Ağ hatası ya da HTML hata sayfası düğmeleri sonsuza dek kilitlemesin; başarı çağırana döner (not kutusu
      // yalnız istek kabul edilince kapanır).
      try {
        const res = await fetch(`/api/episodes/${id}/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action),
        });
        if (!res.ok) {
          const message = ((await res.json().catch(() => ({}))) as { error?: string }).error;
          const known = message ? errorKey(message) : undefined;
          setError(known ? t(known.key, known.vars) : (message ?? t("common.actionFailed")));
        }
        return res.ok;
      } catch {
        setError(t("common.actionFailed"));
        return false;
      } finally {
        await refresh();
        setPending(false);
      }
    },
    [id, refresh, t],
  );

  const connection = loadFailed ? (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
      <p>{t(data ? "episode.stale" : "episode.loadFailed")}</p>
      <button type="button" className="btn-ghost" disabled={refreshing} onClick={() => setRetry((n) => n + 1)}>
        {t(refreshing ? "common.retrying" : "common.retry")}
      </button>
    </div>
  ) : null;
  if (!data) return connection ?? <p className="text-muted">{t("common.loading")}</p>;
  const { state, status } = data;
  const busy = pending || status.status === "running" || data.job?.status === "running";
  // Sekme seçilmediyse bölümün durumuna göre en anlamlı olanı aç.
  const active: Tab =
    tab ??
    (status.status === "waiting"
      ? gateTab(status.stage)
      : status.status === "running"
        ? "activity"
        : "overview");
  const panelReady = !data.panel || data.panel === active;
  const inspectIssue = (issue: QualityIssue) => { setIssueRequest(previous => ({ issue, episodeId: id, seq: (previous?.seq ?? 0) + 1 })); setTab("shots"); };
  const openScene = (sceneId: string) => { setFocusScene(previous => ({ id: sceneId, seq: (previous?.seq ?? 0) + 1, episodeId: id })); setTab("script"); };
  const openStage = (s: Stage) => {
    setLogStage(s);
    setTab("activity");
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      {connection}
      <Header data={data} act={act} />
      <LivePanel data={data} busy={busy} act={act} onTab={setTab} />
      <PipelineRail data={data} onStage={openStage} />
      {error && <div className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}

      <section className="card min-w-0 p-0">
        <nav className="flex gap-1 overflow-x-auto border-b border-line px-3" role="tablist">
          {TABS.map((k) => (
            <button
              key={k}
              role="tab"
              id={`episode-tab-${id}-${k}`}
              aria-controls={`episode-panel-${id}`}
              tabIndex={active === k ? 0 : -1}
              aria-selected={active === k}
              onClick={() => setTab(k)}
              onKeyDown={e => {
                const next = e.key === "ArrowRight" ? (TABS.indexOf(k) + 1) % TABS.length : e.key === "ArrowLeft" ? (TABS.indexOf(k) + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : undefined;
                if (next === undefined) return;
                e.preventDefault(); setTab(TABS[next]!); e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]!.focus();
              }}
              className={`relative shrink-0 cursor-pointer px-3 py-3 text-sm transition ${active === k ? "text-white" : "text-muted hover:text-white"}`}
            >
              {t(`tab.${k}` as MessageKey)}
              {k === "shots" && (data.counts?.shots ?? state.shots?.length) !== undefined && <span className="ml-1.5 text-xs text-muted">{data.counts?.shots ?? state.shots!.length}</span>}
              {k === "activity" && (data.counts?.activity ?? state.activity?.length ?? 0) > 0 && (
                <span className="ml-1.5 text-xs text-muted">{data.counts?.activity ?? state.activity!.length}</span>
              )}
              {active === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
        <div id={`episode-panel-${id}`} role="tabpanel" aria-labelledby={`episode-tab-${id}-${active}`} className="min-w-0 p-5">
          {!panelReady ? <p className="text-muted">{t("common.loading")}</p> : <>
          {active === "overview" && <OverviewTab data={data} busy={busy} act={act} onInspectIssue={inspectIssue} onScene={openScene} />}
          {active === "script" && <ScriptTab data={data} busy={busy} act={act} focusScene={focusScene?.episodeId === id ? focusScene : undefined} />}
          {active === "concept" && <ConceptTab data={data} busy={busy} act={act} />}
          {active === "costs" && <CostsTab data={data} />}
          {active === "activity" && <ActivityTab activity={state.activity ?? []} job={data.job} stage={logStage} onStage={setLogStage} />}
          </>}
          {shotsData?.state.id === id && <div hidden={active !== "shots" || !panelReady}><ShotsTab key={id} workspace active={active === "shots" && panelReady} data={{ ...shotsData, status: data.status, job: data.job }} busy={busy || active !== "shots" || !panelReady} act={act} issueRequest={issueRequest} onScene={openScene} /></div>}
        </div>
      </section>
    </div>
  );
}

// ---------------- üst bilgi ----------------

/** Seri etiketi: tıklayınca o serinin bölümleri; kalemle seri adı değiştirilir. */
function SeriesTag({ series, act }: { series?: string; act: Act }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(series ?? "");
  if (editing) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          await act({ type: "set-series", series: value });
          setEditing(false);
        }}
      >
        <input autoFocus className="field w-56 py-0.5 text-xs" value={value} maxLength={80} placeholder={t("series.placeholder")} onChange={(e) => setValue(e.target.value)} />
        <button className="btn-primary py-0.5 text-xs">{t("series.save")}</button>
        <button type="button" className="btn-ghost py-0.5 text-xs" onClick={() => setEditing(false)}>
          {t("gate.cancel")}
        </button>
      </form>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {series ? (
        <Link href={`/?series=${encodeURIComponent(series)}`} className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent hover:bg-accent/25">
          {t("series.label", { name: series })}
        </Link>
      ) : (
        <span className="text-muted">{t("series.none")}</span>
      )}
      <button type="button" className="text-muted hover:text-white" title={t("series.edit")} onClick={() => setEditing(true)}>
        <Pencil size={12} />
      </button>
    </span>
  );
}

function Header({ data, act }: { data: EpisodeResponse; act: Act }) {
  const { t, fmt } = useI18n();
  const { state, spentUsd, claudeUsd, status } = data;
  const mode = modeOf(state.input);
  const pct = Math.min(100, (spentUsd / state.input.budgetUsd) * 100);
  return (
    <div className="grid gap-3">
      <Link href="/" className="inline-flex w-fit items-center gap-1 text-xs text-muted hover:text-white">
        <ArrowLeft size={14} /> {t("nav.episodes")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SeriesTag series={state.input.series} act={act} />
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{state.story?.title ?? state.input.topic}</h1>
            <Badge status={status.status}>{statusLabel(t, status)}</Badge>
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-2 text-sm text-muted">
            <span>{state.input.lang.toUpperCase()}</span>·<span>{fmt.duration(state.input.targetSec)}</span>·
            <span>{t(`motion.${mode}` as MessageKey)}</span>·<span>{t(`form.tier.${state.input.tier}` as MessageKey)}</span>
          </p>
        </div>
        <div className="w-full text-sm sm:w-60 sm:text-right">
          <div className="text-xs text-muted">{t("ep.spentCap")}</div>
          <div className="font-semibold tabular-nums">
            {fmt.usd(spentUsd)} <span className="font-normal text-muted">/ {fmt.usd(state.input.budgetUsd)}</span>
          </div>
          <div className="text-[11px] text-muted" title={t("ep.claudeHint")}>
            {t("ep.claude", { usd: fmt.usd(claudeUsd) })}
          </div>
          <div className="text-xs font-medium">{t("next.total", { usd: fmt.usd(spentUsd + claudeUsd) })}</div>
          <Bar value={pct} tone={pct > 90 ? "bg-bad" : "bg-accent"} className="mt-1.5" />
        </div>
      </div>
    </div>
  );
}

// ---------------- aşama şeridi ----------------

function PipelineRail({ data, onStage }: { data: EpisodeResponse; onStage: (s: Stage) => void }) {
  const { t, fmt } = useI18n();
  const { state, status, progress } = data;
  const est = data.estimates[modeOf(state.input)];
  const actual = new Map(data.actual.byStage.map((g) => [g.key, g.micros / 1_000_000]));
  const estOf = (s: Stage) => est.rows.filter((r) => r.stage === s).reduce((n, r) => n + r.seconds, 0);

  const stageStatus = (s: Stage) => {
    if (state.done[s]) return "done" as const;
    if (status.stage === s && status.status !== "idle") return status.status;
    return "pending" as const;
  };

  return (
    <details className="card min-w-0 p-3">
      <summary className="cursor-pointer text-sm font-medium">{t("next.details")} · {Object.keys(state.done).length}/14</summary>
      <div className="mt-3 grid gap-3">
        {STAGE_GROUPS.map((g) => (
          <div key={g.key} className="min-w-0" style={{ flex: g.stages.length }}>
            <div className="mb-1.5 px-1 text-[10px] font-semibold tracking-wider text-muted/80 uppercase">
              {t(`group.${g.key}` as MessageKey)}
            </div>
            <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
              {g.stages.map((s) => {
                const st = stageStatus(s);
                const tone = STATUS_TONE[st];
                const stat = state.stats?.[s];
                const cost = actual.get(s);
                const p = progress && progress.stage === s && progress.total > 0 ? progress : undefined;
                const runningFor = st === "running" && stat ? (Date.now() - Date.parse(stat.startedAt)) / 1000 : undefined;
                return (
                  <li key={s} className="min-w-0 flex-1">
                    <button
                      onClick={() => onStage(s)}
                      title={t("pipe.open")}
                      className={`relative h-full w-full cursor-pointer overflow-hidden rounded-lg border px-2 py-1.5 text-left transition hover:brightness-125 ${tone.border} ${st === "pending" ? "bg-transparent" : tone.bg}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={st} size={12} />
                        <span
                          title={t(stageKey(s))}
                          className={`truncate text-xs font-medium ${st === "pending" ? "text-muted" : "text-white"}`}
                        >
                          {t(stageKey(s))}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-muted tabular-nums">
                        {runningFor !== undefined
                          ? fmt.duration(runningFor)
                          : stat?.durationMs !== undefined
                            ? fmt.duration(stat.durationMs / 1000)
                            : t("pipe.est", { v: fmt.duration(estOf(s)) })}
                      </div>
                      <div className="truncate text-[10px] text-muted tabular-nums">{cost ? fmt.usd(cost) : " "}</div>
                      {p && (
                        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-run/20">
                          <span
                            className="block h-full bg-run transition-[width] duration-700"
                            style={{ width: `${(p.done / p.total) * 100}%` }}
                          />
                        </span>
                      )}
                      {st === "running" && !p && <span className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-run/60" />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------------- canlı durum ----------------

function LivePanel({ data, busy, act, onTab }: { data: EpisodeResponse; busy: boolean; act: Act; onTab: (t: Tab) => void }) {
  const { t, fmt, locale } = useI18n();
  const { state, status, progress, job } = data;
  const recent = (state.activity ?? []).slice(-6).reverse();
  const tone = STATUS_TONE[status.status];
  const stageName = status.stage ? t(stageKey(status.stage)) : "";
  const stat = status.stage ? state.stats?.[status.stage] : undefined;
  const studioJob = job?.status === "running";

  if (status.status === "done") return <section className="card grid gap-2" aria-label={t("next.title")}><h2 className="font-semibold">{t("next.title")}</h2><p className="text-sm text-muted">{t("next.exportHint")}</p><button type="button" className="btn-primary w-fit" onClick={() => onTab("overview")}>{t("next.export")}</button></section>;

  let headline: string;
  let body: React.ReactNode = null;
  let actions: React.ReactNode = null;
  switch (status.status) {
    case "running": {
      headline = t("live.now", { stage: stageName });
      const p = progress && progress.total > 0 ? progress : undefined;
      body = (
        <div className="grid gap-1.5">
          {status.stage && <p className="text-sm leading-snug text-muted">{t(`hint.${status.stage}` as MessageKey)}</p>}
          {p && (
            <>
              <div className="flex justify-between text-xs text-muted tabular-nums">
                <span>
                  {p.done}/{p.total}
                  {p.stage === "render" ? "%" : ""}
                </span>
                {p.etaSec !== undefined && <span>{t("live.left", { time: fmt.duration(p.etaSec) })}</span>}
              </div>
              <Bar value={(p.done / p.total) * 100} tone="bg-run" />
            </>
          )}
          <div className="flex flex-wrap gap-x-3 text-xs text-muted">
            {stat && (
              <span>
                {t("live.elapsed", {
                  time: fmt.duration((Date.now() - Date.parse(stat.startedAt)) / 1000),
                })}
              </span>
            )}
            {state.heartbeatAt && <span>{t("live.heartbeat", { ago: fmt.ago(state.heartbeatAt) })}</span>}
            {!studioJob && <span>{t("live.external")}</span>}
          </div>
        </div>
      );
      actions = studioJob && (
        <button className="btn-ghost py-1.5 text-xs" onClick={() => act({ type: "cancel" })}>
          <Square size={14} /> {t("ep.job.stop")}
        </button>
      );
      break;
    }
    case "stalled":
      headline = t("status.stalled");
      body = (
        <p className="text-sm text-muted">
          {t("live.stalled", {
            stage: stageName,
            ago: fmt.ago(state.heartbeatAt ?? stat?.startedAt ?? state.createdAt),
          })}
        </p>
      );
      actions = (
        <button className="btn-primary py-1.5 text-xs" disabled={busy && studioJob} onClick={() => act({ type: "resume" })}>
          <RefreshCw size={14} /> {t("ep.err.resume")}
        </button>
      );
      break;
    case "error": {
      // Çöken Stüdyo işi hata kaydı yazamamış olabilir: o zaman sürecin son satırı (çıkış kodu) gösterilir.
      const err = state.lastError;
      // Ses sağlayıcısını değiştirmek yalnız ses aşamasındaki kota hatasında anlamlı: başka aşamada tüm sesi ve sonrasını siler.
      const quota = err?.stage === "voice" && /kota|quota/i.test(err.message);
      headline = t("ep.err.stopped", { stage: stageName });
      body = <p className="text-sm break-words text-muted">{err ? (err.text ? formatText(locale, err.text) : err.message) : (job?.log.at(-1) ?? t("ep.err.crashed"))}</p>;
      actions = (
        <>
          {quota && (
            <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={() => act({ type: "change-voice", voiceId: "" })}>
              <Mic size={14} /> {t("ep.err.toGemini")}
            </button>
          )}
          <button className="btn-ghost py-1.5 text-xs" disabled={busy} onClick={() => act({ type: "resume" })}>
            <RefreshCw size={14} /> {t("ep.err.resume")}
          </button>
        </>
      );
      break;
    }
    case "waiting":
      headline = t("status.waiting");
      body = <p className="text-sm text-muted">{t(`live.waiting.${gateTab(status.stage)}` as MessageKey)}</p>;
      actions = (
        <button className="btn-primary py-1.5 text-xs" onClick={() => onTab(gateTab(status.stage))}>
          {t("live.goApprove")}
        </button>
      );
      break;
    default:
      headline = t("live.idle", { stage: stageName });
      actions = state.script ? (
        <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={() => act({ type: "resume" })}>
          <Play size={14} /> {t("live.continue")}
        </button>
      ) : <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={() => onTab("script")}><Play size={14} /> {t("next.openScript")}</button>;
  }

  return (
    <section className={`card grid gap-4 ${tone.border} md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`}>
      <div className="grid content-start gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={status.status} size={18} />
          <h2 className={`font-semibold ${tone.text}`}>{headline}</h2>
        </div>
        {body}
        {actions && <><p className="text-xs font-medium text-muted">{t("next.title")}</p><div className="mt-1 flex flex-wrap gap-2">{actions}</div>{status.status !== "running" && <WorkPreview data={data} />}</>}
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">{t("live.recent")}</span>
          <button className="text-xs text-muted hover:text-white" onClick={() => onTab("activity")}>
            {t("live.allLog")} →
          </button>
        </div>
        {recent.length ? (
          <ul className="divide-y divide-line/40">
            {recent.map((e, i) => (
              <ActivityLine key={`${e.at}-${i}`} entry={e} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">{t("act.empty")}</p>
        )}
      </div>
    </section>
  );
}

function WorkPreview({ data }: { data: EpisodeResponse }) {
  const { t, fmt } = useI18n(), work = nextWork(data);
  return <div className="grid gap-1 text-xs text-muted" aria-label={t("next.work", { stages: work.stages.map(s => t(stageKey(s))).join(", ") })}>
    {data.status.status === "waiting" && <p>{t("next.reviewOnly")}</p>}
    {data.status.status === "idle" && !data.state.script && <p>{t("next.scriptHint")}</p>}
    {work.stages.length ? <><p>{t("next.work", { stages: work.stages.map(s => t(stageKey(s))).join(", ") })}</p><p>{t("next.estimate", { usd: fmt.usd(work.usd), time: fmt.duration(work.seconds) })}</p><p>{t(work.local ? "next.local" : "next.paid")}</p></> : <p>{t("next.gate")}</p>}
  </div>;
}
