// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { Timeline, type MotionLook, type MotionScene } from "@ys/core";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bars, count, diagram, field, grid, kinetic, line, object, PALETTE, sc } from "./film-fixture.ts";

// Remotion bağlamı yerine kare ve video ayarı testten; WebGL bileşenleri (Pixi, Three) kayıt tutan sahte.
const clock = vi.hoisted(() => ({ frame: 0, fps: 30, width: 1920, height: 1080 }));
vi.mock("remotion", async (orig) => ({
  ...(await orig<typeof import("remotion")>()),
  useCurrentFrame: () => clock.frame,
  useVideoConfig: () => ({ fps: clock.fps, width: clock.width, height: clock.height, durationInFrames: 300 }),
  staticFile: (p: string) => `/public/${p}`,
  Img: (p: { src: string }) => <img data-image="" src={p.src} />,
  OffthreadVideo: (p: { src: string }) => <video src={p.src} />,
  Sequence: (p: { children: ReactNode; name: string }) => <section data-name={p.name}>{p.children}</section>,
  Audio: () => null,
}));
const gl = vi.hoisted(() => ({ particles: [] as Record<string, unknown>[], three: [] as Record<string, unknown>[] }));
vi.mock("../src/PixiParticles.tsx", () => ({ PixiParticles: (p: Record<string, unknown>) => (gl.particles.push(p), <canvas data-pixi={String(p.kind)} />) }));
vi.mock("../src/Scene3D.tsx", () => ({ Scene3D: (p: { spec: Record<string, unknown> }) => (gl.three.push(p.spec), <canvas data-three={String(p.spec.preset)} />) }));

const { FilmScene, ILLUSTRATIVE } = await import("../src/motion-film/Film.tsx");
const { markedWords } = await import("../src/motion-film/Kinetic.tsx");
const { halves, layoutNodes } = await import("../src/motion-film/Diagram.tsx");
const { gridShape } = await import("../src/motion-film/Grid.tsx");
const { fileSrc } = await import("../src/motion-film/context.ts");
const { Episode } = await import("../src/Episode.tsx");
const { chunkKeys } = await import("../src/chunks.ts");

const LOOK: MotionLook = { bpm: 120, palette: PALETTE, type: "clear", images: ["assets/motion/e/img/logo.png", "https://example.com/shot.png"], sections: [] };

afterEach(() => {
  cleanup();
  clock.frame = 0;
  clock.width = 1920;
  clock.height = 1080;
  gl.particles.length = 0;
  gl.three.length = 0;
});

const draw = (scene: MotionScene, frame: number, opts: { lang?: string; captions?: boolean; look?: MotionLook; frames?: number } = {}) => {
  clock.frame = frame;
  return render(<FilmScene scene={scene} look={opts.look ?? LOOK} frames={opts.frames ?? 240} lang={opts.lang ?? "en"} captions={opts.captions ?? false} />).container;
};

