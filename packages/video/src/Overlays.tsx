import { fontFamily, TYPOGRAPHY_PAIRS, VERTICAL_SAFE, type Timeline, type TimelineOverlay, type Typography } from "@ys/core";
import type { CSSProperties } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { splitWords, useKinetic, wordCount } from "./kinetic.tsx";
import { overlayFrame } from "./overlay-timing.ts";

/**
 * Vektör sahnesi dışındaki ekran yazıları (footage modu, 22 Kas): kanca, başlık, etiket, çağrı. Dikeyde platform
 * arayüzünden uzak (VERTICAL_SAFE), altta altyazının üstünde; her yazının kendi açılışı (overlay-timing.ts).
 */
export const OVERLAY_LOOK: Record<TimelineOverlay["style"], { size: number; ink: string; plate: string; weight: number }> = {
  hook: { size: 84, ink: "#111111", plate: "#FFD84D", weight: 900 },
  title: { size: 64, ink: "#FFFFFF", plate: "rgba(0,0,0,0.62)", weight: 800 },
  label: { size: 46, ink: "#FFFFFF", plate: "rgba(0,0,0,0.55)", weight: 700 },
  cta: { size: 56, ink: "#111111", plate: "#FFFFFF", weight: 800 },
};

/** Altyazı bloğunun üstü (alttan px): altta duran yazı altyazının üstüne çıkar. */
export const CAPTION_CLEAR = 200;

/** Yazının çerçevedeki yeri: üst/orta/alt, iki yandan eşit pay (dikeyde sağdaki düğmeler kadar). */
export function overlayBox(position: TimelineOverlay["position"], width: number, height: number): CSSProperties {
  const tall = height > width;
  const side = tall ? VERTICAL_SAFE.right + 10 : Math.round(width * 0.1);
  const base: CSSProperties = { position: "absolute", left: side, right: side, display: "flex", justifyContent: "center", textAlign: "center" };
  if (position === "top") return { ...base, top: tall ? VERTICAL_SAFE.top + 40 : 80 };
  if (position === "bottom") return { ...base, bottom: (tall ? VERTICAL_SAFE.bottom + 20 : 90) + CAPTION_CLEAR };
  return { ...base, top: 0, bottom: 0, alignItems: "center" };
}

function Overlay({ overlay, typography }: { overlay: TimelineOverlay; typography?: Typography }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const state = overlayFrame(overlay, frame, fps);
  const look = OVERLAY_LOOK[overlay.style];
  const shown = overlay.anim === "typewriter" ? overlay.text.slice(0, Math.round(overlay.text.length * state.reveal)) : overlay.text;
  const plate = useKinetic(overlay.anim === "kinetic" ? state.reveal : undefined, wordCount(shown));
  const face = typography ? TYPOGRAPHY_PAIRS[typography.pair][overlay.style === "label" ? "body" : "heading"] : undefined;
  return (
    <div data-overlay={overlay.style} style={overlayBox(overlay.position, width, height)}>
      {shown && (
        <span
          ref={plate}
          style={{
            display: "inline-block",
            padding: "0.16em 0.55em 0.2em",
            borderRadius: 14,
            background: look.plate,
            color: look.ink,
            fontFamily: face ? fontFamily(face) : "Inter, 'Noto Sans', 'Segoe UI', sans-serif",
            fontSize: look.size,
            fontWeight: face?.weight ?? look.weight,
            lineHeight: 1.15,
            boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
            opacity: state.opacity,
            transform: `scale(${state.scale})`,
            whiteSpace: "pre-wrap",
          }}
        >
          {overlay.anim === "kinetic" ? splitWords(shown) : shown}
        </span>
      )}
    </div>
  );
}

export function Overlays({ overlays, typography }: { overlays: NonNullable<Timeline["overlays"]>; typography?: Typography }) {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {overlays.map((o, i) => (
        <Sequence key={`${i}-${o.fromFrame}`} from={o.fromFrame} durationInFrames={o.durationInFrames} name={`text-${o.style}`}>
          <Overlay overlay={o} typography={typography} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
