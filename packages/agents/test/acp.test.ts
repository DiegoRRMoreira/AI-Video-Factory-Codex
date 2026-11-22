import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatText, type AcpBackend } from "@ys/core";
import { z } from "zod";
import { AcpRpcError, AcpSession, AgentError, discoverAcp, extractJson, nearestEffort, runStructured, spawnAcp } from "../src/index.ts";
import { fakeAcp, type FakeOptions } from "./acp-fake.ts";

// Geçici klasör silinemezse (Windows'ta ölmekte olan sürecin çalışma klasörü: EBUSY) kapanış hatasız sürmeli.
const fsMock = vi.hoisted(() => ({ failRm: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, rm: (...args: Parameters<typeof real.rm>) => (fsMock.failRm ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })) : real.rm(...args)) };
});

const backend: AcpBackend = { id: "fake", label: "Fake ACP", command: "fake-agent", args: ["acp", "--x"], models: [], efforts: [], images: true };
const schema = z.object({ ok: z.boolean(), n: z.number().default(1) });
const call = { name: "youtube-analyst", model: "acp:fake:m2", system: "SYSTEM", prompt: "PROMPT", schema, effort: "max" as const };
const img = { data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

function run(opts: FakeOptions, over: Partial<typeof call> & { images?: (typeof img)[] } = {}, logs: string[] = []) {
  const agent = fakeAcp(opts);
  return { agent, result: runStructured({ ...call, ...over }, { acp: [backend], acpSpawn: agent.spawn, log: (m) => logs.push(m) }) };
}

const prompts = (agent: ReturnType<typeof fakeAcp>) => agent.received.filter((m) => m.method === "session/prompt").map((m) => m.params!.prompt as { type: string; text?: string; data?: string }[]);
const errorText = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AgentError);
  return formatText("en", (e as AgentError).text);
};

afterEach(() => vi.useRealTimers());