describe("film sahnesi çerçevesi", () => {
  it("zemin rengi, kamera ve slam inişinin sarsıntısı", () => {
    const c = draw(kinetic("slam", { camera: "punch", ground: "ink" }), 6);
    const root = c.querySelector("[data-film]") as HTMLElement;
    expect(root.style.background).toBe(PALETTE.ink);
    // İlk satır 6. karede iner (giriş 10 karenin %60'ı): sahne genişliğin %0,55'i kadar kayar.
    expect((root.firstElementChild as HTMLElement).style.transform).toContain("translateX(0.550%)");
    expect(draw(kinetic("rise"), 6).querySelector("[data-film] > div")!.getAttribute("style")).toContain("translateX(0.000%)");
  });

  it("giriş örtüleri: parlama, taşma (vurgu zemininde mürekkep renginde), renk dönüşü; süreleri bitince yok", () => {
    expect(draw(object({ transition: "flash" }), 0).querySelector('[data-entry="flash"]')).not.toBeNull();
    expect(draw(object({ transition: "flash" }), 20).querySelector("[data-entry]")).toBeNull();
    const flood = draw(object({ transition: "flood" }), 2).querySelector('[data-entry="flood"]') as HTMLElement;
    expect(flood.style.background).toBe(PALETTE.accent);
    const onAccent = draw(object({ transition: "flood", ground: "accent" }), 2).querySelector('[data-entry="flood"]') as HTMLElement;
    expect(onAccent.style.background).not.toBe(PALETTE.accent);
    expect(draw(object({ transition: "flood" }), 30).querySelector("[data-entry]")).toBeNull();
    expect((draw(object({ transition: "flip" }), 1).querySelector('[data-entry="flip"]') as HTMLElement).style.background).toBe(PALETTE.alt);
    expect(draw(object({ transition: "flip" }), 30).querySelector("[data-entry]")).toBeNull();
    expect(draw(object({ transition: "whip" }), 0).querySelector("[data-entry]")).toBeNull();
  });

  it("temsili veri rozeti dilde; bilinmeyen dilde İngilizce", () => {
    expect(draw(bars({ illustrative: true }), 100, { lang: "tr" }).querySelector("[data-badge]")!.textContent).toBe(ILLUSTRATIVE.tr);
    expect(draw(bars({ illustrative: true }), 100, { lang: "ja" }).querySelector("[data-badge]")!.textContent).toBe(ILLUSTRATIVE.en);
    expect(draw(bars(), 100).querySelector("[data-badge]")).toBeNull();
  });

  it("görsel yolu: yerel dosya public/ altından, adres olduğu gibi", () => {
    expect(fileSrc("a/b.png")).toBe("/public/a/b.png");
    expect(fileSrc("https://x.y/z.png")).toBe("https://x.y/z.png");
  });
});

describe("kinetik yazı", () => {
  it("slam ve rise: satırlar ve vurgu hapı (oturduktan sonra yazı rengi döner)", () => {
    const c = draw(kinetic("slam"), 120);
    expect([...c.querySelectorAll("[data-slam]")].map((e) => e.textContent)).toEqual(["Ship faster now", "40 minutes"]);
    const pill = c.querySelector("[data-pill]") as HTMLElement;
    expect(pill.textContent).toBe("40 minutes");
    expect(pill.style.color).not.toBe("");
    expect((draw(kinetic("slam"), 0).querySelector("[data-pill]") as HTMLElement).style.color).toBe("");
    expect(draw(kinetic("rise", { kinetic: { lines: ["Plain"], mode: "rise" } }), 60).querySelector("[data-pill]")).toBeNull();
    expect(draw(kinetic("rise"), 60).querySelectorAll("[data-line]").length).toBe(2);
  });

  it("kelime kelime: vurgu ifadesi birkaç kelimeye yayılır; dikeyde sola yaslı", () => {
    clock.width = 1080;
    clock.height = 1920;
    const c = draw(kinetic("words"), 200);
    expect(c.querySelectorAll("[data-word]").length).toBe(5);
    expect([...c.querySelectorAll("[data-pill]")].map((e) => e.textContent)).toEqual(["40", "minutes"]);
    expect(markedWords("a b c", "b c")).toEqual([false, true, true]);
    expect(markedWords("a b", "zz")).toEqual([false, false]);
    expect(markedWords("a b")).toEqual([false, false]);
  });

  it("bölüm kartı: sayaç ve toplam, bölüm bilgisi yoksa 01/01", () => {
    const c = draw(kinetic("chapter"), 100);
    expect(c.querySelector("[data-chapter]")!.textContent).toBe("02/05");
    const bare = draw(sc({ language: "kinetic", kinetic: { lines: ["Intro"], mode: "chapter" } }), 100);
    expect(bare.querySelector("[data-chapter]")!.textContent).toBe("01/01");
    const indexOnly = draw(sc({ language: "kinetic", kinetic: { lines: ["Intro"], mode: "chapter", chapter: { index: 3, total: 3 } } }), 100);
    expect(indexOnly.querySelector("[data-chapter]")!.textContent).toBe("03/03");
  });
});

