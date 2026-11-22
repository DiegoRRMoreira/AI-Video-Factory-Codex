"use client";

import type { EpisodeState } from "@ys/pipeline/light";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Film, Image as ImageIcon, Mic, RotateCcw, Save, Trash2, Type } from "lucide-react";
import { useEffect, useState } from "react";
import type { MessageKey } from "../../../lib/i18n";
import { useI18n } from "../../locale-provider";
import { NarrationEditor } from "./narration-editor";
import { asset, type Act } from "./parts";

type Plan = NonNullable<EpisodeState["footagePlan"]>;
type Beat = Plan["beats"][number];
type Segment = Beat["segments"][number];
type Scan = NonNullable<EpisodeState["footageScan"]>;

const MOODS = ["neutral", "day", "warm", "cool", "night", "dramatic"] as const;
const FITS = ["cover", "contain"] as const;
const AUDIOS = ["original", "ambient", "mute"] as const;
const STYLES = ["hook", "title", "label", "cta"] as const;
const POSITIONS = ["top", "center", "bottom"] as const;
/** Elle düzenlemede kaydedilmemiş kurgu: ScriptTab onay düğmesini bu anahtarla kilitler. */
export const PLAN_DIRTY = "__plan";

/** Parçanın ortasına en yakın taranmış kare (kurgu ajanının gördüğü karelerden). */
export function frameFor(scan: Scan | undefined, source: string, fromMs: number, toMs: number): string | undefined {
  const mid = (fromMs + toMs) / 2;
  const frames = scan?.[source]?.frames ?? [];
  let best = frames[0];
  for (const f of frames) if (Math.abs(f.atMs - mid) < Math.abs(best!.atMs - mid)) best = f;
  return best?.key;
}

const sec = (ms: number) => (ms / 1000).toFixed(1);
/** Dizide öğeyi bir adım kaydırır (sınırdaki düğmeler kilitli: hep içeride). */
const move = <T,>(list: T[], i: number, by: -1 | 1) => {
  [list[i], list[i + by]] = [list[i + by]!, list[i]!];
};

/**
 * Footage kurgusu (senaryo sekmesinde): vuruşlar sırayla, her vuruşta anlatım ve parçalar (kaynağın karesi, aralık,
 * kadraj, ses kararı, neden), sonunda ekran yazıları. Onaydan önce elle düzenlenir: vuruş ve parça sırası, silme,
 * aralık, kırpma odağı, kadraj, ses, hava, yazılar; "Kurguyu kaydet" sunucuya gönderir (kurallar orada uygulanır).
 * Zamanlama yapıldıysa gerçek süreler görünür.
 */
