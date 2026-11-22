"use client";

import type { YoutubeCandidate, YoutubeState } from "@ys/pipeline/light";
import { Check, ExternalLink, Scissors, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { MessageKey } from "../../../lib/i18n";
import type { EpisodeResponse } from "../../../lib/types";
import { useI18n } from "../../locale-provider";
import { asset, type Act } from "./parts";

/** Videodaki yer: d:ss ya da s:dd:ss. */
export const clock = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

/** YouTube'da o saniyeden açan adres (kanonik adres her zaman ?v= taşır). */
export const atTime = (url: string, ms: number) => `${url}&t=${Math.floor(ms / 1000)}s`;

/** Anın küçük resmi: aralığa düşen ilk kare, yoksa öncesindeki son kare. */
export function frameAt(frames: YoutubeState["frames"], fromMs: number): string | undefined {
  const list = frames ?? [];
  return (list.find((f) => f.atMs >= fromMs) ?? list.at(-1))?.key;
}

function TimeLink({ url, fromMs, toMs }: { url: string; fromMs: number; toMs: number }) {
  return (
    <a href={atTime(url, fromMs)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline">
      {clock(fromMs)}–{clock(toMs)} <ExternalLink size={11} />
    </a>
  );
}

/**
 * YouTube analizinin raporu (22 Kas): ilerleme, puanlı Short adayları (seçilenlerden Short bölümleri üretilir), sahne
 * günlüğü ve kesilecek yerler. Zamanlar YouTube'da o saniyeyi açar.
 */
export function YoutubeTab({ data, busy, act }: { data: EpisodeResponse; busy: boolean; act: Act }) {
  const { t } = useI18n();
  const state = data.state;
  const input = state.input.youtube!;
  const yt: YoutubeState = state.youtube ?? {};
  const report = yt.report;
  const [picked, setPicked] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [music, setMusic] = useState(true);
  const made = new Map((yt.shorts ?? []).map((s) => [s.candidate, s.episodeId]));
  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const steps: [MessageKey, string | undefined][] = [
    ["youtube.step.meta", yt.meta ? clock(yt.meta.durationMs) : undefined],
    ["youtube.step.video", yt.video ? `${yt.video.width}×${yt.video.height}` : undefined],
    ["youtube.step.transcript", yt.transcript ? t(`youtube.transcript.${yt.transcript.source}` as MessageKey, { n: yt.transcript.words }) : undefined],
    ["youtube.step.scenes", yt.scenes && yt.frames ? t("youtube.scenesFrames", { scenes: yt.scenes.length, frames: yt.frames.length }) : undefined],
    ["youtube.step.windows", yt.windows?.length ? t("youtube.windowsDone", { n: yt.windows.length }) : undefined],
  ];

  return (
    <div className="grid gap-5">
      <section className="grid gap-1">
        <h2 className="text-lg font-semibold">{yt.meta?.title ?? input.url}</h2>
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
          {yt.meta?.channel && <span>{yt.meta.channel}</span>}
          {yt.meta && <span>{clock(yt.meta.durationMs)}</span>}
          <a href={input.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            YouTube <ExternalLink size={12} />
          </a>
          <span>{t("youtube.limits", { count: input.count, min: input.minSec, max: input.maxSec })}</span>
        </p>
      </section>

      {!report && (
        <ol className="grid gap-1.5 text-sm" data-testid="youtube-steps">
          {steps.map(([key, done]) => (
            <li key={key} className={`flex items-center gap-2 ${done ? "" : "text-muted"}`}>
              {done ? <Check size={14} className="text-ok" /> : <span className="inline-block h-3.5 w-3.5 rounded-full border border-line" />}
              {t(key)}
              {done && <span className="text-xs text-muted">· {done}</span>}
            </li>
          ))}
        </ol>
      )}

      {report && (
        <>
          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <Sparkles size={16} /> {t("youtube.candidates", { n: report.candidates.length })}
              </h3>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> {t("youtube.review")}
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} /> {t("form.music")}
                </label>
                <button
                  className="btn-primary py-1 text-sm"
                  disabled={busy || !picked.length}
                  onClick={async () => {
                    if (await act({ type: "make-shorts", candidates: picked, review, music })) setPicked([]);
                  }}
                >
                  {t("youtube.make", { n: picked.length })}
                </button>
              </div>
            </div>
            {report.candidates.length === 0 && <p className="text-sm text-muted">{t("youtube.noCandidates")}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {report.candidates.map((c) => (
                <CandidateCard key={c.id} c={c} url={input.url} frame={frameAt(yt.frames, c.segments[0]!.fromMs)} episodeId={made.get(c.id)} picked={picked.includes(c.id)} onToggle={() => toggle(c.id)} />
              ))}
            </div>
          </section>

          <details className="card" open={report.candidates.length === 0}>
            <summary className="cursor-pointer font-semibold">{t("youtube.scenes", { n: report.scenes.length })}</summary>
            <ul className="mt-3 grid gap-2">
              {report.scenes.map((s, i) => (
                <li key={i} className="flex gap-3 border-b border-line/50 pb-2 text-sm last:border-0">
                  {s.frameKey ? <img src={asset(s.frameKey)} alt="" className="h-[54px] w-24 shrink-0 rounded object-cover" /> : <span className="h-[54px] w-24 shrink-0 rounded bg-panel-2" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <TimeLink url={input.url} fromMs={s.fromSec * 1000} toMs={s.toSec * 1000} />
                      <span className="text-xs text-muted" title={t("youtube.energy")}>
                        {"●".repeat(s.energy)}
                        {"○".repeat(5 - s.energy)}
                      </span>
                      {s.quality !== "good" && <span className="rounded bg-bad/15 px-1.5 text-xs text-bad">{t(`youtube.quality.${s.quality}` as MessageKey)}</span>}
                    </div>
                    <p>{s.summary}</p>
                    {s.people && <p className="text-xs text-muted">{s.people}</p>}
                    {s.onScreenText && <p className="text-xs text-muted">“{s.onScreenText}”</p>}
                  </div>
                </li>
              ))}
            </ul>
          </details>

          <details className="card">
            <summary className="cursor-pointer font-semibold">
              <Scissors size={14} className="mr-1 inline" /> {t("youtube.cuts", { n: report.cuts.length })}
            </summary>
            <ul className="mt-3 grid gap-1.5 text-sm">
              {report.cuts.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <TimeLink url={input.url} fromMs={c.fromSec * 1000} toMs={c.toSec * 1000} />
                  <span className="rounded bg-panel-2 px-1.5 text-xs">{t(`youtube.cut.${c.reason}` as MessageKey)}</span>
                  <span className="text-muted">{c.note}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function CandidateCard({ c, url, frame, episodeId, picked, onToggle }: { c: YoutubeCandidate; url: string; frame?: string; episodeId?: string; picked: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <article className={`card grid gap-2 ${picked ? "border-accent" : ""}`} data-testid={`candidate-${c.id}`}>
      <div className="flex gap-3">
        {frame ? <img src={asset(frame)} alt="" className="h-[72px] w-32 shrink-0 rounded object-cover" /> : <span className="h-[72px] w-32 shrink-0 rounded bg-panel-2" />}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-accent/15 px-1.5 text-xs font-semibold text-accent">{c.score}/10</span>
            <h4 className="truncate font-medium">{c.title}</h4>
          </div>
          {c.hook && <p className="text-sm">“{c.hook}”</p>}
          <p className="text-xs text-muted">{t("youtube.length", { sec: Math.round(c.durationMs / 1000), parts: c.segments.length })}</p>
        </div>
      </div>
      <p className="text-sm text-muted">{c.why}</p>
      <div className="flex flex-wrap gap-2">
        {c.segments.map((s, i) => (
          <TimeLink key={i} url={url} fromMs={s.fromMs} toMs={s.toMs} />
        ))}
      </div>
      {episodeId ? (
        <Link href={`/episodes/${episodeId}`} className="text-sm text-accent hover:underline">
          {t("youtube.open")}
        </Link>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={picked} onChange={onToggle} /> {t("youtube.pick")}
        </label>
      )}
    </article>
  );
}
