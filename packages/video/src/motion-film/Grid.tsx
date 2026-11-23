import type { MotionGrid } from "@ys/core";
import { Img } from "remotion";
import { fileSrc, fitSize, fitWrapped, type PartProps } from "./context.ts";
import { clamp01, contrast, enterK } from "./timing.ts";

/**
 * Kart ızgarası ve montaj (liste, çeşitlilik): grid kipinde kartlar vuruşlarda ızgaraya oturur (grid-card-assemble);
 * montaj kipinde her tempo adımında tek kart kareyi doldurur, kesme vuruştadır ve kart zaten hareket ederek girer
 * (1,12'den 1'e, rhythm.md §5). Montajda kartlar zemin ile vurgu arasında döner.
 */
export function Grid(p: PartProps) {
  const g = p.scene.grid!;
  return g.mode === "montage" ? <Montage g={g} p={p} /> : <Assemble g={g} p={p} />;
}

/** Izgaranın sütun ve satır sayısı (dikeyde döner). */
export function gridShape(n: number, tall: boolean): { cols: number; rows: number } {
  const wide = n <= 3 ? { cols: n, rows: 1 } : n === 4 ? { cols: 2, rows: 2 } : n <= 6 ? { cols: 3, rows: 2 } : { cols: 3, rows: 3 };
  return tall ? { cols: wide.rows, rows: wide.cols } : wide;
}

function Assemble({ g, p }: { g: MotionGrid; p: PartProps }) {
  const { box, colors, heading, frame, fps } = p;
  const tall = p.height > p.width;
  // Başlık tek satıra sığar (60 harflik başlık 64 px'te kutuyu aşıp kartların üstüne kayıyordu).
  const titleSize = g.title ? fitSize([g.title], p.scene.illustrative ? box.w * 0.76 : box.w, Math.min(box.h * 0.075, 64), p.heading.em) : 0;
  const lead = g.title ? 1 : 0;
  const top = g.title ? titleSize * 1.8 : 0;
  const { cols, rows } = gridShape(g.cards.length, tall);
  const gap = Math.round(Math.min(box.w, box.h) * 0.03);
  const cw = (box.w - gap * (cols - 1)) / cols;
  const ch = (box.h - top - gap * (rows - 1)) / rows;
  return (
    <div style={{ position: "absolute", inset: 0, color: colors.fg }}>
      {g.title && (
        <div data-title="" style={{ position: "absolute", left: box.x, top: box.y, width: p.scene.illustrative ? box.w * 0.76 : box.w, fontFamily: heading.family, fontWeight: heading.weight, fontSize: titleSize, opacity: enterK(frame, p.enters[0]!, fps) }}>
          {g.title}
        </div>
      )}
      {g.cards.map((card, i) => {
        const q = enterK(frame, p.enters[lead + i]!, fps);
        const x = box.x + (i % cols) * (cw + gap);
        const y = box.y + top + Math.floor(i / cols) * (ch + gap);
        return (
          <div key={i} data-card={i} style={{ position: "absolute", left: x, top: y, width: cw, height: ch, opacity: clamp01(q * 2), transform: `scale(${1.12 - 0.12 * q})` }}>
            <Card card={card} p={p} w={cw} h={ch} bg={colors.card} />
          </div>
        );
      })}
    </div>
  );
}

