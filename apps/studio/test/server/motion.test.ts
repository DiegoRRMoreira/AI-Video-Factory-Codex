import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeInput, EpisodeState } from "@ys/pipeline/light";
import { lastChild, registry, resetStudio, spawn } from "./fakes.ts";

vi.mock("server-only", () => ({}));
vi.mock("node:child_process", async (orig) => ({ ...(await orig<object>()), spawn: (await import("./fakes.ts")).spawn }));
vi.mock("@ys/media-gateway", async (orig) => ({
  ...(await orig<object>()),
  createProvidersFromEnv: (await import("./fakes.ts")).createProvidersFromEnv,
}));

await vi.hoisted(async () => {
  const { tempRoot } = await import("./fakes.ts");
  process.env.YS_ROOT = tempRoot();
  delete process.env.STORE;
  delete process.env.LEDGER;
});

const server = await import("../../src/lib/server.ts");
const upload = await import("../../src/app/api/footage/route.ts");
const episodes = await import("../../src/app/api/episodes/route.ts");
const action = await import("../../src/app/api/episodes/[id]/action/route.ts");

const TR = { "accept-language": "tr-TR,tr;q=0.9" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const send = (body: BodyInit, headers: Record<string, string>) => upload.POST(new Request("http://localhost:3100/api/footage", { method: "POST", body, headers: { ...TR, ...headers } }));
const post = (body: unknown) => new Request("http://localhost:3100/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...TR } });
const create = (body: unknown) => episodes.POST(post(body));
const act = (id: string, body: unknown) => action.POST(post(body), { params: Promise.resolve({ id }) });

beforeEach(() => {
  resetStudio();
  registry.providers = [];
  registry.skipped = [];
});
afterEach(() => vi.restoreAllMocks());

/** Bekleme alanına resim (ya da video) yükler; anahtarı döner. */
async function staged(name = "logo.jpg", bytes: Uint8Array<ArrayBuffer> = JPEG, type = "image/jpeg") {
  const res = await send(bytes, { "content-type": type, "x-file-name": name });
  return ((await res.json()) as { key: string }).key;
}

describe("hareketli grafik filmi oluşturma", () => {
  it("yatay film: görseller bekleyen, renkler süzülür, senaryo işi başlar", async () => {
    const key = await staged();
    const res = await create({
      topic: "  Hızlı derleme  ",
      lang: "en",
      voiceId: "v1",
      tier: "premium",
      budgetUsd: 3,
      captions: false,
      music: false,
      sfx: false,
      motion: { uploads: [{ key, name: "x".repeat(130) + ".jpg" }], sec: 44.6, colors: ["#2563EB", "mavi", 5, "#f59e0b", "#111111", "#222222", "#333333", "#444444", "#555555"], narration: true },
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const state = (await server.repo().load(id)) as EpisodeState;
    expect(state.input).toMatchObject({
      topic: "Hızlı derleme",
      lang: "en",
      targetSec: 45,
      tier: "premium",
      budgetUsd: 3,
      voiceId: "v1",
      autoApprove: false,
      captions: false,
      music: false,
      sfx: false,
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(state.input.motion).toEqual({ colors: ["#2563EB", "#f59e0b", "#111111", "#222222", "#333333", "#444444"], images: [], pending: [{ key, name: "x".repeat(116) + ".jpg" }], narration: true });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(lastChild().args.slice(-5)).toEqual(["episode", "run", id, "--until", "script"]);
  });

  it("varsayılanlar: dikey istenirse 1080×1920, görselsiz bekleyen yok, anlatım kapalı, Türkçe, 30 sn", async () => {
    const { id } = (await (await create({ topic: "Brif", lang: "bozuk dil", motion: { vertical: true } })).json()) as { id: string };
    const state = await server.repo().load(id);
    expect(state.input.voiceId).toBeUndefined();
    expect(state.input).toMatchObject({ topic: "Brif", lang: "tr", targetSec: 30, tier: "standard", budgetUsd: 5, captions: true, music: true, sfx: true, width: 1080, height: 1920 });
    expect(state.input.motion).toEqual({ colors: [], images: [], narration: false });
  });

  it("brif, yükleme listesi, süre ve bütçe denetlenir", async () => {
    const key = await staged();
    const video = await staged("a.mp4", MP4, "video/mp4");
    expect(video).toMatch(/\.mp4$/);
    const bad = async (body: unknown) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await bad({ motion: {} })).toContain("Konu");
    expect(await bad({ topic: "  ", motion: {} })).toContain("Konu");
    const images = "jpg, png, webp; en çok 12";
    expect(await bad({ topic: "b", motion: { uploads: [{ key: "library/x.jpg", name: "a" }] } })).toContain(images);
    expect(await bad({ topic: "b", motion: { uploads: [null] } })).toContain(images);
    expect(await bad({ topic: "b", motion: { uploads: [{ key }] } })).toContain(images);
    expect(await bad({ topic: "b", motion: { uploads: [{ key: video, name: "a.mp4" }] } })).toContain(images);
    expect(await bad({ topic: "b", motion: { uploads: Array.from({ length: 13 }, () => ({ key, name: "a" })) } })).toContain(images);
    expect(await bad({ topic: "b", motion: { uploads: [{ key: "uploads/footage/0123456789abcdef01234567.png", name: "a.png" }] } })).toContain(images);
    expect(await bad({ topic: "b", motion: { uploads: "x", sec: 9 } })).toContain("10–180");
    expect(await bad({ topic: "b", motion: { sec: 181 } })).toContain("10–180");
    expect(await bad({ topic: "b", motion: { sec: "x" } })).toContain("10–180");
    expect(await bad({ topic: "b", budgetUsd: 0, motion: {} })).toContain("Bütçe");
    expect(await bad({ topic: "b", budgetUsd: "x", motion: {} })).toContain("Bütçe");
    expect(spawn).not.toHaveBeenCalled();
  });
});

const INPUT: EpisodeInput = { topic: "Brif", lang: "tr", targetSec: 30, tier: "economy", aiClipRatio: 0, budgetUsd: 5, width: 1920, height: 1080, fps: 30, motion: { colors: [], images: [], narration: false } };
const FILM = {
  title: "F",
  bpm: 120,
  route: "hybrid",
  type: "clear",
  palette: { ground: "#ffffff", ink: "#000000", accent: "#2563eb", alt: "#dbeafe" },
  sections: [{ name: "hook", bars: 1, energy: 7 }],
  scenes: [{ id: "m1", language: "kinetic", beats: 4, pace: "beat", transition: "cut", camera: "still", ground: "ground", hit: "none", narration: "", kinetic: { lines: ["Hızlı"], mode: "slam" } }],
};

async function saveEpisode(id: string, over: Partial<EpisodeState> = {}): Promise<void> {
  await server.repo().save({ id, createdAt: "2026-11-22T09:00:00.000Z", input: INPUT, done: { story: "t", script: "t" }, agentCostUsd: 0, ...over } as EpisodeState);
}

describe("film eylemleri", () => {
  it("notla yeniden yaz: not saklanır, senaryo yeniden açılır, iş senaryo kapısına kadar sürer", async () => {
    await saveEpisode("film-1", { motionFilm: FILM } as Partial<EpisodeState>);
    const res = await act("film-1", { type: "remake-film", note: "  Daha hızlı açılış  " });
    expect(await res.json()).toEqual({ ok: true });
    const state = await server.repo().load("film-1");
    expect(state.motionNote).toBe("Daha hızlı açılış");
    expect(state.done.script).toBeUndefined();
    expect(server.getJob("film-1")?.label).toBe("job.script");
    expect(lastChild().args.slice(2)).toEqual(["episode", "run", "film-1", "--until", "script"]);
  });

  it("metin olmayan not boş sayılır ve reddedilir; iş başlamaz", async () => {
    await saveEpisode("film-2", { motionFilm: FILM } as Partial<EpisodeState>);
    const res = await act("film-2", { type: "remake-film", note: 5 });
    expect(res.status).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
    expect((await server.repo().load("film-2")).motionNote).toBeUndefined();
  });

  it("senaryo onayı filmde konsepti atlayıp üretime geçer", async () => {
    await saveEpisode("film-3", { motionFilm: FILM, script: { scenes: [{ id: "m1", beatId: "m1", narration: "", visualIntent: "", emotion: "neutral", location: "" }] } } as Partial<EpisodeState>);
    expect(await (await act("film-3", { type: "approve-script" })).json()).toEqual({ ok: true });
    expect(server.getJob("film-3")?.label).toBe("job.produce");
    expect(lastChild().args.slice(2)).toEqual(["episode", "run", "film-3"]);
    expect((await server.repo().load("film-3")).approvals?.script).toBeDefined();
  });
});