describe("veri hikayesi", () => {
  it("çubuklar sıfırdan büyür, değer çubukla sayar; vurgu, not ve kaynak", () => {
    const before = draw(bars(), 0);
    expect(before.querySelectorAll("[data-bar]").length).toBe(3);
    expect(before.querySelector("[data-callout]")).toBeNull();
    const after = draw(bars({ illustrative: true }), 200, { lang: "en" });
    expect(after.textContent).toContain("12.5 min");
    expect(after.textContent).toContain("-5.0 min");
    expect(after.querySelector("[data-callout]")!.textContent).toBe("Cache");
    expect(after.querySelector("[data-source]")!.textContent).toBe("Internal");
    // Vurgusuz grafikte bütün çubuklar tam renkte.
    const plain = draw(bars({ data: { chart: "bars", title: "t", points: [{ label: "a", value: 1 }, { label: "b", value: 2 }] } }), 200);
    expect(plain.textContent).toContain("2");
    expect(plain.querySelector("[data-source]")).toBeNull();
  });

  it("çizgi noktadan noktaya çizilir; vurgulanan nokta halka taşır, değeri yazılır; simge birim bitişik", () => {
    expect(draw(line(), 0).querySelector("[data-path]")).toBeNull();
    const mid = draw(line(), 42);
    expect(mid.querySelector("[data-path]")!.getAttribute("points")!.split(" ").length).toBe(3);
    const end = draw(line(), 200);
    expect(end.querySelectorAll("[data-dot]").length).toBe(3);
    expect(end.querySelector('[data-dot="2"] circle')!.getAttribute("stroke")).toBe(PALETTE.accent);
    expect(end.textContent).toContain("22%");
    expect(draw(line({ data: { chart: "line", title: "t", points: [{ label: "a", value: 3 }, { label: "b", value: 3 }] } }), 200).querySelectorAll("[data-dot]").length).toBe(2);
  });

  it("sayaç sayarak oturur (son anda hafif büyüme), not sayının altına iner", () => {
    expect((draw(count(), 0).querySelector("[data-count]") as HTMLElement).style.opacity).toBe("0");
    const landing = draw(count(), 15 + 27) .querySelector("[data-count]") as HTMLElement;
    expect(landing.textContent).toBe("70%");
    expect(landing.style.transform).not.toBe("scale(1)");
    expect((draw(count(), 200).querySelector("[data-count]") as HTMLElement).style.transform).toBe("scale(1)");
    const noted = draw(count({ data: { chart: "count", title: "t", unit: "x", callout: "Wow", count: { to: 2.5, decimals: 1, prefix: "~" } } }), 200);
    expect(noted.textContent).toContain("~2.5x");
    expect(noted.querySelector("[data-callout]")!.textContent).toBe("Wow");
  });
});

describe("sistem diyagramı", () => {
  it("düğümler, çizilerek açılan bağlar, ok ucu, etiket ve akan paketler; vurgulanan düğüm yanar", () => {
    const c = draw(diagram(), 239);
    expect(c.querySelectorAll("[data-node]").length).toBe(3);
    expect(c.querySelectorAll("[data-edge]").length).toBe(2);
    expect(c.querySelectorAll("polygon").length).toBe(2);
    expect(c.querySelector("text")!.textContent).toBe("push");
    expect(c.querySelectorAll("[data-packet]").length).toBe(2);
    expect((c.querySelector('[data-node="c"]') as HTMLElement).style.background).toBe(PALETTE.accent);
    expect(c.querySelector("[data-title]")!.textContent).toBe("Flow");
    // Bağ henüz girmemiş; paket yok.
    const early = draw(diagram({ diagram: { ...diagram().diagram!, packets: false, title: undefined } }), 0);
    expect(early.querySelectorAll("[data-edge]").length).toBe(0);
    expect(early.querySelector("[data-title]")).toBeNull();
    expect(draw(diagram({ diagram: { ...diagram().diagram!, packets: false } }), 239).querySelectorAll("[data-packet]").length).toBe(0);
  });

  it("dikey ve yatay bağlar; dikey videoda ızgara döner; etiket kelime sınırından ikiye", () => {
    clock.width = 1080;
    clock.height = 1920;
    const straight = diagram({
      diagram: { nodes: [{ id: "a", label: "A", col: 0, row: 0 }, { id: "b", label: "B", col: 0, row: 1 }, { id: "c", label: "C", col: 1, row: 1 }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] },
    });
    expect(draw(straight, 239).querySelectorAll("[data-edge] line").length).toBe(2);
    const area = { x: 0, y: 0, w: 400, h: 400 };
    expect(layoutNodes(straight.diagram!, area, true).at.get("b")).toEqual({ x: 300, y: 100 });
    expect(layoutNodes(straight.diagram!, area, false).at.get("b")).toEqual({ x: 100, y: 300 });
    expect(halves("Kurgu ve Render")).toBe("Kurgu ve");
    expect(halves("Deploy")).toBe("Deploy");
  });
});