/** Sahte zamanlayıcıyla sürer: gerçek G/Ç (geçici klasör, setImmediate) ilerlesin diye her adımda bir tur bekler. */
async function drive(p: Promise<unknown>, stepMs: number, steps = 20_000): Promise<unknown> {
  let done = false;
  const out = p.then(
    (v) => ((done = true), v),
    (e: unknown) => ((done = true), e),
  );
  for (let i = 0; i < steps && !done; i++) {
    await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  return out;
}

describe("ACP ile yapılandırılmış çağrı", () => {
  it("modeli ve çabayı seçer, talimatı/görselleri/şemayı gönderir, parça parça gelen JSON'u doğrular", async () => {
    const logs: string[] = [];
    const { agent, result } = run({ config: true, efforts: ["low", "high", "xhigh"], turns: [{ text: '```json\n{"ok": true}\n```' }] }, { images: [img] }, logs);
    const res = await result;
    expect(res).toMatchObject({ data: { ok: true, n: 1 }, costUsd: 0, model: "acp:fake:m2", name: "youtube-analyst" });
    expect(agent.spawned[0]).toMatchObject({ command: "fake-agent", args: ["acp", "--x"] });
    expect(existsSync(agent.spawned[0]!.cwd)).toBe(false); // geçici çalışma klasörü silindi
    expect(agent.killed).toBe(1);
    const sets = agent.received.filter((m) => m.method === "session/set_config_option").map((m) => [m.params!.configId, m.params!.value]);
    expect(sets).toEqual([["model", "m2"], ["thought_level", "xhigh"]]);
    const [blocks] = prompts(agent);
    expect(blocks!.map((b) => b.type)).toEqual(["text", "image", "text"]);
    expect(blocks![0]!.text).toMatch(/^SYSTEM\n\nYou are called as a plain model/);
    expect(blocks![1]!.data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(blocks![2]!.text).toMatch(/^PROMPT\n\nReply with one JSON value[^]*"ok"/);
    expect(logs).toEqual(["ajan: youtube-analyst (acp:fake:m2)", "ajan: youtube-analyst bitti (Fake ACP)"]);
  });

  it("configOptions yoksa session/set_model; seçili model ve çaba zaten doğruysa ayar gönderilmez", async () => {
    const a = run({ turns: [{ text: '{"ok": false}' }] });
    expect((await a.result).data.ok).toBe(false);
    expect(a.agent.received.filter((m) => m.method === "session/set_model").map((m) => m.params!.modelId)).toEqual(["m2"]);
    const b = run({ config: true, turns: [{ text: '{"ok": true}' }] }, { model: "acp:fake:m1", effort: undefined as never });
    await b.result;
    expect(b.agent.received.some((m) => m.method === "session/set_config_option")).toBe(false);
    const c = run({ config: true, efforts: ["high"], turns: [{ text: '{"ok": true}' }] }, { model: "acp:fake:m1", effort: "high" as never });
    await c.result;
    expect(c.agent.received.some((m) => m.method === "session/set_config_option")).toBe(false);
  });

  it("şemaya uymayan yanıtta aynı oturumda düzeltme ister; iki düzeltmeden sonra şema hatası", async () => {
    const ok = run({ turns: [{ text: "Sure! here it is" }, { text: '{"ok": "yes"}' }, { text: 'Fixed: {"ok": true, "n": 3}' }] });
    expect((await ok.result).data).toEqual({ ok: true, n: 3 });
    const sent = prompts(ok.agent);
    expect(sent).toHaveLength(3);
    expect(sent[1]![0]!.text).toMatch(/^Your answer could not be used: no JSON object in the answer\nReply again/);
    expect(sent[2]![0]!.text).toMatch(/ok/);
    const bad = run({ turns: [{ text: "x" }, { text: "{broken" }, { text: "[1]" }] });
    expect(await errorText(bad.result)).toMatch(/youtube-analyst: output does not match the schema/);
    expect(prompts(bad.agent)).toHaveLength(3);
  });

  it("tur erken biterse (red, sınır) yeniden denenmez", async () => {
    const { agent, result } = run({ turns: [{ text: "no", stop: "refusal" }] });
    expect(await errorText(result)).toBe("youtube-analyst: the ACP turn stopped early (refusal)");
    expect(agent.spawned).toHaveLength(1);
    // stopReason vermeyen ajan: tur bitti sayılır
    expect((await run({ turns: [{ text: '{"ok":true}', stop: "none" }] }).result).data.ok).toBe(true);
  });

  it("araç izni istenirse geri çevrilir; reject seçeneği yoksa iptal; ajanın diğer istekleri desteklenmez", async () => {
    const a = run({ noise: true, turns: [{ permission: [{ optionId: "allow", kind: "allow_once" }, { optionId: "no", kind: "reject_always" }], text: '{"ok":true}' }] });
    await a.result;
    expect(a.agent.received.find((m) => m.id === "perm1")?.result).toEqual({ outcome: { outcome: "selected", optionId: "no" } });
    expect(a.agent.received.find((m) => m.id === "fs1")?.error).toMatchObject({ code: -32601 });
    const b = run({ turns: [{ permission: [{ optionId: "allow", kind: "allow_once" }], text: '{"ok":true}' }] });
    await b.result;
    expect(b.agent.received.find((m) => m.id === "perm1")?.result).toEqual({ outcome: { outcome: "cancelled" } });
    const c = run({ turns: [{ permission: undefined as never, text: '{"ok":true}' }] });
    await c.result;
  });

  it("izin isteğinde seçenek listesi yoksa iptal", async () => {
    const agent = fakeAcp({ turns: [{ text: '{"ok":true}' }] });
    const spawn: typeof agent.spawn = (cmd, args, cwd) => {
      const child = agent.spawn(cmd, args, cwd);
      setImmediate(() => (child.stdout as unknown as import("node:events").EventEmitter).emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: "p0", method: "session/request_permission", params: {} })}\n`));
      return child;
    };
    await runStructured(call, { acp: [backend], acpSpawn: spawn });
    expect(agent.received.find((m) => m.id === "p0")?.result).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("yalın ajan: params'sız mesajlar, adsız seçenekler, boş ayar yanıtı, metinsiz parçalar sorun çıkarmaz", async () => {
    const { agent, result } = run({ bare: true, turns: [{ text: '{"ok":true}' }] });
    expect((await result).data.ok).toBe(true);
    expect(agent.received.find((m) => m.id === "r2")?.error).toMatchObject({ code: -32601 });
    expect(await discoverAcp(backend, fakeAcp({ bare: true }).spawn)).toEqual({ images: true, models: [{ id: "m1", name: "m1" }, { id: "m2", name: "m2" }], efforts: [] });
  });

  it("stderr'siz çöküşte ileti yalnız çıkış kodu", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { result } = run({ turns: [{ exit: 9, quiet: true }, { exit: 9, quiet: true }, { exit: 9, quiet: true }] });
    expect(((await drive(result, 1000)) as Error).message).toBe("process exited with code 9");
  });

  it("tanımsız ajan, görsel desteklemeyen ajan ve sunulmayan model açık hatayla düşer", async () => {
    expect(await errorText(runStructured(call, {}))).toBe('youtube-analyst: ACP agent "fake" is not set up (Models page)');
    expect(await errorText(run({ image: false }, { images: [img] }).result)).toBe("youtube-analyst: Fake ACP does not accept images; pick a model that does for this agent");
    expect(await errorText(run({ config: true }, { model: "acp:fake:zz" }).result)).toBe("youtube-analyst: ACP error: ACP session/new: model not offered: zz");
  });

  it("JSON-RPC hatası: kota/aşırı yük geçici (yeniden denenir), giriş hatası değil", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const busy = run({ turns: [{ error: { code: -32000, message: "429 RESOURCE_EXHAUSTED" } }, { text: '{"ok":true}' }] });
    expect(await drive(busy.result, 500)).toMatchObject({ data: { ok: true } });
    expect(busy.agent.spawned).toHaveLength(2);
    vi.useRealTimers();
    const auth = run({ initError: { code: -32000, message: "Authentication required" } });
    expect(await errorText(auth.result)).toBe("youtube-analyst: ACP error: ACP initialize: Authentication required");
    expect(auth.agent.spawned).toHaveLength(1);
    // Hata kodu/mesajı olmayan yanıt
    const bare = run({ initError: {} as never });
    expect(await errorText(bare.result)).toBe("youtube-analyst: ACP error: ACP initialize: error");
  });

  it("komut bulunamazsa (ENOENT) yeniden denenmeden açık hata; eşzamanlı spawn hatası olduğu gibi", async () => {
    const enoent = Object.assign(new Error("spawn fake-agent ENOENT"), { code: "ENOENT" });
    expect(await errorText(run({ spawnError: enoent }).result)).toBe("youtube-analyst: could not start the ACP agent, command not found: fake-agent");
    await expect(run({ spawnThrows: true }).result).rejects.toThrow("spawn blew up");
  });

  it("süreç çökerse geçici sayılır, stderr'in son satırı iletide; denemeler biterse hata", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { agent, result } = run({ turns: [{ exit: 3 }, { exit: 3 }, { exit: 3 }] });
    expect(((await drive(result, 1000)) as Error).message).toBe("process exited with code 3: fatal: lost connection");
    expect(agent.spawned).toHaveLength(3);
  });

  it("zaman aşımında süreç sonlanır, hata geçicidir", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { agent, result } = run({ turns: [{ hang: true }, { hang: true }, { hang: true }] });
    const e = (await drive(result, 60_000)) as AgentError;
    expect(formatText("en", e.text)).toBe("youtube-analyst: did not finish within 600 s");
    expect(e.transient).toBe(true);
    expect(agent.killed).toBe(3);
  });
});

describe("ACP keşfi ve yardımcılar", () => {
  it("modelleri, çaba seviyelerini ve görsel desteğini istem göndermeden bulur", async () => {
    const withConfig = fakeAcp({ config: true, image: false });
    expect(await discoverAcp(backend, withConfig.spawn)).toEqual({
      images: false,
      models: [
        { id: "m1", name: "M1" },
        { id: "m2", name: "M2" },
      ],
      efforts: ["low", "medium", "high"],
    });
    expect(withConfig.received.some((m) => m.method === "session/prompt")).toBe(false);
    const plain = fakeAcp({});
    expect(await discoverAcp(backend, plain.spawn)).toEqual({
      images: true,
      models: [
        { id: "m1", name: "Model m1" },
        { id: "m2", name: "m2" },
      ],
      efforts: [],
    });
  });

  it("keşif zaman aşımında süreci kapatır; diğer hatalar olduğu gibi", async () => {
    const hang = fakeAcp({ hangOpen: true });
    await expect(discoverAcp(backend, hang.spawn, 30)).rejects.toThrow("timeout after 0.03 s");
    expect(hang.killed).toBe(1);
    await expect(discoverAcp(backend, fakeAcp({ initError: { code: 1, message: "nope" } }).spawn)).rejects.toBeInstanceOf(AcpRpcError);
  });

  it("önceden iptal edilmiş sinyal açılışı hemen düşürür; kapalı bağlantıya çağrı reddedilir", async () => {
    const agent = fakeAcp({});
    const abort = new AbortController();
    abort.abort();
    await expect(AcpSession.open(backend, agent.spawn, abort.signal)).rejects.toThrow("aborted");
    const session = await AcpSession.open(backend, fakeAcp({}).spawn);
    await session.close();
    await session.close();
    await expect(session.prompt([{ type: "text", text: "x" }])).rejects.toThrow("closed");
  });

  it("geçici klasör silinemezse kapanış yine hatasız", async () => {
    const session = await AcpSession.open(backend, fakeAcp({}).spawn);
    fsMock.failRm = true;
    try {
      await expect(session.close()).resolves.toBeUndefined();
    } finally {
      fsMock.failRm = false;
    }
  });

  it("nearestEffort: aynısı, yoksa bir alttaki, o da yoksa en yakın üstteki", () => {
    expect(nearestEffort("high", ["low", "high"])).toBe("high");
    expect(nearestEffort("max", ["low", "medium", "high", "xhigh"])).toBe("xhigh");
    expect(nearestEffort("low", ["high", "medium"])).toBe("medium");
    expect(nearestEffort("low", ["fast", "slow"])).toBeUndefined();
  });

  it("extractJson: kod çiti, düz metin içinde nesne ya da dizi", () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: [1, 2] done')).toEqual([1, 2]);
    expect(() => extractJson("nothing")).toThrow("no JSON object");
    expect(() => extractJson("} {")).toThrow("no JSON object");
  });

  it("varsayılan spawn gerçek süreç açar (olmayan komut: error olayı)", async () => {
    const child = spawnAcp("ys-no-such-acp-agent", ["acp"], process.cwd());
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => child.on("error", resolve));
    expect(err.code).toBe("ENOENT");
  });
});
