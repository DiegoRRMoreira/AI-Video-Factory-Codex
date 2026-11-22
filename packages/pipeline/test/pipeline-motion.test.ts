import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MotionFilmOut } from "@ys/agents";
import { approve, isApproved, redrawShots, remakeFilm, type EpisodeInput, type EpisodeState } from "../src/index.ts";
import { callsOf, media, onAgent, render, resetFakes } from "./pipeline-fakes.ts";
import { harness, makeState } from "./pipeline-harness.ts";

vi.mock("@ys/agents", async (orig) => (await import("./pipeline-fakes.ts")).mockAgents(await orig()));
vi.mock("@ys/video/render", async () => (await import("./pipeline-fakes.ts")).renderModule());
vi.mock("../src/media.ts", async (orig) => {
  const f = await import("./pipeline-fakes.ts");
  return {
    ...(await orig<object>()),
    probeDurationMs: (...a: any[]) => f.media.probe(...a),
    normalizeClip: (...a: any[]) => f.media.normalize(...a),
    detectSilences: (...a: any[]) => f.media.silences(...a),
  };
});

const poster = vi.hoisted(() => ({ at: [] as number[], fail: false }));
vi.mock("../src/footage-media.ts", async (orig) => ({
  ...(await orig<object>()),
  posterFrame: async (_file: string, atMs: number) => {
    if (poster.fail) throw new Error("kare yok");
    poster.at.push(atMs);
    return new Uint8Array([5]);
  },
}));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 16];
const dir = mkdtempSync(join(tmpdir(), "ys-motion-test-"));
const file = (name: string, bytes: number[]) => {
  const path = join(dir, name);
  writeFileSync(path, new Uint8Array(bytes));
  return { name, path };
};

const input = (over: Partial<EpisodeInput> = {}, motion: Partial<NonNullable<EpisodeInput["motion"]>> = {}): EpisodeInput & { motion: NonNullable<EpisodeInput["motion"]> } => ({
  topic: "Relay deploys drop from 40 minutes to 12.",
  lang: "en",
  targetSec: 30,
  tier: "economy",
  aiClipRatio: 0,
  budgetUsd: 3,
  autoApprove: true,
  width: 1920,
  height: 1080,
  fps: 30,
  ...over,
  motion: { colors: ["#2563eb"], images: [], narration: false, ...motion },
});

const PALETTE = { ground: "#f3efe6", ink: "#141414", accent: "#ff4f1f", alt: "#1e2a3a" };
const FILM: MotionFilmOut = {
  title: "Relay",
  bpm: 120,
  route: "hybrid",
  palette: PALETTE,
  type: "clear",
  sections: [{ name: "hook", bars: 2, energy: 7 }, { name: "build", bars: 6, energy: 6 }],
  scenes: [
    { id: "m1", language: "kinetic", beats: 4, pace: "beat", transition: "flash", camera: "punch", ground: "ink", hit: "impact", kinetic: { lines: ["Ship faster."], mode: "slam" }, narration: "Ship faster with Relay." },
    { id: "m2", language: "data", beats: 8, pace: "beat", transition: "whip", camera: "still", ground: "ground", hit: "none", data: { chart: "bars", title: "Deploy time", points: [{ label: "Before", value: 40 }, { label: "After", value: 12 }], highlight: 1 }, narration: "From forty minutes to twelve." },
    { id: "m3", language: "object", beats: 8, pace: "beat", transition: "cut", camera: "pull", ground: "accent", hit: "none", object: { preset: "crystal", image: 0, caption: "Relay" }, narration: "" },
  ],
};
/** Kanca yok, iki ölçüden uzun boşluk: denetim yönetmene not gönderir. */
const QUIET: MotionFilmOut = { ...FILM, scenes: [{ id: "m1", language: "field", beats: 24, pace: "beat", transition: "cut", camera: "still", ground: "ink", hit: "none", field: { kind: "starfield" }, narration: "" }] };

beforeEach(() => {
  resetFakes();
  poster.at = [];
  poster.fail = false;
  media.probe.mockImplementation(async () => 2000);
  media.silences.mockImplementation(async () => []);
  onAgent("motionDirector", () => FILM);
  onAgent("packager", () => ({ title: "P", thumbnailText: "T", description: "D", chapters: [], tags: [], hashtags: [], short: { from: "m1", to: "m3", title: "S" } }));
});