/** Montaj karesi kenardan kenara renk alanıdır (zemin ile mürekkep arasında döner); kart içeriği ortada, büyük. */
function Montage({ g, p }: { g: MotionGrid; p: PartProps }) {
  const { box, colors, frame, enters, frames, heading, body, images } = p;
  let i = 0;
  while (i + 1 < g.cards.length && frame >= enters[i + 1]!) i++;
  const from = enters[i]!;
  const to = enters[i + 1] ?? frames;
  const k = clamp01((frame - from) / Math.max(1, to - from));
  const card = g.cards[i]!;
  const bg = i % 2 ? colors.fg : colors.bg;
  const fg = i % 2 ? colors.bg : colors.fg;
  const image = card.image !== undefined ? images[card.image] : undefined;
  // Başlık montaj boyunca üstte küçük, sabit bir etikettir (kendi tempo adımı yok, kartlar kesilir, o kalır); kart içeriği
  // altındaki alanda ortalanır. 23 Kas: başlık hiç çizilmiyordu, kare denetimi "Adım Adım Otomasyon yok" dedi.
  const label = g.title ? fitSize([g.title], p.scene.illustrative ? box.w * 0.76 : box.w, Math.min(box.h * 0.05, 44), heading.em) : 0;
  const top = g.title ? label * 1.8 : 0;
  const size = Math.round(Math.min((box.h - top) * 0.22, (box.w / Math.max(4, card.title.length)) * 1.7, p.height > p.width ? 170 : 210));
  return (
    <div data-montage={i} style={{ position: "absolute", inset: 0, background: bg, color: fg }}>
      {g.title && (
        <div data-title="" style={{ position: "absolute", left: box.x, top: box.y, width: p.scene.illustrative ? box.w * 0.76 : box.w, fontFamily: heading.family, fontWeight: heading.weight, fontSize: label, lineHeight: 1.2, opacity: 0.75, whiteSpace: "nowrap" }}>
          {g.title}
        </div>
      )}
      <div style={{ position: "absolute", left: box.x, top: box.y + top, width: box.w, height: box.h - top, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: size * 0.2, transform: `scale(${1.12 - 0.12 * k})` }}>
        {image && <Img data-image="" src={fileSrc(image)} style={{ maxWidth: "70%", maxHeight: "50%", objectFit: "contain", borderRadius: 16 }} />}
        {card.stat && <div style={{ fontFamily: heading.family, fontWeight: heading.weight, fontSize: fitSize([card.stat], box.w, size * 1.2, heading.em), lineHeight: 1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: colors.accent }}>{card.stat}</div>}
        <div style={{ fontFamily: heading.family, fontWeight: heading.weight, fontSize: size, lineHeight: 1.05, letterSpacing: "-0.02em" }}>{card.title}</div>
        {card.body && <div style={{ fontFamily: body.family, fontWeight: body.weight, fontSize: Math.round(size * 0.3), lineHeight: 1.3, opacity: 0.8 }}>{card.body}</div>}
      </div>
    </div>
  );
}

function Card({ card, p, w, h, bg }: { card: MotionGrid["cards"][number]; p: PartProps; w: number; h: number; bg: string }) {
  const { colors, heading, body, images } = p;
  // Kartın yazısı kart renginde en okunan uçtan.
  const fg = contrast(bg, colors.fg) >= contrast(bg, colors.bg) ? colors.fg : colors.bg;
  // Rakam vurgu rengindedir, kart renginde okunmuyorsa (4,5:1 altı) kartın yazı rengindedir: paletlerin çoğunda kart ile
  // vurgu arası 2-3:1 (23 Kas, 16:9 film m6: sarı kartta mavi "31-60 sn", 3,1:1, denetçi okunmaz dedi).
  const figure = contrast(bg, colors.accent) >= 4.5 ? colors.accent : fg;
  const image = card.image !== undefined ? images[card.image] : undefined;
  // Boylar kartın iç genişliğinden ve yazı yüzünün harf genişliğinden: başlık en çok iki satıra kayar, en uzun kelimesi
  // sığar; rakam tek satırdır. Eski oran dolguyu ve harf genişliğini saymıyordu, "31-60 sn" kartta "31-60 / sn" diye
  // ikiye bölünüyordu (23 Kas, 16:9 film m6).
  const pad = Math.round(Math.min(w, h) * 0.08);
  const inner = w - pad * 2;
  const title = fitWrapped([card.title], inner, h * 0.36, Math.round(Math.min(h * 0.16, 64)), heading.em, 1.1);
  const stat = card.stat ? fitSize([card.stat], inner, title * 1.5, heading.em) : 0;
  return (
    <div style={{ width: "100%", height: "100%", boxSizing: "border-box", padding: pad, borderRadius: Math.min(w, h) * 0.06, background: bg, color: fg, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: pad * 0.35, overflow: "hidden" }}>
      {image && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Img data-image="" src={fileSrc(image)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12 }} />
        </div>
      )}
      {card.stat && <div style={{ fontFamily: heading.family, fontWeight: heading.weight, fontSize: stat, lineHeight: 1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: figure }}>{card.stat}</div>}
      <div style={{ fontFamily: heading.family, fontWeight: heading.weight, fontSize: title, lineHeight: 1.1 }}>{card.title}</div>
      {card.body && <div style={{ fontFamily: body.family, fontWeight: body.weight, fontSize: Math.round(title * 0.55), lineHeight: 1.3, opacity: 0.8 }}>{card.body}</div>}
    </div>
  );
}
