import type { ReactNode } from "react";
import { fitSize, type PartProps } from "./context.ts";
import { enterK, expoOut, FILM, wordsOf } from "./timing.ts";

/**
 * Kinetik tipografi (iddia): slam (satır 1,6'dan sertçe iner, headline-slam), rise (satır maskenin altından yükselir),
 * words (kelime kelime, her biri bir tempo adımında), chapter (büyük sayaç + etiket). Vurgu sözcüğü satırı oturduktan
 * sonra vurgu renginde bir hapın içine alınır (hap soldan açılır).
 */
export function Kinetic(p: PartProps) {
  const k = p.scene.kinetic!;
  const { box, colors, heading, frame, fps, enters } = p;
  const tall = p.height > p.width;
  const size = fitSize(k.lines, box.w, tall ? 170 : 220, heading.em);
  const font = { fontFamily: heading.family, fontWeight: heading.weight, fontSize: size, lineHeight: 1.08, letterSpacing: "-0.02em" };

  if (k.mode === "chapter") {
    const index = String(k.chapter?.index ?? 1).padStart(2, "0");
    const total = String(k.chapter?.total ?? k.chapter?.index ?? 1).padStart(2, "0");
    const q = enterK(frame, enters[0]!, fps);
    // Bölüm kartı: etiket satırları kutuya sığar, sayaç onun 2,6 katı (kutuyu aşmadan).
    const lineSize = fitSize(k.lines, box.w, tall ? 110 : 130, heading.em);
    const counter = Math.min(lineSize * 2.6, box.w * 0.42);
    return (
      <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", flexDirection: "column", justifyContent: "center", color: colors.fg }}>
        <div data-chapter="" style={{ overflow: "hidden", fontFamily: heading.family, fontWeight: heading.weight, fontSize: counter, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ display: "inline-block", transform: `translateY(${(1 - q) * 100}%)` }}>{index}</span>
          <span style={{ fontSize: counter * 0.28, opacity: 0.45, marginLeft: counter * 0.1 }}>/{total}</span>
        </div>
        {k.lines.map((line, i) => (
          <Line key={i} text={line} highlight={k.highlight} q={enterK(frame, enters[i + 1]!, fps)} pill={pillK(frame, enters[i + 1]!, fps)} colors={colors} style={{ ...font, fontSize: lineSize }} />
        ))}
      </div>
    );
  }

  let n = 0;
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: tall ? "flex-start" : "center", textAlign: tall ? "left" : "center", color: colors.fg }}>
      {k.lines.map((line, i) => {
        if (k.mode === "words") {
          const marks = markedWords(line, k.highlight);
          const words = wordsOf(line).map((w, j) => ({ w, at: enters[n++]!, hot: marks[j]! }));
          const done = words.at(-1)!.at;
          return (
            <div key={i} style={{ ...font, display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.26}px`, justifyContent: tall ? "flex-start" : "center" }}>
              {words.map(({ w, at, hot }, j) => {
                const q = enterK(frame, at, fps);
                return (
                  <span key={j} data-word="" style={{ display: "inline-block", opacity: q, transform: `translateY(${(1 - q) * 0.25 * size}px) scale(${0.86 + 0.14 * q})` }}>
                    <Marked text={w} highlight={hot ? w : undefined} pill={pillK(frame, done, fps)} colors={colors} />
                  </span>
                );
              })}
            </div>
          );
        }
        const at = enters[i]!;
        const q = enterK(frame, at, fps);
        if (k.mode === "rise") return <Line key={i} text={line} highlight={k.highlight} q={q} pill={pillK(frame, at, fps)} colors={colors} style={font} />;
        // slam: büyükten iner, opaklık hızla gelir.
        const s = FILM.slamFrom - (FILM.slamFrom - 1) * q;
        return (
          <div key={i} data-slam="" style={{ ...font, opacity: Math.min(1, q * 3), transform: `scale(${s})`, transformOrigin: "50% 60%" }}>
            <Marked text={line} highlight={k.highlight} pill={pillK(frame, at, fps)} colors={colors} />
          </div>
        );
      })}
    </div>
  );
}

/** Satırın kelimelerinden vurgu ifadesinin içine düşenler (kelime kipinde ifade birkaç kelimeye yayılabilir). */
export function markedWords(line: string, highlight?: string): boolean[] {
  const words = wordsOf(line);
  const i = highlight ? line.toLocaleLowerCase().indexOf(highlight.toLocaleLowerCase()) : -1;
  if (i < 0) return words.map(() => false);
  const end = i + highlight!.length;
  let at = 0;
  return words.map((w) => {
    const from = line.indexOf(w, at);
    at = from + w.length;
    return from < end && at > i;
  });
}

/** Hap, satır oturduktan sonra açılır (girişten 1,5 giriş süresi sonra, yarım saniyede). */
const pillK = (frame: number, at: number, fps: number) => expoOut((frame - at - FILM.enterSec * fps * 1.5) / (0.4 * fps));

/** Maskenin altından yükselen satır. */
function Line({ text, highlight, q, pill, colors, style }: { text: string; highlight?: string; q: number; pill: number; colors: PartProps["colors"]; style: Record<string, string | number> }) {
  return (
    <div data-line="" style={{ ...style, overflow: "hidden", paddingBottom: "0.08em" }}>
      <div style={{ transform: `translateY(${(1 - q) * 110}%)` }}>
        <Marked text={text} highlight={highlight} pill={pill} colors={colors} />
      </div>
    </div>
  );
}

/** Metnin içindeki vurgu sözcüğünü hapa alır (büyük/küçük harf duyarsız; yoksa metin olduğu gibi). */
export function Marked({ text, highlight, pill, colors }: { text: string; highlight?: string; pill: number; colors: PartProps["colors"] }): ReactNode {
  const i = highlight ? text.toLocaleLowerCase().indexOf(highlight.toLocaleLowerCase()) : -1;
  if (i < 0) return text;
  const mark = text.slice(i, i + highlight!.length);
  return (
    <>
      {text.slice(0, i)}
      <span data-pill="" style={{ position: "relative", display: "inline-block", isolation: "isolate", color: pill > 0.5 ? colors.onAccent : undefined }}>
        <span style={{ position: "absolute", inset: "0.06em -0.2em -0.02em", borderRadius: "0.18em", background: colors.accent, transform: `scaleX(${pill})`, transformOrigin: "0 50%", zIndex: -1 }} />
        {mark}
      </span>
      {text.slice(i + highlight!.length)}
    </>
  );
}
