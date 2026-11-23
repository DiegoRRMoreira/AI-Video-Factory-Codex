import type { SceneThree } from "@ys/core";
import { useMemo } from "react";
import { Img } from "remotion";
import { PixiParticles } from "../PixiParticles.tsx";
import { Scene3D } from "../Scene3D.tsx";
import { fileSrc, fitSize, fitWrapped, labelParts, type PartProps } from "./context.ts";
import { enterK } from "./timing.ts";

/** Hex → Pixi renk sayısı. */
const tint = (hex: string) => parseInt(hex.slice(1), 16);

/**
 * Üretken alan (hava, zeka): tohumlu PixiJS parçacıkları vurgu renginde bütün kareyi kaplar (WebGL yoksa boş kalır),
 * başlık ve alt yazı ortada yükselir.
 */
export function Field(p: PartProps) {
  const f = p.scene.field!;
  return (
    <>
      <div style={{ position: "absolute", inset: 0 }}>
        <PixiParticles kind={f.kind} seed={p.scene.id} size={[p.width, p.height]} tint={tint(p.colors.accent)} />
      </div>
      <Titles p={p} title={f.title} sub={f.subtitle} y={0.5} />
    </>
  );
}

/**
 * 3D nesne (somut, premium): mevcut prosedürel Three.js modellerinden biri (Scene3D) ortada döner, yaklaşarak gelir;
 * verilen görsel (logo) nesnenin önünde, başlık ve not altında.
 */
export function Object3D(p: PartProps) {
  const o = p.scene.object!;
  const size = Math.round(Math.min(p.box.w, p.box.h) * 0.72);
  const cx = p.box.x + p.box.w / 2;
  const cy = p.box.y + p.box.h * 0.42;
  const spec = useMemo<SceneThree>(
    () => ({ preset: o.preset, start: 0, end: 1, x: cx, y: cy, size, color: p.colors.fg, accent: p.colors.accent, speed: 1, camera: "push_in", wireframe: false }),
    [o.preset, cx, cy, size, p.colors.fg, p.colors.accent],
  );
  const image = o.image !== undefined ? p.images[o.image] : undefined;
  // Görsel varsa ilk öğedir (başlıkla birlikte girer).
  const iq = image ? enterK(p.frame, p.enters[0]!, p.fps) : 0;
  return (
    <>
      <Scene3D spec={spec} time={p.frame / p.fps} progress={p.frame / Math.max(1, p.frames)} />
      {image && (
        <Img data-image="" src={fileSrc(image)} style={{ position: "absolute", left: cx - size * 0.22, top: cy - size * 0.22, width: size * 0.44, height: size * 0.44, objectFit: "contain", opacity: iq, transform: `scale(${0.7 + 0.3 * iq})` }} />
      )}
      <Titles p={p} title={o.title} sub={o.caption} y={0.86} skipFirst={!!image && !o.title} />
    </>
  );
}

/**
 * Ortalanmış başlık + alt yazı, giriş karelerinde maskeden yükselir. Alt yazı başlığın 0,42'sidir, en az SUB_MIN; başlık
 * yoksa tek yazıdır ve kendi yüzüyle en çok iki satıra sığan en büyük boydadır; ayraçlı not ("Ad · slogan") ayraçta
 * iki satıra bölünür, satırlar dengeli kayar. Eskiden başlıksız alt yazı başlık gibi
 * sığdırılıp 0,42'ye iniyordu: 42 harflik not dikeyde ~30, yatayda ~23 px kalıyordu (23 Kas, 9:16 film m12 logo sahnesi).
 */
export function titleSizes(p: Pick<PartProps, "width" | "height" | "box" | "heading" | "body">, title?: string, sub?: string): { title: number; sub: number } {
  const head = !title ? 0 : p.height > p.width ? fitWrapped([title], p.box.w, p.box.h * 0.3, 96, p.heading.em) : fitSize([title], p.box.w, 112, p.heading.em);
  if (!sub) return { title: head, sub: 0 };
  if (title) return { title: head, sub: Math.max(SUB_MIN, Math.round(head * 0.42)) };
  return { title: 0, sub: fitWrapped(labelParts(sub), p.box.w, SUB_ALONE * 1.3 * 2, SUB_ALONE, p.body.em, 1.3) };
}

/** Başlığın altındaki notun en küçük boyu ve başlıksız notun en büyük boyu (px). */
const SUB_MIN = 32;
const SUB_ALONE = 64;

function Titles({ p, title, sub, y, skipFirst }: { p: PartProps; title?: string; sub?: string; y: number; skipFirst?: boolean }) {
  if (!title && !sub) return null;
  const size = titleSizes(p, title, sub);
  let n = skipFirst ? 1 : 0;
  return (
    <div style={{ position: "absolute", left: p.box.x, width: p.box.w, top: p.box.y + p.box.h * y, transform: "translateY(-50%)", textAlign: "center", color: p.colors.fg }}>
      {title && <Rise q={enterK(p.frame, p.enters[n++]!, p.fps)} style={{ fontFamily: p.heading.family, fontWeight: p.heading.weight, fontSize: size.title, lineHeight: 1.08 }} text={title} />}
      {sub && <Rise q={enterK(p.frame, p.enters[n]!, p.fps)} style={{ fontFamily: p.body.family, fontWeight: p.body.weight, fontSize: size.sub, lineHeight: 1.3, opacity: 0.85 }} text={labelParts(sub).join("\n")} />}
    </div>
  );
}

function Rise({ q, style, text }: { q: number; style: Record<string, string | number>; text: string }) {
  return (
    <div data-rise="" style={{ overflow: "hidden", paddingBottom: "0.08em" }}>
      <div style={{ ...style, whiteSpace: "pre-line", textWrap: "balance", transform: `translateY(${(1 - q) * 110}%)` }}>{text}</div>
    </div>
  );
}