describe("film bölümü oluşturma", () => {
  it("görseller içerik adresiyle eklenir, aynısı iki kez eklenmez; tür ve imza denetlenir, hata olursa eklenenler silinir", async () => {
    const h = harness();
    const state = await h.pipeline.createMotion(input(), [file("logo.png", PNG), file("again.png", PNG), file("shot.jpg", JPG)]);
    expect(state.input.motion!.images.map((i) => i.name)).toEqual(["logo.png", "shot.jpg"]);
    expect(state.input.motion!.images[0]!.key).toMatch(new RegExp(`^assets/motion/${state.id}/img/[0-9a-f]{24}\\.png$`));
    expect((await h.load(state.id)).input.motion!.colors).toEqual(["#2563eb"]);
    expect((await h.pipeline.createMotion(input())).input.motion!.images).toEqual([]);

    const bad = harness();
    await expect(bad.pipeline.createMotion(input(), [file("logo.png", PNG), file("anim.gif", [0x47, 0x49, 0x46])])).rejects.toThrow("Desteklenmeyen görsel: anim.gif");
    await expect(bad.pipeline.createMotion(input(), [file("fake.png", [1, 2, 3])])).rejects.toThrow("fake.png");
    expect(await bad.store.list("assets/motion/")).toEqual([]);
    expect(await bad.store.list("episodes/")).toEqual([]);
  });

  it("süre, renk ve görsel sayısı denetlenir", async () => {
    const h = harness();
    await expect(h.pipeline.createMotion(input({ targetSec: 5 }))).rejects.toThrow("10–180");
    await expect(h.pipeline.createMotion(input({ targetSec: 200 }))).rejects.toThrow("10–180");
    await expect(h.pipeline.createMotion(input({}, { colors: ["blue"] }))).rejects.toThrow("blue");
    await expect(h.pipeline.createMotion(input(), Array.from({ length: 13 }, (_, i) => file(`l${i}.png`, PNG)))).rejects.toThrow("12");
  });
});

