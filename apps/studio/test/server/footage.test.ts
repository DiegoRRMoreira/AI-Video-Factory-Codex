import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeState } from "@ys/pipeline/light";
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
const { proxy } = await import("../../src/proxy.ts");

const TR = { "accept-language": "tr-TR,tr;q=0.9" };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const send = (body: BodyInit | null, headers: Record<string, string>) => upload.POST(new Request("http://localhost:3100/api/footage", { method: "POST", body, headers: { ...TR, ...headers } }));
const create = (body: unknown) => episodes.POST(new Request("http://localhost:3100/api/episodes", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...TR } }));

beforeEach(() => {
  resetStudio();
  registry.providers = [];
  registry.skipped = [];
  delete process.env.YS_FOOTAGE_MAX_MB;
});
afterEach(() => vi.restoreAllMocks());

describe("footage yüklemesi", () => {
  it("izinli ve imzası uyan dosya içerik adresli bekleme alanına yazılır; ad yoldan arındırılır", async () => {
    const res = await send(JPEG, { "content-type": "image/jpeg", "x-file-name": encodeURIComponent("klasör\\alt/Gün doğumu.JPG") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; name: string; size: number };
    expect(body.key).toMatch(/^uploads\/footage\/[0-9a-f]{24}\.jpg$/);
    expect(body).toMatchObject({ name: "klasör_alt_Gün doğumu.JPG", size: JPEG.length });
    expect(await server.store().get(body.key)).toEqual(JPEG);
  });

  it("uzantısı izinsiz, adı yok ya da bozuk, imzası uymayan, gövdesiz dosya reddedilir", async () => {
    const reject = async (body: BodyInit | null, name: string | undefined) => {
      const res = await send(body, { "content-type": "image/jpeg", ...(name === undefined ? {} : { "x-file-name": name }) });
      expect(res.status).toBe(400);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await reject(JPEG, "anim.gif")).toContain("Desteklenmeyen ya da bozuk dosya: anim.gif");
    expect(await reject(JPEG, undefined)).toContain("dosya: ?");
    expect(await reject(JPEG, "%E0%A4%A")).toContain("dosya: ?");
    expect(await reject(JPEG, "noext")).toContain("noext");
    expect(await reject(new Uint8Array([1, 2, 3]), "a.png")).toContain("a.png");
    expect(await reject(null, "a.jpg")).toContain("a.jpg");
  });

  it("sınırı aşan dosya: bildirilen boy ya da okunan gövde (YS_FOOTAGE_MAX_MB)", async () => {
    process.env.YS_FOOTAGE_MAX_MB = "0.000001";
    const declared = await send(JPEG, { "content-type": "image/jpeg", "x-file-name": "a.jpg", "content-length": "9999999" });
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { error: string }).error).toContain("Dosya çok büyük: a.jpg");
    const streamed = await send(new Uint8Array(64), { "content-type": "image/jpeg", "x-file-name": "a.jpg" });
    expect(streamed.status).toBe(413);
  });

  it("proxy yalnız bu uç noktada izinli video/resim türüne açar; köken denetimi sürer", () => {
    const call = (path: string, type: string, extra: Record<string, string> = {}) =>
      proxy(new NextRequest(`http://localhost:3100${path}`, { method: "POST", headers: { host: "localhost:3100", "content-type": type, ...extra } }));
    const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
    expect(passed(call("/api/footage", "video/mp4"))).toBe(true);
    expect(passed(call("/api/footage", "application/octet-stream; charset=binary"))).toBe(true);
    expect(call("/api/footage", "text/plain").status).toBe(415);
    expect(call("/api/episodes", "video/mp4").status).toBe(415);
    expect(call("/api/footage", "video/mp4", { origin: "http://evil.example", "sec-fetch-site": "cross-site" }).status).toBe(403);
  });
});

describe("footage bölümü oluşturma", () => {
  async function staged(name = "a.jpg") {
    const res = await send(JPEG, { "content-type": "image/jpeg", "x-file-name": name });
    return ((await res.json()) as { key: string }).key;
  }

  it("dikey bölüm: yüklenenler bekleyen dosya, kurgu işi başlar; seçenekler ve yazılar temizlenir", async () => {
    const key = await staged();
    const res = await create({
      topic: "  Balon turu ",
      lang: "en",
      voiceId: "v1",
      tier: "premium",
      budgetUsd: 4,
      captions: false,
      music: false,
      sfx: false,
      footage: { uploads: [{ key, name: "x".repeat(130) + ".jpg" }], sec: 45.4, narration: false, transcribe: false, texts: [" Bir ", "", 3, "y".repeat(80), "a", "b", "c", "d", "e", "f", "g"] },
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const state = (await server.repo().load(id)) as EpisodeState;
    expect(state.input).toMatchObject({
      topic: "Balon turu",
      lang: "en",
      targetSec: 45,
      tier: "premium",
      budgetUsd: 4,
      voiceId: "v1",
      autoApprove: false,
      captions: false,
      music: false,
      sfx: false,
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(state.input.footage!.pending).toEqual([{ key, name: "x".repeat(116) + ".jpg" }]);
    expect(state.input.footage!.texts).toEqual(["Bir", "y".repeat(60), "a", "b", "c", "d", "e", "f"]);
    expect(state.input.footage).toMatchObject({ sources: [], narration: false, transcribe: false });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(lastChild().args.slice(-5)).toEqual(["episode", "run", id, "--until", "script"]);
  });

  it("varsayılanlar: konu 'Short', 30 sn, Türkçe, anlatım ve döküm açık", async () => {
    const key = await staged();
    const { id } = (await (await create({ lang: "bozuk dil", footage: { uploads: [{ key, name: "a.jpg" }] } })).json()) as { id: string };
    const state = await server.repo().load(id);
    expect(state.input.voiceId).toBeUndefined();
    expect(state.input).toMatchObject({ topic: "Short", targetSec: 30, lang: "tr", tier: "standard", budgetUsd: 5, captions: true, music: true, sfx: true });
    expect(state.input.footage).toMatchObject({ narration: true, transcribe: true, texts: [] });
  });

  it("geçersiz yükleme listesi, süre ve bütçe reddedilir", async () => {
    const key = await staged();
    const bad = async (body: unknown) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await bad({ footage: {} })).toContain("1–20 yüklenmiş dosya");
    expect(await bad({ footage: { uploads: [{ key: "library/x.jpg", name: "a" }] } })).toContain("1–20");
    expect(await bad({ footage: { uploads: [null] } })).toContain("1–20");
    expect(await bad({ footage: { uploads: [{ key }, { key, name: "a" }] } })).toContain("1–20");
    expect(await bad({ footage: { uploads: Array.from({ length: 21 }, () => ({ key, name: "a" })) } })).toContain("1–20");
    expect(await bad({ footage: { uploads: [{ key: "uploads/footage/0123456789abcdef01234567.mp4", name: "a.mp4" }] } })).toContain("1–20");
    expect(await bad({ footage: { uploads: [{ key, name: "a" }], sec: 10 } })).toContain("15–180");
    expect(await bad({ footage: { uploads: [{ key, name: "a" }], sec: "x" } })).toContain("15–180");
    expect(await bad({ budgetUsd: 0, footage: { uploads: [{ key, name: "a" }] } })).toContain("Bütçe");
    expect(spawn).not.toHaveBeenCalled();
  });
});
