import type { MotionDiagram } from "@ys/core";

/** Giriş sırası: her düğümün ardından iki ucu artık görünen bağlar (edgeKey: düğüm kimliğine karışmaz); uçları bilinmeyen bağ sıraya girmez. */
/** Bağın sıra anahtarı: iki nokta düğüm kimliklerinde yok, çakışmaz. */
export const edgeKey = (i: number) => `edge:${i}`;

export function diagramOrder(g: MotionDiagram): string[] {
  const seen = new Set<string>();
  const done = new Set<number>();
  const out: string[] = [];
  for (const n of g.nodes) {
    out.push(n.id);
    seen.add(n.id);
    g.edges.forEach((e, i) => {
      if (!done.has(i) && seen.has(e.from) && seen.has(e.to)) {
        done.add(i);
        out.push(edgeKey(i));
      }
    });
  }
  return out;
}