describe("kart ızgarası ve montaj", () => {
  it("ızgara şekli (dikeyde döner)", () => {
    expect([1, 3, 4, 5, 7].map((n) => gridShape(n, false))).toEqual([{ cols: 1, rows: 1 }, { cols: 3, rows: 1 }, { cols: 2, rows: 2 }, { cols: 3, rows: 2 }, { cols: 3, rows: 3 }]);
    expect(gridShape(3, true)).toEqual({ cols: 1, rows: 3 });
  });

  it("kartlar ızgaraya oturur: başlık, görsel, rakam, gövde", () => {
    const c = draw(grid("grid", { illustrative: true }), 200);
    expect(c.querySelectorAll("[data-card]").length).toBe(3);
    expect(c.querySelector("[data-title]")!.textContent).toBe("All in one");
    expect(c.querySelector("[data-image]")!.getAttribute("src")).toBe("/public/assets/motion/e/img/logo.png");
    expect(c.textContent).toContain("Every build");
    const untitled = draw(grid("grid", { grid: { mode: "grid", cards: [{ title: "x", image: 1 }] } }), 200);
    expect(untitled.querySelector("[data-title]")).toBeNull();
    expect(untitled.querySelector("[data-image]")!.getAttribute("src")).toBe("https://example.com/shot.png");
    expect(draw(grid("grid", { grid: { mode: "grid", cards: [{ title: "x", image: 9 }] } }), 200).querySelector("[data-image]")).toBeNull();
  });

  it("montajda her tempo adımında tek kart kareyi doldurur, zemin ile mürekkep arasında döner", () => {
    const first = draw(grid("montage"), 0).querySelector("[data-montage]") as HTMLElement;
    expect(first.getAttribute("data-montage")).toBe("0");
    expect(first.querySelector("[data-image]")).not.toBeNull();
    const second = draw(grid("montage"), 16).querySelector("[data-montage]") as HTMLElement;
    expect(second.getAttribute("data-montage")).toBe("1");
    expect(second.style.background).toBe(PALETTE.ink);
    expect(second.textContent).toContain("Every build");
    expect(draw(grid("montage"), 239).querySelector("[data-montage]")!.getAttribute("data-montage")).toBe("2");
    expect(draw(grid("montage", { grid: { mode: "montage", cards: [{ title: "x", image: 7 }] } }), 0).querySelector("[data-image]")).toBeNull();
  });
});

describe("alan ve 3D nesne", () => {
  it("parçacık alanı vurgu renginde, başlık ve alt yazı; yazısız alan yalnız parçacık", () => {
    const c = draw(field(), 100);
    expect(gl.particles[0]).toMatchObject({ kind: "starfield", tint: 0xff4f1f, size: [1920, 1080] });
    expect([...c.querySelectorAll("[data-rise]")].map((e) => e.textContent)).toEqual(["Build once", "Ship everywhere"]);
    expect(draw(field({ field: { kind: "sparks" } }), 100).querySelectorAll("[data-rise]").length).toBe(0);
    expect([...draw(field({ field: { kind: "sparks", subtitle: "Only sub" } }), 100).querySelectorAll("[data-rise]")].map((e) => e.textContent)).toEqual(["Only sub"]);
  });

  it("3D nesne ortada; görsel (logo) başlık yerine, not ikinci sırada", () => {
    const c = draw(object(), 100);
    expect(gl.three[0]).toMatchObject({ preset: "crystal", camera: "push_in" });
    expect(c.querySelector("[data-image]")).toBeNull();
    const logo = draw(object({ object: { preset: "atom", image: 0, caption: "Ship" } }), 100);
    expect(logo.querySelector("[data-image]")).not.toBeNull();
    expect([...logo.querySelectorAll("[data-rise]")].map((e) => e.textContent)).toEqual(["Ship"]);
    expect(draw(object({ object: { preset: "atom", image: 5 } }), 100).querySelector("[data-image]")).toBeNull();
  });
});

