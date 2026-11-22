import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeState, YoutubeCandidate } from "@ys/pipeline/light";
import { putJson } from "@ys/storage";
import { registry, resetStudio, spawn } from "./fakes.ts";

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
const episodes = await import("../../src/app/api/episodes/route.ts");
const episode = await import("../../src/app/api/episodes/[id]/route.ts");
const action = await import("../../src/app/api/episodes/[id]/action/route.ts");

const TR = { "accept-language": "tr-TR,tr;q=0.9" };
const create = (body: unknown) => episodes.POST(new Request("http://localhost:3100/api/episodes", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...TR } }));
const act = (id: string, body: unknown) => action.POST(new Request(`http://localhost:3100/api/episodes/${id}/action`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...TR } }), { params: Promise.resolve({ id }) });
const runArgs = () => spawn.mock.calls.map((c) => (c[1] as string[]).slice(-3));

beforeEach(() => {
  resetStudio();
  registry.providers = [];
  registry.skipped = [];
  spawn.mockClear();
});

describe("YouTube analiz bölümü oluşturma", () => {
  it("adres doğrulanır, sayılar sınırlanır, iş onay beklemeden başlar", async () => {
    const res = await create({ topic: "  Sohbet ", lang: "en", tier: "premium", budgetUsd: 3, music: false, youtube: { url: "https://youtu.be/dQw4w9WgXcQ?si=x", count: 99, minSec: "30", maxSec: 45, transcribe: false, rights: true } });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const state = await server.repo().load(id);
    expect(state.input).toMatchObject({
      topic: "Sohbet",
      lang: "en",
      tier: "premium",
      budgetUsd: 3,
      autoApprove: false,
      music: false,
      captions: true,
      width: 1080,
      height: 1920,
      youtube: { videoId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", count: 12, minSec: 30, maxSec: 45, transcribe: false },
    });
    expect(runArgs()).toEqual([["episode", "run", id]]);
  });

  it("varsayılanlar; geçersiz sayı varsayılana düşer", async () => {
    const { id } = (await (await create({ lang: "?", youtube: { url: "dQw4w9WgXcQ", count: "x", minSec: null, maxSec: "", rights: true } })).json()) as { id: string };
    const state = await server.repo().load(id);
    expect(state.input).toMatchObject({ topic: "YouTube", lang: "tr", tier: "standard", budgetUsd: 5, youtube: { count: 6, minSec: 20, maxSec: 60 } });
    expect(state.input.youtube!.transcribe).toBeUndefined();
  });

  it("hak onayı, geçerli adres ve bütçe gerekli", async () => {
    const bad = async (body: unknown) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await bad({ youtube: { url: "dQw4w9WgXcQ" } })).toBe("Videonun sahibi olduğunu ya da kullanma hakkın olduğunu onayla");
    expect(await bad({ youtube: { url: "https://vimeo.com/1", rights: true } })).toContain("Geçerli bir YouTube video adresi değil");
    expect(await bad({ youtube: { url: 5, rights: true } })).toContain("Geçerli bir YouTube video adresi değil");
    expect(await bad({ budgetUsd: -1, youtube: { url: "dQw4w9WgXcQ", rights: true } })).toContain("Bütçe");
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("rapordan Short ve panel", () => {
  const cand: YoutubeCandidate = { id: "c1", title: "Soru", hook: "Kanca", why: "w", score: 9, mood: "warm", durationMs: 25_000, segments: [{ fromMs: 30_000, toMs: 55_000, focusX: 0.5, fit: "cover" }] };

  async function analysis(): Promise<string> {
    const store = server.store();
    await store.put("assets/youtube/a1/frames/40000.jpg", new Uint8Array([1]), "image/jpeg");
    await putJson(store, "library/youtube/dQw4w9WgXcQ/words-tr.json", [{ text: "Bu", startMs: 30_000, endMs: 30_400 }]);
    const state = {
      id: "a1",
      createdAt: "2026-11-22T00:00:00.000Z",
      input: { topic: "T", lang: "tr", targetSec: 60, tier: "economy", aiClipRatio: 0, budgetUsd: 5, width: 1080, height: 1920, fps: 30, youtube: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", count: 6, minSec: 20, maxSec: 60 } },
      done: { story: "t", script: "t" },
      agentCostUsd: 0,
      youtube: {
        meta: { videoId: "dQw4w9WgXcQ", title: "Uzun", channel: "K", durationMs: 600_000, width: 1920, height: 1080, description: "", chapters: [], heatmap: [] },
        video: { key: "library/youtube/dQw4w9WgXcQ/video.mp4", durationMs: 600_000, width: 1920, height: 1080, audio: true },
        transcript: { key: "library/youtube/dQw4w9WgXcQ/words-tr.json", source: "manual", words: 1 },
        frames: [{ atMs: 40_000, scene: 1, key: "assets/youtube/a1/frames/40000.jpg" }],
        report: { scenes: [], cuts: [], moments: [], candidates: [cand, { ...cand, id: "c2" }] },
      },
    } as unknown as EpisodeState;
    await server.repo().save(state);
    return state.id;
  }

  it("seçilen adaylar Short bölümü olur; incelenmeyenlerin üretimi başlar", async () => {
    const id = await analysis();
    const res = await act(id, { type: "make-shorts", candidates: ["c1", 5, "kötü"], music: false });
    expect(res.status).toBe(200);
    const { ids } = (await res.json()) as { ids: string[] };
    expect(ids).toHaveLength(1);
    const short = await server.repo().load(ids[0]!);
    expect(short.input).toMatchObject({ topic: "Soru", music: false, fromYoutube: { analysis: id, candidate: "c1" }, footage: { sources: [{ key: "library/youtube/dQw4w9WgXcQ/video.mp4" }] } });
    expect(short.approvals?.script).toBeDefined();
    expect(runArgs()).toEqual([["episode", "run", ids[0]!]]);

    spawn.mockClear();
    const review = await act(id, { type: "make-shorts", candidates: ["c2"], review: true });
    const reviewed = (await review.json()) as { ids: string[] };
    expect((await server.repo().load(reviewed.ids[0]!)).approvals).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect((await server.repo().load(id)).youtube!.shorts!.map((s) => s.candidate)).toEqual(["c1", "c2"]);
  });

  it("aday seçilmemişse ya da analiz yoksa 400", async () => {
    const id = await analysis();
    const none = await act(id, { type: "make-shorts", candidates: "c1" });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toBe("En az bir Short adayı seç");
    expect((await act(id, { type: "make-shorts", candidates: ["c9"] })).status).toBe(400);
  });

  it("YouTube bölümünün kendiliğinden açılan paneli rapordur ve raporu taşır", async () => {
    const id = await analysis();
    const res = await episode.GET(new Request(`http://localhost:3100/api/episodes/${id}`, { headers: { ...TR, "x-ys-panel": "auto" } }), { params: Promise.resolve({ id }) });
    const body = (await res.json()) as { panel: string; state: EpisodeState };
    expect(body.panel).toBe("youtube");
    expect(body.state.youtube!.report!.candidates).toHaveLength(2);
    const status = await episode.GET(new Request(`http://localhost:3100/api/episodes/${id}`, { headers: { ...TR, "x-ys-panel": "auto", "x-ys-status": "1" } }), { params: Promise.resolve({ id }) });
    expect(status.status).toBe(200);
  });
});
