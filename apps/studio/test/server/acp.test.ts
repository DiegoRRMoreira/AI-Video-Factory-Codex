import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGY_BACKEND } from "@ys/core";
import { resetStudio } from "./fakes.ts";

vi.mock("server-only", () => ({}));
// Keşif gerçek ajanı açar: burada sahte ajanla (istem yok, süreç yok).
vi.mock("@ys/pipeline/acp", async () => {
  const { discoverAcpBackend } = await vi.importActual<typeof import("@ys/pipeline/acp")>("@ys/pipeline/acp");
  const { fakeAcp } = await import("../../../../packages/agents/test/acp-fake.ts");
  return { discoverAcpBackend: (store: never, id: unknown) => discoverAcpBackend(store, id, fakeAcp({ config: true }).spawn) };
});

await vi.hoisted(async () => {
  const { tempRoot } = await import("./fakes.ts");
  process.env.YS_ROOT = tempRoot();
  delete process.env.STORE;
  delete process.env.LEDGER;
});

const acp = await import("../../src/app/api/settings/acp/route.ts");
const discover = await import("../../src/app/api/settings/acp/discover/route.ts");
const models = await import("../../src/app/api/settings/models/route.ts");

const EN = { "accept-language": "en-US" };
const req = (method: string, body: unknown) => new Request("http://localhost:3100/x", { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...EN } });

beforeEach(() => resetStudio());

describe("/api/settings/acp", () => {
  it("ajan ekler, modellerini bulur; bulunan model bir ajana seçilebilir; ajan silinince seçim düşer", async () => {
    expect(await (await acp.GET()).json()).toEqual({ backends: [] });
    const put = await acp.PUT(req("PUT", { backends: [AGY_BACKEND] }));
    expect(await put.json()).toEqual({ acp: { backends: [AGY_BACKEND] }, models: {} });
    const found = await discover.POST(req("POST", { id: "agy" }));
    expect(found.status).toBe(200);
    const body = (await found.json()) as { acp: { backends: { models: { id: string }[] }[] } };
    expect(body.acp.backends[0]!.models.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(await (await models.PUT(req("PUT", { "youtube-analyst": "acp:agy:m2" }))).json()).toEqual({ "youtube-analyst": "acp:agy:m2" });
    expect(await (await acp.PUT(req("PUT", { backends: [] }))).json()).toEqual({ acp: { backends: [] }, models: {} });
  });

  it("bozuk gövde ve tanımsız ajan 400 ile isteğin dilinde", async () => {
    expect((await acp.PUT(req("PUT", "[1]"))).status).toBe(400);
    const res = await discover.POST(req("POST", { id: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown ACP agent: nope" });
  });
});
