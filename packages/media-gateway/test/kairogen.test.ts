import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmittedJobError, type GenerationRequest } from "../src/types.ts";
import { KairogenAdapter, mapKairogenReference, type KairogenModelSpec } from "../src/providers/kairogen.ts";
import { kairogenData } from "../src/providers/kairogen-client.ts";
import { createProvidersFromEnv } from "../src/registry.ts";

const mock = vi.hoisted(() => ({ callTool: vi.fn(), close: vi.fn() }));
vi.mock("../src/providers/kairogen-client.ts", async (original) => ({
  ...await original<typeof import("../src/providers/kairogen-client.ts")>(),
  connectKairogen: vi.fn(async () => ({ callTool: mock.callTool, close: mock.close })),
}));

const spec: KairogenModelSpec = { model: "seedance-2-0-mini", type: "video", capabilities: ["t2v", "i2v"], limits: { minDurationSec: 4, maxDurationSec: 15 }, maxCredits: 20, usdPerCredit: 0.01, params: { resolution: "720p", generate_audio: false } };
const req: GenerationRequest = { capability: "t2v", quality: "standard", prompt: "A slow camera move", durationSec: 5, aspectRatio: "16:9" };
const reply = (data: Record<string, unknown>) => ({ structuredContent: data });
let dir: string;
let download: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ys-kairogen-test-"));
  vi.stubEnv("KAIROGEN_AUTH_DIR", dir);
  mock.callTool.mockReset(); mock.close.mockReset(); mock.close.mockResolvedValue(undefined);
  download = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } }));
  mock.callTool.mockImplementation(async ({ name }: { name: string }) => {
    if (name === "get_me_context") return reply({ user: { id: "account-a" } });
    if (name === "list_models") return reply({ models: [{ model_key: spec.model }] });
    if (name === "estimate_cost") return reply({ credit_cost: 12 });
    if (name === "generate_video") return reply({ generation_id: "job-123" });
    return reply({ status: "COMPLETED", output_urls: ["https://cdn.example/result.mp4"] });
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("Kairogen media bridge", () => {
  it("quotes exact generation arguments, enforces expected credits and downloads without OAuth headers", async () => {
    const adapter = new KairogenAdapter(spec);
    const result = await adapter.generate(req, { fetch: download as typeof fetch });
    const calls = mock.callTool.mock.calls.map(([call]) => call);
    const quoted = calls.find((call) => call.name === "estimate_cost").arguments;
    expect(calls.find((call) => call.name === "generate_video").arguments).toEqual({ ...quoted, expected_credits: 12, wait_for_completion: false });
    expect(quoted).toMatchObject({ duration_seconds: 5, generate_audio: false, resolution: "720p" });
    expect(result.files[0]?.mimeType).toBe("video/mp4");
    expect(download.mock.calls[0]?.[1]).not.toHaveProperty("headers");
    expect(adapter.price).toEqual({ unit: "per_output", usd: 0.2 });
  });

  it("refuses an over-cap quote without sending a paid call", async () => {
    mock.callTool.mockImplementation(async ({ name }) => reply(name === "get_me_context" ? { user: { id: "account-a" } } : name === "list_models" ? { models: [{ model_key: spec.model }] } : { credit_cost: 21 }));
    await expect(new KairogenAdapter(spec).generate(req, { fetch: download as typeof fetch })).rejects.toThrow("exceeds");
    expect(mock.callTool.mock.calls.some(([call]) => call.name === "generate_video")).toBe(false);
    expect((await readdir(dir)).some((file) => file.startsWith("job-"))).toBe(false);
  });

  it("retains an ambiguous submission and never submits the same paid request again", async () => {
    const base = mock.callTool.getMockImplementation()!;
    mock.callTool.mockImplementation(async (call) => { if (call.name === "generate_video") throw new Error("network dropped"); return base(call); });
    const adapter = new KairogenAdapter(spec);
    await expect(adapter.generate(req, { fetch: download as typeof fetch })).rejects.toBeInstanceOf(SubmittedJobError);
    await expect(adapter.generate(req, { fetch: download as typeof fetch })).rejects.toThrow("unknown outcome");
    expect(mock.callTool.mock.calls.filter(([call]) => call.name === "generate_video")).toHaveLength(1);
    expect(await readdir(dir)).not.toContain("generation.lock");
  });

  it("resumes an accepted job after a download failure without quoting or submitting twice", async () => {
    const adapter = new KairogenAdapter(spec);
    const broken = vi.fn(async () => new Response("no", { headers: { "content-type": "text/html" } }));
    await expect(adapter.generate(req, { fetch: broken as typeof fetch })).rejects.toBeInstanceOf(SubmittedJobError);
    await adapter.generate(req, { fetch: download as typeof fetch });
    expect(mock.callTool.mock.calls.filter(([call]) => call.name === "generate_video")).toHaveLength(1);
    expect(mock.callTool.mock.calls.filter(([call]) => call.name === "estimate_cost")).toHaveLength(1);
    const name = (await readdir(dir)).find((file) => file.startsWith("job-"))!;
    expect(JSON.parse(await readFile(join(dir, name), "utf8"))).toMatchObject({ generationId: "job-123", credits: 12 });
  });

  it("preserves byte-identical frame references and rejects unknown bytes before any MCP call", async () => {
    const bytes = new Uint8Array([4, 5]);
    const adapter = new KairogenAdapter(spec);
    const frameReq: GenerationRequest = { ...req, capability: "i2v", refs: [{ bytes, role: "first_frame", mimeType: "image/png" }] };
    await expect(adapter.arguments(frameReq)).rejects.toThrow("public HTTPS URL");
    expect(mock.callTool).not.toHaveBeenCalled();
    await mapKairogenReference(bytes, "https://cdn.example/frame.png");
    expect(await adapter.arguments(frameReq)).toHaveProperty("first_frame_url", "https://cdn.example/frame.png");
    await expect(adapter.arguments({ ...frameReq, refs: [{ bytes: new Uint8Array([5, 4]), role: "first_frame", mimeType: "image/png" }] })).rejects.toThrow("public HTTPS URL");
    await expect(mapKairogenReference(bytes, "http://localhost/frame.png")).rejects.toThrow("HTTPS");
  });

  it("rejects missing accounting settings and surfaces provider plan errors", () => {
    expect(() => new KairogenAdapter({ ...spec, usdPerCredit: 0 })).toThrow("accounting");
    expect(() => kairogenData({ isError: true, content: [{ type: "text", text: "PLAN_UPGRADE_REQUIRED" }] })).toThrow("PLAN_UPGRADE_REQUIRED");
  });

  it("does not reuse another account's job checkpoint", async () => {
    const adapter = new KairogenAdapter(spec);
    await adapter.generate(req, { fetch: download as typeof fetch });
    const base = mock.callTool.getMockImplementation()!;
    mock.callTool.mockImplementation(async (call) => call.name === "get_me_context" ? reply({ user: { id: "account-b" } }) : base(call));
    await adapter.generate(req, { fetch: download as typeof fetch });
    expect(mock.callTool.mock.calls.filter(([call]) => call.name === "generate_video")).toHaveLength(2);
  });

  it("maps a generated image for the next image-to-video request", async () => {
    const image = new KairogenAdapter({ ...spec, model: "image-model", type: "image", capabilities: ["t2i", "i2i_multiref"], params: {} });
    mock.callTool.mockImplementation(async ({ name }) => {
      if (name === "get_me_context") return reply({ user: { id: "account-a" } });
      if (name === "list_models") return reply({ models: [{ model_key: "image-model" }] });
      if (name === "estimate_cost") return reply({ credit_cost: 5 });
      if (name === "generate_image") return reply({ generation_id: "image-123" });
      return reply({ status: "COMPLETED", output_urls: ["https://cdn.example/image.png"] });
    });
    const output = await image.generate({ ...req, capability: "t2i" }, { fetch: vi.fn(async () => new Response(new Uint8Array([7, 8]), { headers: { "content-type": "image/png" } })) as typeof fetch });
    expect(await new KairogenAdapter(spec).arguments({ ...req, capability: "i2v", refs: [{ role: "first_frame", ...output.files[0]! }] })).toHaveProperty("first_frame_url", "https://cdn.example/image.png");
  });

  it("registers Kairogen only with explicit opt-in and configured accounting", async () => {
    const path = join(dir, "models.json");
    await writeFile(path, JSON.stringify([spec]));
    expect(createProvidersFromEnv({ NODE_ENV: "test", KAIROGEN_MODELS_FILE: path }).providers.some((p) => p.id.startsWith("kairogen:"))).toBe(false);
    expect(createProvidersFromEnv({ NODE_ENV: "test", KAIROGEN_ENABLED: "1", KAIROGEN_MODELS_FILE: path }).providers[0]?.id).toBe("kairogen:seedance-2-0-mini");
  });
});
