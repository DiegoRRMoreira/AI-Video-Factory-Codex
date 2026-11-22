import type { MotionScene } from "@ys/core";
import type { SfxEvent } from "../sfx.ts";
import { diagramOrder } from "./order.ts";
import { beatFrames, countAt, enterFrames, FILM } from "./timing.ts";

/**
 * Film sahnesinin ses olayları (render'la aynı zamanlamalardan): sahnenin vurgu sesi kesmede (riser kesmeye biter),
 * whip ve push geçişleri vınlar, öğeler indikleri anda hafif ses verir (slam ve kart iniş, kelime ve çubuk tıkı, düğüm
 * pop'u, sayaç tıkları ve zil, montaj kesmesinde vuruş). Kesme başına bir vurgu (huashu sound.md: efekt müzikten ~8 dB hafif).
 */
export function filmSounds(scene: MotionScene, from: number, frames: number, bpm: number, fps: number): SfxEvent[] {
  const out: SfxEvent[] = [];
  const at = (f: number) => from + f;
  if (scene.hit === "riser") {
    // Riser kesmeye biter (iki vuruş önce başlar); filmin ilk karesinde yükselecek yer yok.
    const len = Math.round(2 * beatFrames(bpm, fps));
    if (from > 0) out.push({ frame: Math.max(0, from - len), sound: "riser", frames: Math.min(len, from) });
  } else if (scene.hit === "impact") out.push({ frame: from, sound: "impact" }, { frame: from, sound: "subdrop", gain: 0.7 });
  else if (scene.hit !== "none") out.push({ frame: from, sound: scene.hit });
  if (scene.transition === "whip") out.push({ frame: from, sound: "whoosh", pitch: 1.5, gain: 0.8 });
  if (scene.transition === "push") out.push({ frame: from, sound: "whoosh", pitch: 0.8, gain: 0.8 });

  const enters = enterFrames(scene, frames, bpm, fps);
  const land = Math.round(FILM.enterSec * fps * 0.6);
  switch (scene.language) {
    case "kinetic": {
      const k = scene.kinetic!;
      if (k.mode === "slam" || k.mode === "chapter") enters.forEach((f, i) => out.push({ frame: at(f + land), sound: i === 0 ? "thud" : "tick", gain: 0.8 }));
      else enters.forEach((f, i) => out.push({ frame: at(f), sound: "tick", pitch: 0.7 + 0.05 * i, gain: 0.45 }));
      break;
    }
    case "data": {
      const d = scene.data!;
      if (d.chart === "count") {
        // Sayaç yavaşladıkça tıklar seyrelir; bitişte zil.
        const start = enters[1]!;
        const end = start + Math.round(FILM.countSec * fps);
        let shown = 0;
        for (let f = start; f < end; f++) {
          const k = countAt(0, 1, f, start, fps);
          if (k - shown < 1 / 14) continue;
          out.push({ frame: at(f), sound: "tick", pitch: 0.8 + k * 0.6, gain: 0.6 });
          shown = k;
        }
        out.push({ frame: at(end), sound: "ding" });
      } else d.points.forEach((_, i) => out.push({ frame: at(enters[1 + i]!), sound: "tick", pitch: 0.8 + 0.08 * i, gain: 0.6 }));
      if (d.callout) out.push({ frame: at(enters.at(-1)!), sound: "pop" });
      break;
    }
    case "diagram":
      diagramOrder(scene.diagram!).forEach((u, i) => out.push(u.startsWith("edge:") ? { frame: at(enters[i]!), sound: "tick", pitch: 1.2, gain: 0.4 } : { frame: at(enters[i]!), sound: "pop", pitch: 0.9 }));
      break;
    case "grid": {
      const g = scene.grid!;
      // Montajın her kesmesi bir vuruş (ilk kart sahnenin kendi vurgusuyla gelir); ızgarada kart inişi.
      if (g.mode === "montage") enters.forEach((f, i) => i > 0 && out.push({ frame: at(f), sound: "hit", pitch: 1 + 0.04 * i, gain: 0.45 }));
      else enters.forEach((f) => out.push({ frame: at(f + land), sound: "thud", gain: 0.5 }));
      break;
    }
    default:
      // Alan ve nesne: başlıklar sessiz yükselir; sahnenin vurgusu yeter.
      break;
  }
  return out;
}