describe("bölüm kompozisyonu ve önbellek", () => {
  const timeline = (motion?: MotionLook) =>
    Timeline.parse({
      episodeId: "e",
      lang: "en",
      durationInFrames: 120,
      visuals: [{ shotId: "m1", assetUrl: "", kind: "motion_graphic", fromFrame: 0, durationInFrames: 120, film: kinetic("slam") }],
      audio: [],
      ...(motion ? { motion, typography: { pair: "clear" } } : {}),
    });

  it("film sahnesi görünümle çizilir; görünüm yoksa düz klibe düşer", () => {
    clock.frame = 30;
    expect(render(<Episode timeline={timeline(LOOK)} />).container.querySelector("[data-film]")).not.toBeNull();
    cleanup();
    expect(render(<Episode timeline={timeline()} />).container.querySelector("[data-film]")).toBeNull();
  });

  it("önbellek anahtarı filmin görünümüne ve görsellerine bağlı; filmsiz bölümün anahtarı değişmez", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "film-chunks-"));
    mkdirSync(join(dir, "assets/motion/e/img"), { recursive: true });
    writeFileSync(join(dir, "assets/motion/e/img/logo.png"), "a");
    const look = { ...LOOK, images: ["assets/motion/e/img/logo.png"] };
    const ranges = [{ from: 0, to: 120, shots: ["m1"] }];
    const a = await chunkKeys(timeline(look), ranges, dir, "c");
    const b = await chunkKeys(timeline({ ...look, bpm: 100 }), ranges, dir, "c");
    writeFileSync(join(dir, "assets/motion/e/img/logo.png"), "b");
    const c = await chunkKeys(timeline(look), ranges, dir, "c");
    expect(new Set([a[0], b[0], c[0]]).size).toBe(3);
    const plain = await chunkKeys(timeline(), ranges, dir, "c");
    expect(plain[0]).not.toBe(a[0]);
  });
});

describe("kalan dallar", () => {
  it("dikey kare: veri, bölüm kartı, montaj ve alan başlığı küçülür; yatayda kelimeler ortalı", () => {
    clock.width = 1080;
    clock.height = 1920;
    expect(draw(bars(), 200).querySelector("[data-title]")).not.toBeNull();
    expect(draw(kinetic("chapter"), 100).querySelector("[data-chapter]")).not.toBeNull();
    expect(draw(grid("montage"), 0).querySelector("[data-montage]")).not.toBeNull();
    expect(draw(field(), 100).querySelectorAll("[data-rise]").length).toBe(2);
    expect(draw(field({ field: { kind: "sparks", subtitle: "Only" } }), 100).querySelectorAll("[data-rise]").length).toBe(1);
    clock.width = 1920;
    clock.height = 1080;
    expect(draw(kinetic("words"), 200).querySelectorAll("[data-word]").length).toBe(5);
  });

  it("hepsi sıfır olan grafik, vurgusuz not, başlıklı ama temsili olmayan ızgara, koyu zeminde kart yazısı", () => {
    expect(draw(bars({ data: { chart: "bars", title: "t", points: [{ label: "a", value: 0 }, { label: "b", value: 0 }] } }), 200).querySelectorAll("[data-bar]").length).toBe(2);
    expect(draw(line({ data: { chart: "line", title: "t", callout: "Here", points: [{ label: "a", value: 1 }, { label: "b", value: 2 }] } }), 200).querySelector("[data-callout]")!.textContent).toBe("Here");
    expect(draw(grid("grid"), 200).querySelector("[data-title]")).not.toBeNull();
    expect(draw(grid("grid", { ground: "ink" }), 200).querySelectorAll("[data-card]").length).toBe(3);
  });

  it("bağ girdi ama henüz çizilmedi: paket yok; ikiye bölmede kısa yarım kazanmaz", () => {
    // Bağ 0: 30. karede girer, 0,5 sn'de çizilir.
    const c = draw(diagram(), 31);
    expect(c.querySelectorAll("[data-edge]").length).toBe(1);
    expect(c.querySelectorAll("[data-packet]").length).toBe(0);
    expect(halves("aaaa b c")).toBe("aaaa");
  });
});
