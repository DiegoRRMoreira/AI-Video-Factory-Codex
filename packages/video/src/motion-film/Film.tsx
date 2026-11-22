import { fontFamily, TYPOGRAPHY_PAIRS, type MotionLook, type MotionScene } from "@ys/core";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Field, Object3D } from "./Ambient.tsx";
import { emOf, type PartProps } from "./context.ts";
import { Data } from "./Data.tsx";
import { Diagram } from "./Diagram.tsx";
import { Grid } from "./Grid.tsx";
import { Kinetic } from "./Kinetic.tsx";
import { CAMERA_MAX, cameraAt, colorsOf, enterFrames, expoOut, FILM, safeBox, shakeAt } from "./timing.ts";

/** "Temsili veri" rozetinin dile göre metni (brifte olmayan sayılar). */
export const ILLUSTRATIVE: Record<string, string> = { tr: "Temsili veri", en: "Illustrative data" };

/**
 * Hareketli grafik filminin bir sahnesi: zemin rengi, kamera (ölçek + kayma + başlık inişlerinin sarsıntısı), dilin
 * bileşeni, sahnenin kendi çizdiği giriş örtüsü (flash, flood, flip; whip/push/iris Episode'un geçişidir) ve brifte
 * olmayan veri için her karede "temsili veri" rozeti.
 */
export function FilmScene({ scene, look, frames, lang, captions }: { scene: MotionScene; look: MotionLook; frames: number; lang: string; captions: boolean }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const pair = TYPOGRAPHY_PAIRS[look.type];
  const colors = colorsOf(scene.ground, look.palette);
  // Kamera güvenli kutunun ortasından büyür; içerik kameranın en büyük ölçeğinde de kutuda kalsın diye kutu o kadar daralır.
  const safe = safeBox(width, height, captions);
  const k = CAMERA_MAX[scene.camera];
  const box = { x: safe.x + (safe.w * (1 - 1 / k)) / 2, y: safe.y + (safe.h * (1 - 1 / k)) / 2, w: safe.w / k, h: safe.h / k };
  const enters = enterFrames(scene, frames, look.bpm, fps);
  const props: PartProps = {
    scene,
    frame,
    frames,
    fps,
    bpm: look.bpm,
    width,
    height,
    box,
    colors,
    heading: { family: fontFamily(pair.heading), weight: pair.heading.weight, em: emOf(pair.heading) },
    body: { family: fontFamily(pair.body), weight: pair.body.weight, em: emOf(pair.body) },
    lang,
    images: look.images,
    enters,
  };
  const cam = cameraAt(scene.camera, frame, frames, look.bpm, fps);
  // Slam satırları oturunca (girişin ~%60'ı) sahne üç kare sarsılır.
  const lands = scene.kinetic?.mode === "slam" ? enters.map((f) => f + Math.round(FILM.enterSec * fps * 0.6)) : [];
  const shake = shakeAt(lands, frame);
  const Part = { kinetic: Kinetic, data: Data, diagram: Diagram, grid: Grid, field: Field, object: Object3D }[scene.language];
  return (
    <AbsoluteFill data-film={scene.id} style={{ background: colors.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: `${safe.x + safe.w / 2}px ${safe.y + safe.h / 2}px`, transform: `translateX(${(cam.x * 100 + shake).toFixed(3)}%) scale(${cam.scale.toFixed(4)})` }}>
        <Part {...props} />
      </AbsoluteFill>
      <Entry scene={scene} frame={frame} colors={colors} alt={look.palette.alt} />
      {scene.illustrative && (
        <div
          data-badge=""
          style={{
            position: "absolute",
            // Kutunun sağ üst köşesi (başlıklar solda): dikeyde de platform arayüzünün dışında.
            top: safe.y,
            right: width - safe.x - safe.w,
            padding: "8px 18px",
            borderRadius: 999,
            border: `2px solid ${colors.fg}`,
            color: colors.fg,
            fontFamily: props.body.family,
            fontWeight: props.body.weight,
            fontSize: 30,
            lineHeight: "34px",
            opacity: 0.75,
          }}
        >
          {ILLUSTRATIVE[lang.slice(0, 2)] ?? ILLUSTRATIVE.en}
        </div>
      )}
    </AbsoluteFill>
  );
}

/** Sahnenin kendi giriş örtüsü: flash (beyaz parlama söner), flood (vurgu rengi kareyi kaplar, ortaya çekilir), flip (öteki zemin yukarı kalkar). */
function Entry({ scene, frame, colors, alt }: { scene: MotionScene; frame: number; colors: PartProps["colors"]; alt: string }) {
  if (scene.transition === "flash" && frame < FILM.flashFrames) {
    return <AbsoluteFill data-entry="flash" style={{ background: "#ffffff", opacity: 1 - expoOut(frame / FILM.flashFrames) }} />;
  }
  if (scene.transition === "flood" && frame < FILM.floodFrames) {
    const r = (1 - expoOut(frame / FILM.floodFrames)) * 75;
    // Vurgu zemininde vurgu rengi yazının rengidir (colorsOf): taşma zeminle aynı renge düşmez.
    return <AbsoluteFill data-entry="flood" style={{ background: colors.accent, clipPath: `circle(${r.toFixed(2)}% at 50% 50%)` }} />;
  }
  if (scene.transition === "flip" && frame < FILM.flipFrames) {
    return <AbsoluteFill data-entry="flip" style={{ background: alt, transform: `translateY(${(-expoOut(frame / FILM.flipFrames) * 100).toFixed(2)}%)` }} />;
  }
  return null;
}
