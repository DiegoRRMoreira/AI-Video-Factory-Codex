"use client";

import type { EpisodeState } from "@ys/pipeline/light";
import { Film, Image as ImageIcon, Mic, Type } from "lucide-react";
import type { MessageKey } from "../../../lib/i18n";
import { useI18n } from "../../locale-provider";
import { NarrationEditor } from "./narration-editor";
import { asset, type Act } from "./parts";

type Plan = NonNullable<EpisodeState["footagePlan"]>;
type Scan = NonNullable<EpisodeState["footageScan"]>;

/** Parçanın ortasına en yakın taranmış kare (kurgu ajanının gördüğü karelerden). */
export function frameFor(scan: Scan | undefined, source: string, fromMs: number, toMs: number): string | undefined {
  const mid = (fromMs + toMs) / 2;
  const frames = scan?.[source]?.frames ?? [];
  let best = frames[0];
  for (const f of frames) if (Math.abs(f.atMs - mid) < Math.abs(best!.atMs - mid)) best = f;
  return best?.key;
}

const sec = (ms: number) => (ms / 1000).toFixed(1);

/**
 * Footage kurgusu (senaryo sekmesinde, onaydan önce): vuruşlar sırayla, her vuruşta anlatım (düzenlenebilir) ve
 * parçalar (kaynağın karesi, aralık, kadraj, ses kararı, neden). Zamanlama yapıldıysa gerçek süreler. Sonunda yazılar.
 */
export function FootagePlanView({ state, plan, busy, approved, act, onDirtyChange }: { state: EpisodeState; plan: Plan; busy: boolean; approved: boolean; act: Act; onDirtyChange: (sceneId: string, dirty: boolean) => void }) {
  const { t } = useI18n();
  // Yalnız footage bölümünde çizilir (ScriptTab): kaynak listesi vardır.
  const names = new Map(state.input.footage!.sources.map((s) => [s.id, s]));
  const cuts = state.footageCuts ?? [];
  return (
    <div className="grid gap-4" data-footage-plan="">
      <ol className="grid gap-3">
        {plan.beats.map((beat, i) => {
          const timed = cuts.filter((c) => c.beat === beat.id);
          return (
            <li key={beat.id} id={`scene-${state.id}-${beat.id}`} tabIndex={-1} className="grid gap-3 rounded-xl border border-line bg-panel-2/30 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-panel-2 text-[11px] font-semibold text-white">{i + 1}</span>
                <span className="font-mono">{beat.id}</span>
                <span className="chip">{t(`footage.mood.${beat.mood}` as MessageKey)}</span>
                {timed.length > 0 && <span>{t("footage.plan.beatSec", { sec: sec(timed.reduce((n, c) => n + c.durMs, 0)) })}</span>}
              </div>
              {beat.narration ? (
                <NarrationEditor key={`${state.id}-${beat.id}`} id={state.id} sceneId={beat.id} narration={state.script?.scenes.find((s) => s.id === beat.id)?.narration ?? beat.narration} disabled={approved || busy} act={act} onDirtyChange={onDirtyChange} />
              ) : (
                <p className="flex items-center gap-1 text-sm text-muted"><Mic size={12} /> {t("footage.plan.noNarration")}</p>
              )}
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {beat.segments.map((seg, j) => {
                  const src = names.get(seg.source);
                  const frame = frameFor(state.footageScan, seg.source, seg.fromMs, seg.toMs);
                  const cut = timed[j];
                  return (
                    <li key={j} data-segment={`${beat.id}-${j + 1}`} className="grid gap-1 rounded-lg border border-line bg-panel-2 p-2 text-xs">
                      {frame ? <img src={asset(frame)} alt={seg.why} className="aspect-video w-full rounded object-cover" style={{ objectPosition: `${seg.focusX * 100}% 50%` }} /> : <div className="aspect-video w-full rounded bg-panel" />}
                      <span className="flex items-center gap-1 truncate text-white">
                        {src?.kind === "image" ? <ImageIcon size={12} /> : <Film size={12} />} {src?.name ?? seg.source}
                      </span>
                      <span className="text-muted">
                        {src?.kind === "image" ? t("footage.plan.still", { sec: sec((cut?.durMs ?? seg.toMs)) }) : t("footage.plan.range", { from: sec(cut?.fromMs ?? seg.fromMs), to: sec(cut?.toMs ?? seg.toMs) })}
                        {cut && cut.speed < 1 ? ` · ×${cut.speed.toFixed(2)}` : ""}
                        {cut && cut.holdMs > 0 ? ` · ${t("footage.plan.hold", { sec: sec(cut.holdMs) })}` : ""}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        <span className="chip">{t(`footage.fit.${seg.fit}`)}</span>
                        <span className="chip">{t(`footage.audio.${cut?.audio ?? seg.audio}`)}</span>
                      </span>
                      <span className="text-muted italic">{seg.why}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
      {plan.overlays.length > 0 && (
        <div className="grid gap-2 rounded-xl border border-line bg-panel-2/30 p-3 text-sm">
          <div className="label flex items-center gap-1"><Type size={12} /> {t("footage.plan.overlays")}</div>
          <ul className="flex flex-wrap gap-2">
            {plan.overlays.map((o, i) => (
              <li key={i} data-overlay-item={o.style} className="chip">
                {o.text} <span className="text-muted">· {t(`footage.style.${o.style}`)} · {o.beat}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