describe("film hattı", () => {
  it("yönetmen → denetim → zamanlama → timeline (filmin müziği ve efekti) → render; konsept kapısı kendiliğinden geçer", async () => {
    const h = harness();
    const created = await h.pipeline.createMotion(input(), [file("logo.png", PNG)]);
    expect(isApproved(created, "concept")).toBe(true);
    const state = await h.pipeline.run(created.id);

    const call = callsOf("motionDirector")[0]!.args[0] as { images: { name: string; image: { mimeType: string } }[]; tall: boolean; narration: boolean; colors: string[] };
    expect(call).toMatchObject({ tall: false, narration: false, colors: ["#2563eb"] });
    expect(call.images.map((i) => [i.name, i.image.mimeType])).toEqual([["logo.png", "image/png"]]);
    // Anlatım kapalı: yönetmenin cümleleri atılır, ses üretilmez.
    expect(state.motionFilm!.scenes.every((s) => s.narration === "")).toBe(true);
    expect(h.gateway.requests.filter((r) => r.req.capability.startsWith("tts"))).toEqual([]);
    // Kurallar: ilk sahne sert kesme, vurgu kullanıcının rengi, brifteki sayılar temsili değil.
    expect(state.motionFilm!.scenes[0]!.transition).toBe("cut");
    expect(state.motionFilm!.palette.accent).toBe("#2563eb");
    expect(state.motionFilm!.scenes[1]!.illustrative).toBe(false);
    expect(state.story!.title).toBe("Relay");
    expect(state.script!.scenes.map((s) => s.id)).toEqual(["m1", "m2", "m3"]);
    expect(state.shots!.map((s) => [s.id, s.kind])).toEqual([
      ["m1", "motion_graphic"],
      ["m2", "motion_graphic"],
      ["m3", "motion_graphic"],
    ]);
    const t = state.timeline!;
    expect(t.motion!.images).toEqual([state.input.motion!.images[0]!.key]);
    expect(t.visuals.map((v) => v.film!.id)).toEqual(["m1", "m2", "m3"]);
    expect(t.audio.map((a) => a.role).sort()).toEqual(["music", "sfx"]);
    expect(h.logs.some((l) => l.includes("hook → build"))).toBe(true);
    // Render'dan önce sahne önizlemeleri (Çekimler sekmesi).
    expect(Object.keys(state.stills!)).toEqual(["m1", "m2", "m3"]);
    // Render görselleri render klasörüne indirir.
    const staged = render.episode.mock.calls[0]![0] as { publicDir: string };
    expect(await import("node:fs").then((fs) => fs.existsSync(join(staged.publicDir, ...state.input.motion!.images[0]!.key.split("/"))))).toBe(true);
    expect(state.done.render).toBeTruthy();
    // Kapak videonun kendi karesi: ilk kinetik sahnenin sonuna doğru.
    expect(poster.at).toEqual([Math.round(((t.visuals[0]!.durationInFrames * 0.85) / 30) * 1000)]);
    expect(state.render!.thumbnail).toMatch(/\.jpg$/);
    // Paket ve Short sahne zamanlarını timeline'dan alır (anlatımsız filmde ses süresi yok).
    const sceneSec = (callsOf("packager")[0]!.args[0] as { sceneSec: Record<string, number> }).sceneSec;
    expect(sceneSec.m1).toBeCloseTo(t.visuals[0]!.durationInFrames / 30);
    expect(state.short).toBeDefined();
  });

  it("denetim notu varsa yönetmen bir kez düzeltir; düzeltme düşerse ilk film kalır", async () => {
    const h = harness();
    let n = 0;
    onAgent("motionDirector", () => (n++ ? FILM : QUIET));
    const a = await h.pipeline.createMotion(input());
    const fixed = await h.pipeline.run(a.id, { until: "script" });
    expect(callsOf("motionDirector")).toHaveLength(2);
    const revise = (callsOf("motionDirector")[1]!.args[0] as { revise: { notes: string[] } }).revise;
    expect(revise.notes.some((x) => x.includes("hook"))).toBe(true);
    expect(fixed.motionFilm!.scenes).toHaveLength(3);

    const h2 = harness();
    let m = 0;
    onAgent("motionDirector", () => {
      if (m++) throw new Error("ajan düştü");
      return QUIET;
    });
    const b = await h2.pipeline.createMotion(input());
    const kept = await h2.pipeline.run(b.id, { until: "script" });
    expect(kept.motionFilm!.scenes[0]!.language).toBe("field");
    expect(kept.motionLint!.map((i) => i.kind)).toContain("hook");
    expect(h2.logs.some((l) => l.includes("ajan düştü"))).toBe(true);
  });

  it("anlatım açıkken sahneler sesin süresine vuruşla uzar, altyazı gelir; dikey filmde yönetmen dikey yazar", async () => {
    const h = harness();
    media.probe.mockImplementation(async () => 6000);
    const a = await h.pipeline.createMotion(input({ width: 1080, height: 1920 }, { narration: true }));
    const state = await h.pipeline.run(a.id, { until: "timeline" });
    expect((callsOf("motionDirector")[0]!.args[0] as { tall: boolean }).tall).toBe(true);
    expect(Object.keys(state.voice!)).toEqual(["m1", "m2"]);
    expect(state.motionTimed!.scenes[0]!.beats).toBeGreaterThanOrEqual(13);
    expect(state.timeline!.captions.length).toBeGreaterThan(0);
    expect(state.timeline!.audio.filter((a) => a.role === "voice")).toHaveLength(2);
  });

  it("yapımcının notuyla yeniden yazılır; kullanılabilir sahne kalmazsa çevrilebilir hata", async () => {
    const h = harness();
    const a = await h.pipeline.createMotion(input(), [], );
    const first = await h.pipeline.run(a.id, { until: "script" });
    await h.seed(Object.assign(first, {}));
    const loaded = await h.load(a.id);
    remakeFilm(loaded, "  daha hızlı açılış  ");
    expect(loaded.motionNote).toBe("daha hızlı açılış");
    await h.seed(loaded);
    const again = await h.pipeline.run(a.id, { until: "script" });
    const call = callsOf("motionDirector").at(-1)!.args[0] as { revise: { notes: string[]; film: { title: string } } };
    expect(call.revise.notes).toEqual(["producer's note: daha hızlı açılış"]);
    expect(again.motionNote).toBeUndefined();

    const empty = harness();
    onAgent("motionDirector", () => ({ ...FILM, scenes: [{ ...FILM.scenes[0]!, kinetic: undefined }] }));
    const b = await empty.pipeline.createMotion(input());
    await expect(empty.pipeline.run(b.id, { until: "script" })).rejects.toThrow("kullanılabilir sahne");
  });

  it("Stüdyo'dan yüklenen görseller ilk aşamada alınır; eksik dosya ve eksik film hatadır", async () => {
    const h = harness();
    h.store.map.set("uploads/footage/aaaaaaaaaaaaaaaaaaaaaaaa.png", new Uint8Array(PNG));
    h.store.map.set("uploads/footage/bbbbbbbbbbbbbbbbbbbbbbbb.jpg", new Uint8Array(JPG));
    const state = makeState({ ...input(), motion: { colors: [], images: [], narration: false, pending: [{ key: "uploads/footage/aaaaaaaaaaaaaaaaaaaaaaaa.png", name: "logo.png" }, { key: "uploads/footage/bbbbbbbbbbbbbbbbbbbbbbbb.jpg", name: "shot.png" }] } });
    const id = await h.seed(state);
    const done = await h.pipeline.run(id, { only: "story" });
    expect(done.input.motion!.pending).toBeUndefined();
    expect(done.input.motion!.images.map((i) => i.name)).toEqual(["logo.png", "shot.png.jpg"]);
    expect(await h.store.list("uploads/")).toEqual([]);

    const missing = harness();
    const id2 = await missing.seed(makeState({ ...input(), motion: { colors: [], images: [], narration: false, pending: [{ key: "uploads/footage/cccccccccccccccccccccccc.png", name: "x.png" }] } }));
    await expect(missing.pipeline.run(id2, { only: "story" })).rejects.toThrow("uploads/footage/cccccccccccccccccccccccc.png");

    const gone = harness();
    const id3 = await gone.seed(makeState({ ...input(), motion: { colors: [], images: [{ key: "assets/motion/x/img/gone.png", name: "gone.png" }], narration: false } }));
    await expect(gone.pipeline.run(id3, { only: "script" })).rejects.toThrow("assets/motion/x/img/gone.png");

    const noFilm = harness();
    const id4 = await noFilm.seed(makeState(input()));
    await expect(noFilm.pipeline.run(id4, { only: "shots" })).rejects.toThrow("motionFilm");
    await expect(noFilm.pipeline.run(id4, { only: "timeline" })).rejects.toThrow("motionFilm");
  });

  it("önizleme kareleri çıkarılamazsa günlüğe yazılır, timeline yine kurulur", async () => {
    const h = harness();
    render.stills.mockRejectedValueOnce(new Error("chrome yok"));
    const a = await h.pipeline.createMotion(input());
    const state = await h.pipeline.run(a.id, { until: "timeline" });
    expect(state.timeline!.visuals).toHaveLength(3);
    expect(state.stills).toBeUndefined();
    expect(h.logs.some((l) => l.includes("chrome yok"))).toBe(true);
  });

  it("zamanlanmamış film de timeline olur; efekt ve müzik kapatılabilir", async () => {
    const h = harness();
    const a = await h.pipeline.createMotion(input({ sfx: false, music: false }));
    const scripted = await h.pipeline.run(a.id, { until: "script" });
    const state: EpisodeState = { ...scripted };
    delete state.motionTimed;
    await h.seed(state);
    // Sesi olmayan film de zamanlanır (anlatım kapalı).
    delete state.voice;
    await h.seed(state);
    expect((await h.pipeline.run(a.id, { only: "shots" })).motionTimed!.scenes).toHaveLength(3);
    const untimed = await h.load(a.id);
    delete untimed.motionTimed;
    await h.seed(untimed);
    const done = await h.pipeline.run(a.id, { only: "timeline" });
    expect(done.timeline!.visuals).toHaveLength(3);
    expect(done.timeline!.audio).toEqual([]);
  });
});

describe("film eylemleri", () => {
  it("film sahneleri yeniden çizilmez; notla yeniden yazma kuralları", () => {
    const s = makeState(input(), { shots: [] });
    expect(() => redrawShots(s, ["m1"])).toThrow("koddan çizilir");
    expect(() => remakeFilm(s, "x")).toThrow();
    const withFilm = makeState(input(), { motionFilm: { ...FILM, scenes: [] } as never, voice: {}, timeline: {} as never, lastError: "x" as never, motionTimed: {} as never });
    expect(() => remakeFilm(withFilm, "   ")).toThrow();
    remakeFilm(withFilm, "x".repeat(700));
    expect(withFilm.motionNote).toHaveLength(600);
    expect([withFilm.voice, withFilm.timeline, withFilm.motionTimed, withFilm.lastError]).toEqual([undefined, undefined, undefined, undefined]);
    withFilm.script = { scenes: [] };
    approve(withFilm, "script");
    expect(() => remakeFilm(withFilm, "y")).toThrow();
  });
});
