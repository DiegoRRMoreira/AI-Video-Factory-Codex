"use client";

import type { MotionFilm, MotionScene } from "@ys/core";
import type { EpisodeState } from "@ys/pipeline/light";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../locale-provider";
import { NarrationEditor } from "./narration-editor";
import type { Act } from "./parts";

/** Sahnenin ekrandaki ana metni (dile göre): kartta filmin ne söylediği okunur. */
export function sceneText(s: MotionScene): string {
  switch (s.language) {
    case "kinetic":
      return s.kinetic!.lines.join(" / ");
    case "data": {
      const d = s.data!;
      const values = d.chart === "count" ? `${d.count!.prefix}${d.count!.to}${d.count!.suffix}${d.unit ?? ""}` : d.points.map((p) => `${p.label} ${p.value}${d.unit ?? ""}`).join(", ");
      return `${d.title}: ${values}${d.callout ? ` (${d.callout})` : ""}`;
    }
    case "diagram": {
      const g = s.diagram!;
      const label = new Map(g.nodes.map((n) => [n.id, n.label]));
      const flow = g.edges.length ? g.edges.map((e) => `${label.get(e.from)} → ${label.get(e.to)}`).join(", ") : g.nodes.map((n) => n.label).join(", ");
      return `${g.title ? `${g.title}: ` : ""}${flow}`;
    }
    case "grid":
      return `${s.grid!.title ? `${s.grid!.title}: ` : ""}${s.grid!.cards.map((c) => (c.stat ? `${c.stat} ${c.title}` : c.title)).join(" · ")}`;
    case "field":
      return [s.field!.title, s.field!.subtitle].filter(Boolean).join(" / ") || s.field!.kind;
    case "object":
      return [s.object!.title, s.object!.caption].filter(Boolean).join(" / ") || s.object!.preset;
  }
}

const SECTION_TONE: Record<MotionFilm["sections"][number]["name"], string> = {
  hook: "bg-accent/70",
  build: "bg-accent/40",
  stop: "bg-panel-2",
  peak: "bg-accent",
  resolve: "bg-accent/25",
};

/**
 * Hareketli grafik filminin tarifi (senaryo sekmesi, motion modu): ritim çizelgesi, sahneler (dil, vuruş, geçiş, kamera,
 * zemin, ekrandaki metin, temsili veri), kod denetiminin kalan bulguları; onaydan önce "notla yeniden yaz". Anlatım
 * açıksa sahnenin cümlesi düzenlenebilir.
 */
export function FilmTreatment({ state, film, busy, approved, act, onDirtyChange }: { state: EpisodeState; film: MotionFilm; busy: boolean; approved: boolean; act: Act; onDirtyChange: (sceneId: string, dirty: boolean) => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const beatSec = 60 / film.bpm;
  const total = film.scenes.reduce((n, s) => n + s.beats, 0) * beatSec;
  const bars = film.sections.reduce((n, s) => n + s.bars, 0);
  const narration = state.input.motion?.narration === true;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border border-line bg-panel-2/50 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-base font-semibold">{film.title}</span>
          <span className="text-muted">{t("film.meta", { bpm: film.bpm, sec: total.toFixed(1), scenes: film.scenes.length, route: t(`film.route.${film.route}`) })}</span>
          <span className="flex gap-1" aria-label={t("film.palette")}>
            {(["ground", "ink", "accent", "alt"] as const).map((k) => (
              <span key={k} title={`${k} ${film.palette[k]}`} className="h-5 w-5 rounded border border-line" style={{ background: film.palette[k] }} />
            ))}
          </span>
        </div>
        <div>
          <div className="label">{t("film.rhythm")}</div>
          <div className="flex h-9 overflow-hidden rounded-lg border border-line" data-testid="film-rhythm">
            {film.sections.map((s, i) => (
              <div key={i} className={`flex min-w-0 flex-col justify-center px-2 text-[11px] leading-tight ${SECTION_TONE[s.name]}`} style={{ width: `${(s.bars / Math.max(1, bars)) * 100}%` }} title={t("film.section", { name: t(`film.section.${s.name}`), bars: s.bars, energy: s.energy })}>
                <span className="truncate font-semibold">{t(`film.section.${s.name}`)}</span>
                <span className="truncate opacity-75">{s.bars} · {s.energy}/10</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(state.motionLint?.length ?? 0) > 0 && (
        <ul className="grid gap-1 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs" data-testid="film-lint">
          {state.motionLint!.map((i, n) => (
            <li key={n}>
              <span className="font-semibold">{t(`film.lint.${i.kind}`)}</span> {i.sceneId && <span className="font-mono">{i.sceneId}</span>} @{i.atSec}s · {i.detail}
            </li>
          ))}
        </ul>
      )}

      <ol className="grid gap-3">
        {film.scenes.map((s, i) => (
          <li key={s.id} id={`scene-${state.id}-${s.id}`} className="grid gap-3 rounded-xl border border-line bg-panel-2/30 p-3 md:grid-cols-[180px_1fr]">
            <div className="grid content-start gap-1 text-xs text-muted">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-panel-2 text-[11px] font-semibold text-white">{i + 1}</span>
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{t(`film.lang.${s.language}`)}</span>
              </div>
              <div>{t("film.beats", { beats: s.beats, sec: (s.beats * beatSec).toFixed(1) })}</div>
              <div>{[t(`film.transition.${s.transition}`), t(`film.camera.${s.camera}`), t(`film.ground.${s.ground}`)].join(" · ")}</div>
              {s.hit !== "none" && <div>♪ {s.hit}</div>}
              {s.illustrative && <div className="w-fit rounded-full border border-warn/60 px-2 text-warn">{t("film.illustrative")}</div>}
            </div>
            <div className="grid content-start gap-2">
              <p className="leading-relaxed" data-testid="film-scene-text">{sceneText(s)}</p>
              {narration && <NarrationEditor key={`${state.id}-${s.id}`} id={state.id} sceneId={s.id} narration={state.script?.scenes.find((x) => x.id === s.id)?.narration ?? s.narration} disabled={approved || busy} act={act} onDirtyChange={onDirtyChange} />}
            </div>
          </li>
        ))}
      </ol>

      {!approved && (
        <div className="grid gap-2 rounded-xl border border-line p-3 text-sm">
          <label className="label" htmlFor={`remake-${state.id}`}>{t("film.remake")}</label>
          <textarea id={`remake-${state.id}`} rows={2} className="field" value={note} placeholder={t("film.remake.placeholder")} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn-ghost w-fit" disabled={busy || !note.trim()} onClick={() => void act({ type: "remake-film", note })}>
            <RefreshCw size={14} /> {t("film.remake.submit")}
          </button>
        </div>
      )}
    </div>
  );
}
