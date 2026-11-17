"use client";
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { QualityIssue } from "@ys/pipeline/light";
import type { EpisodeResponse } from "../../../lib/types";
import { issueShot, qualityVersion } from "../../../lib/review";
import { useI18n } from "../../locale-provider";
import { QualityIssueBoard } from "./quality-issue-board";
import { modeOf } from "./parts";
import type { TimelinePlayerProps } from "./timeline-player";

export interface IssueRequest { issue: QualityIssue; seq: number; episodeId: string }
export function ReviewWorkspace({ data, active, busy, PlayerComponent, children, onShot, onCorrect, onScene, external, playRequest }: {
  data: EpisodeResponse; active: boolean; busy: boolean; PlayerComponent: ComponentType<TimelinePlayerProps>; children: ReactNode;
  onShot: (id: string) => void; onCorrect: (id: string, detail: string) => void; onScene?: (id: string) => void;
  external?: IssueRequest; playRequest?: { shot?: string; seek: number };
}) {
  const { t } = useI18n(), s = data.state;
  const [mode, setMode] = useState<"plan" | "main" | "short">("plan"), [preview, setPreview] = useState(false);
  const [issue, setIssue] = useState<QualityIssue>();
  const [request, setRequest] = useState<{ shot?: string; seconds?: number; exportId?: string; target: "plan" | "main" | "short"; seq: number }>();
  const [videoError, setVideoError] = useState<string>();
  const sequence = useRef(0), video = useRef<HTMLVideoElement>(null), inspector = useRef<HTMLDivElement>(null);
  const frame = useRef(0), times = useRef(new Map<string, number>()), timelineVersion = useRef(s.done.timeline);
  const output = mode === "main" ? s.render : mode === "short" ? s.short : undefined;
  const outputVersion = mode === "plan" ? undefined : data.outputVersions?.[mode] ?? output?.exportId;
  const identity = `${mode}:${outputVersion ?? output?.at ?? ""}`;
  const blocked = mode !== "plan" && request?.target === mode && (!request.exportId || request.exportId !== outputVersion);
  const selectedShot = issue ? issueShot(issue, data) : undefined;
  const inspect = (next: QualityIssue) => {
    setIssue(next); setMode(next.target); setPreview(true);
    const shot = issueShot(next, data); if (shot) onShot(shot.id);
    setRequest({ target: next.target, shot: shot?.id, seconds: next.seconds, exportId: next.exportId, seq: ++sequence.current });
    inspector.current?.focus();
  };
  useEffect(() => { if (external?.episodeId === s.id) inspect(external.issue); }, [external]);
  useEffect(() => {
    if (!playRequest) return;
    setMode("plan"); setPreview(true); setIssue(undefined);
    setRequest({ target: "plan", shot: playRequest.shot, seq: ++sequence.current });
  }, [playRequest]);
  useEffect(() => {
    if (timelineVersion.current !== s.done.timeline) { frame.current = 0; timelineVersion.current = s.done.timeline; setRequest(previous => previous?.target === "plan" ? undefined : previous); }
  }, [s.done.timeline]);
  useEffect(() => { if (!active) video.current?.pause(); }, [active]);
  useEffect(() => { const current = video.current; return () => { if (current) { times.current.set(identity, current.currentTime); current.pause(); } }; }, [identity, blocked]);
  const saveFrame = useCallback((next: number) => { frame.current = next; }, []);
  const seekVideo = () => {
    const current = video.current;
    if (!current || blocked || current.dataset.identity !== identity) return;
    const seconds = request?.target === mode ? request.seconds : times.current.get(identity);
    if (request?.target === mode) current.pause();
    if (seconds !== undefined && Number.isFinite(seconds)) current.currentTime = Math.max(0, Math.min(Number.isFinite(current.duration) ? current.duration : seconds, seconds));
  };
  useEffect(seekVideo, [request]);
  return <section className="grid min-w-0 gap-4" aria-label={t("workspace.title")}>
    <h2 className="font-semibold">{t("workspace.title")}</h2>
    <label className="grid max-w-sm gap-1 text-sm">{t("workspace.player")}<select className="field" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setRequest(undefined); setIssue(undefined); }}>
      <option value="plan">{t("workspace.preview")}</option><option value="main" disabled={!s.render}>{t("quality.target.main")}</option><option value="short" disabled={!s.short}>{t("quality.target.short")}</option>
    </select></label>
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="grid min-w-0 content-start gap-2">
        {mode === "plan" ? <>{s.done.timeline ? <><button className="btn-ghost w-fit" type="button" onClick={() => { if (preview) setRequest(undefined); setPreview(!preview); }}>{t(preview ? "shots.play.close" : "shots.play")}</button>{preview && <PlayerComponent id={s.id} version={s.done.timeline} active={active} shot={request?.shot} seconds={request?.seconds} seek={request?.seq} initialFrame={frame.current} onFrame={saveFrame} play={false} />}</> : <p className="text-sm text-muted">{t("workspace.noPreview")}</p>}<p className="text-xs text-muted">{t("workspace.previewHint")}</p></>
          : blocked ? <p role="alert" className="text-sm text-accent">{t("workspace.stale")}</p>
          : output && s.render ? <><video key={identity} ref={video} data-identity={identity} controls preload="metadata" aria-label={t(mode === "short" ? "quality.target.short" : "quality.target.main")} className="max-h-[65vh] w-full rounded-lg bg-black" src={`/api/episodes/${s.id}/video?v=${encodeURIComponent(s.render.at)}&export=${encodeURIComponent(outputVersion ?? "")}${mode === "short" ? `&short&vshort=${encodeURIComponent(output.at)}` : ""}`} onLoadedMetadata={seekVideo} onTimeUpdate={e => { times.current.set(identity, e.currentTarget.currentTime); }} onError={() => setVideoError(identity)} /><p className="break-all text-xs text-muted">{t("quality.version")}: {outputVersion ?? output.at}</p>{videoError === identity && <p role="alert">{t("workspace.videoError")}</p>}</> : <p role="alert">{t("workspace.noOutput")}</p>}
        {issue && <div className="grid gap-2 rounded-lg border border-line p-3 text-sm"><p>{t(`quality.source.${issue.source}`)} · {t(`quality.target.${issue.target}`)} · {issue.kind}</p><p className="break-words">{issue.detail}</p>{issue.exportId && <p className="break-all text-xs text-muted">{t("quality.version")}: {issue.exportId}</p>}{!selectedShot && <p>{t("workspace.noShot")}</p>}{selectedShot && <button type="button" className="btn-ghost w-fit" disabled={busy || blocked || modeOf(s.input) !== "vector" && !s.keyframes?.[selectedShot.id]} onClick={() => onCorrect(selectedShot.id, issue.detail)}>{t("workspace.correct")}</button>}</div>}
      </div>
      <div ref={inspector} tabIndex={-1} className="min-w-0">{children ?? <p className="text-sm text-muted">{t("workspace.pickShot")}</p>}</div>
    </div>
    <QualityIssueBoard id={s.id} busy={busy || !active} version={qualityVersion(data)} selectedKey={issue?.key} onInspect={inspect} onScene={onScene} onDecision={(changed, status) => setIssue(previous => previous?.key === changed.key ? { ...previous, status } : previous)} />
  </section>;
}