export function FootagePlanView({ state, plan, busy, approved, act, onDirtyChange }: { state: EpisodeState; plan: Plan; busy: boolean; approved: boolean; act: Act; onDirtyChange: (sceneId: string, dirty: boolean) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(plan);
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);
  useEffect(() => onDirtyChange(PLAN_DIRTY, dirty), [dirty, onDirtyChange]);
  const editable = !approved && !busy;
  // Yalnız footage bölümünde çizilir (ScriptTab): kaynak listesi vardır.
  const names = new Map(state.input.footage!.sources.map((s) => [s.id, s]));
  const cuts = state.footageCuts ?? [];
  const update = (fn: (p: Plan) => void) => {
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
  };
  const beatIds = draft.beats.map((b) => b.id);

  return (
    <div className="grid gap-4" data-footage-plan="">
      {editable && dirty && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
          <span className="flex-1">{t("footage.edit.unsaved")}</span>
          <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setDraft(plan)}>
            <RotateCcw size={14} /> {t("footage.edit.reset")}
          </button>
          <button type="button" className="btn-primary py-1 text-xs" onClick={() => void act({ type: "edit-footage", plan: draft })}>
            <Save size={14} /> {t("footage.edit.save")}
          </button>
        </div>
      )}
      <ol className="grid gap-3">
        {draft.beats.map((beat, i) => {
          const timed = dirty ? [] : cuts.filter((c) => c.beat === beat.id);
          return (
            <li key={beat.id} id={`scene-${state.id}-${beat.id}`} data-beat={beat.id} tabIndex={-1} className="grid gap-3 rounded-xl border border-line bg-panel-2/30 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-panel-2 text-[11px] font-semibold text-white">{i + 1}</span>
                <span className="font-mono">{beat.id}</span>
                {editable ? (
                  <select aria-label={t("footage.edit.mood")} className="field w-auto py-0.5 text-xs" value={beat.mood} onChange={(e) => update((p) => void (p.beats[i]!.mood = e.target.value as Beat["mood"]))}>
                    {MOODS.map((m) => <option key={m} value={m}>{t(`footage.mood.${m}`)}</option>)}
                  </select>
                ) : (
                  <span className="chip">{t(`footage.mood.${beat.mood}` as MessageKey)}</span>
                )}
                {timed.length > 0 && <span>{t("footage.plan.beatSec", { sec: sec(timed.reduce((n, c) => n + c.durMs, 0)) })}</span>}
                {editable && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" aria-label={t("footage.edit.beatUp")} disabled={i === 0} onClick={() => update((p) => move(p.beats, i, -1))}><ArrowUp size={14} /></button>
                    <button type="button" aria-label={t("footage.edit.beatDown")} disabled={i === draft.beats.length - 1} onClick={() => update((p) => move(p.beats, i, 1))}><ArrowDown size={14} /></button>
                    <button type="button" aria-label={t("footage.edit.beatRemove")} disabled={draft.beats.length === 1} onClick={() => update((p) => { p.beats.splice(i, 1); p.overlays = p.overlays.filter((o) => o.beat !== beat.id); })}><Trash2 size={14} /></button>
                  </span>
                )}
              </div>
              {beat.narration ? (
                <NarrationEditor key={`${state.id}-${beat.id}`} id={state.id} sceneId={beat.id} narration={state.script?.scenes.find((s) => s.id === beat.id)?.narration ?? beat.narration} disabled={approved || busy || dirty} act={act} onDirtyChange={onDirtyChange} />
              ) : (
                <p className="flex items-center gap-1 text-sm text-muted"><Mic size={12} /> {t("footage.plan.noNarration")}</p>
              )}
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {beat.segments.map((seg, j) => (
                  <SegmentCard
                    key={j}
                    id={`${beat.id}-${j + 1}`}
                    seg={seg}
                    source={names.get(seg.source)}
                    frame={frameFor(state.footageScan, seg.source, seg.fromMs, seg.toMs)}
                    cut={timed[j]}
                    editable={editable}
                    first={j === 0}
                    last={j === beat.segments.length - 1}
                    only={beat.segments.length === 1}
                    onChange={(fn) => update((p) => fn(p.beats[i]!.segments[j]!))}
                    onMove={(by) => update((p) => move(p.beats[i]!.segments, j, by))}
                    onRemove={() => update((p) => void p.beats[i]!.segments.splice(j, 1))}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      {draft.overlays.length > 0 && (
        <div className="grid gap-2 rounded-xl border border-line bg-panel-2/30 p-3 text-sm">
          <div className="label flex items-center gap-1"><Type size={12} /> {t("footage.plan.overlays")}</div>
          <ul className="grid gap-2">
            {draft.overlays.map((o, k) =>
              editable ? (
                <li key={k} data-overlay-item={o.style} className="flex flex-wrap items-center gap-2">
                  <input aria-label={t("footage.edit.text")} className="field min-w-40 flex-1 py-1" maxLength={60} value={o.text} onChange={(e) => update((p) => void (p.overlays[k]!.text = e.target.value))} />
                  <select aria-label={t("footage.edit.style")} className="field w-auto py-1 text-xs" value={o.style} onChange={(e) => update((p) => void (p.overlays[k]!.style = e.target.value as typeof o.style))}>
                    {STYLES.map((s) => <option key={s} value={s}>{t(`footage.style.${s}`)}</option>)}
                  </select>
                  <select aria-label={t("footage.edit.position")} className="field w-auto py-1 text-xs" value={o.position} onChange={(e) => update((p) => void (p.overlays[k]!.position = e.target.value as typeof o.position))}>
                    {POSITIONS.map((s) => <option key={s} value={s}>{t(`footage.position.${s}`)}</option>)}
                  </select>
                  <select aria-label={t("footage.edit.beat")} className="field w-auto py-1 text-xs" value={o.beat} onChange={(e) => update((p) => void (p.overlays[k]!.beat = e.target.value))}>
                    {beatIds.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <button type="button" aria-label={t("footage.edit.textRemove")} onClick={() => update((p) => void p.overlays.splice(k, 1))}><Trash2 size={14} /></button>
                </li>
              ) : (
                <li key={k} data-overlay-item={o.style} className="chip w-fit">
                  {o.text} <span className="text-muted">· {t(`footage.style.${o.style}`)} · {o.beat}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

type Source = NonNullable<EpisodeState["input"]["footage"]>["sources"][number];
type Cut = NonNullable<EpisodeState["footageCuts"]>[number];

/** Tek parça: kare, kaynak, aralık; düzenlenebilirken aralık, odak, kadraj, ses ve sıra denetimleri. */
function SegmentCard({ id, seg, source, frame, cut, editable, first, last, only, onChange, onMove, onRemove }: {
  id: string;
  seg: Segment;
  source?: Source;
  frame?: string;
  cut?: Cut;
  editable: boolean;
  first: boolean;
  last: boolean;
  only: boolean;
  onChange: (fn: (s: Segment) => void) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const image = source?.kind === "image";
  const silent = image || !source?.audio;
  const ms = (v: string) => Math.max(0, Math.round(Number(v) * 1000));
  return (
    <li data-segment={id} className="grid gap-1 rounded-lg border border-line bg-panel-2 p-2 text-xs">
      {frame ? <img src={asset(frame)} alt={seg.why} className="aspect-video w-full rounded object-cover" style={{ objectPosition: `${seg.focusX * 100}% 50%` }} /> : <div className="aspect-video w-full rounded bg-panel" />}
      <span className="flex items-center gap-1 truncate text-white">
        {image ? <ImageIcon size={12} /> : <Film size={12} />} {source?.name ?? seg.source}
      </span>
      {editable ? (
        <div className="grid gap-1">
          {image ? (
            <label className="flex items-center gap-1">{t("footage.edit.seconds")}
              <input aria-label={t("footage.edit.seconds")} type="number" min={0.8} step={0.1} className="field w-20 py-0.5" value={seg.toMs / 1000} onChange={(e) => onChange((s) => void (s.toMs = ms(e.target.value)))} />
            </label>
          ) : (
            <span className="flex items-center gap-1">
              <input aria-label={t("footage.edit.from")} type="number" min={0} step={0.1} className="field w-20 py-0.5" value={seg.fromMs / 1000} onChange={(e) => onChange((s) => void (s.fromMs = ms(e.target.value)))} />
              –
              <input aria-label={t("footage.edit.to")} type="number" min={0} step={0.1} className="field w-20 py-0.5" value={seg.toMs / 1000} onChange={(e) => onChange((s) => void (s.toMs = ms(e.target.value)))} />
            </span>
          )}
          <label className="flex items-center gap-1">{t("footage.edit.focus")}
            <input aria-label={t("footage.edit.focus")} type="range" min={0} max={1} step={0.05} value={seg.focusX} onChange={(e) => onChange((s) => void (s.focusX = Number(e.target.value)))} />
          </label>
          <span className="flex flex-wrap gap-1">
            <select aria-label={t("footage.edit.fit")} className="field w-auto py-0.5 text-xs" value={seg.fit} onChange={(e) => onChange((s) => void (s.fit = e.target.value as Segment["fit"]))}>
              {FITS.map((f) => <option key={f} value={f}>{t(`footage.fit.${f}`)}</option>)}
            </select>
            <select aria-label={t("footage.edit.audio")} className="field w-auto py-0.5 text-xs" value={seg.audio} disabled={silent} onChange={(e) => onChange((s) => void (s.audio = e.target.value as Segment["audio"]))}>
              {AUDIOS.map((a) => <option key={a} value={a}>{t(`footage.audio.${a}`)}</option>)}
            </select>
          </span>
          <span className="flex gap-1">
            <button type="button" aria-label={t("footage.edit.left")} disabled={first} onClick={() => onMove(-1)}><ArrowLeft size={14} /></button>
            <button type="button" aria-label={t("footage.edit.right")} disabled={last} onClick={() => onMove(1)}><ArrowRight size={14} /></button>
            <button type="button" aria-label={t("footage.edit.remove")} disabled={only} onClick={onRemove}><Trash2 size={14} /></button>
          </span>
        </div>
      ) : (
        <>
          <span className="text-muted">
            {image ? t("footage.plan.still", { sec: sec(cut?.durMs ?? seg.toMs) }) : t("footage.plan.range", { from: sec(cut?.fromMs ?? seg.fromMs), to: sec(cut?.toMs ?? seg.toMs) })}
            {cut && cut.speed < 1 ? ` · ×${cut.speed.toFixed(2)}` : ""}
            {cut && cut.holdMs > 0 ? ` · ${t("footage.plan.hold", { sec: sec(cut.holdMs) })}` : ""}
          </span>
          <span className="flex flex-wrap gap-1">
            <span className="chip">{t(`footage.fit.${seg.fit}`)}</span>
            <span className="chip">{t(`footage.audio.${cut?.audio ?? seg.audio}`)}</span>
          </span>
        </>
      )}
      <span className="text-muted italic">{seg.why}</span>
    </li>
  );
}
