import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AcpBackend, AcpModel } from "@ys/core";

/**
 * ACP (Agent Client Protocol) istemcisi: ajan CLI'ı (agy acp, claude-code-acp…) alt süreç olarak açılır, stdio üzerinden
 * satır başına bir JSON-RPC 2.0 mesajı konuşulur. Ajan boş, geçici bir klasörde çalışır (depoyu görmez); dosya ve uçbirim
 * yetenekleri bildirilmez, araç izni istenirse geri çevrilir: yalnız metin ve görsel alıp metin döndüren bir model gibi
 * kullanılır. Yöntem adları 22 Kas'ta `agy acp` 1.5.14'e karşı yoklandı (initialize, session/new, session/set_config_option).
 */

/** Alt sürecin kullanılan yüzü (testler sahtesini verir). */
export interface AcpChild {
  stdin: { write(chunk: string): unknown };
  stdout: { on(event: "data", fn: (chunk: Buffer | string) => void): unknown };
  stderr: { on(event: "data", fn: (chunk: Buffer | string) => void): unknown };
  on(event: "exit", fn: (code: number | null) => void): unknown;
  on(event: "error", fn: (err: Error) => void): unknown;
  kill(): unknown;
}
export type AcpSpawn = (command: string, args: readonly string[], cwd: string) => AcpChild;

/** Windows'ta .cmd/.bat yalnız kabukla açılır (Node 20+); argümanlar core'da kabuk karakterine karşı süzülür. */
export const needsShell = (command: string, platform: string = process.platform) => /\.(cmd|bat)$/i.test(command) && platform === "win32";

export const spawnAcp: AcpSpawn = (command, args, cwd) => spawn(command, [...args], { cwd, stdio: "pipe", windowsHide: true, shell: needsShell(command) });

/** Ajanın JSON-RPC hatası (kod + mesaj). */
export class AcpRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`ACP ${method}: ${message}`);
  }
}

/**
 * Ajan araç kullanmaya kalktı, oturum kesildi. Ayrı tür: hiçbir zaman yeniden denenmez (başlık ajandan gelir; "429" gibi
 * bir başlık geçici hata kalıbına uyup engellenen işi yeniden başlatmasın).
 */
export class AcpToolError extends Error {
  constructor(readonly title: string) {
    super(`agent tried to use a tool: ${title}`);
  }
}

export type AcpBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

interface ConfigOption {
  id: string;
  category?: string;
  currentValue?: string;
  options?: { value: string; name?: string }[];
}

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** Satır tabanlı JSON-RPC bağlantısı. Ajandan gelen istekler `onRequest`, bildirimler `onNotify` ile karşılanır. */
class Rpc {
  private next = 1;
  private buffer = "";
  private closed?: Error;
  private readonly pending = new Map<number, Pending>();
  stderr = "";

  constructor(
    private readonly child: AcpChild,
    private readonly onNotify: (method: string, params: Record<string, unknown>) => void,
    private readonly onRequest: (method: string, params: Record<string, unknown>) => unknown,
  ) {
    child.stdout.on("data", (chunk) => this.feed(String(chunk)));
    // Son 2000 karakter hata iletisinde kullanılır (giriş yapılmamış, model yok…).
    child.stderr.on("data", (chunk) => (this.stderr = (this.stderr + String(chunk)).slice(-2000)));
    child.on("exit", (code) => this.close(new Error(`process exited with code ${code}${this.stderr ? `: ${this.stderr.trim().split("\n").at(-1)}` : ""}`)));
    child.on("error", (err) => this.close(err));
  }

  private feed(chunk: string) {
    this.buffer += chunk;
    let at: number;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (line) this.handle(line);
    }
  }

  private handle(line: string) {
    let message: { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } };
    try {
      message = JSON.parse(line);
    } catch {
      return; // ajanın stdout'a düşen günlük satırı: protokol değil
    }
    if (message.method && message.id !== undefined) return this.answer(message.id, message.method, message.params ?? {});
    if (message.method) return this.onNotify(message.method, message.params ?? {});
    const waiting = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!waiting) return;
    this.pending.delete(message.id as number);
    if (message.error) waiting.reject(new AcpRpcError(waiting.method, message.error.code ?? 0, message.error.message ?? "error"));
    else waiting.resolve(message.result);
  }

  private answer(id: number | string, method: string, params: Record<string, unknown>) {
    let reply: Record<string, unknown>;
    try {
      reply = { result: this.onRequest(method, params) };
    } catch {
      reply = { error: { code: -32601, message: `method not supported: ${method}` } };
    }
    this.write({ jsonrpc: "2.0", id, ...reply });
  }

  private write(message: object) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  call<R>(method: string, params: object): Promise<R> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.next++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  close(err: Error) {
    if (this.closed) return;
    this.closed = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

/** Araç izni istenirse geri çevir: önce "reject" türünden bir seçenek, yoksa iptal. */
function refusePermission(params: Record<string, unknown>) {
  const options = (params.options as { optionId: string; kind?: string }[] | undefined) ?? [];
  const reject = options.find((o) => o.kind === "reject_once") ?? options.find((o) => o.kind === "reject_always");
  return { outcome: reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" } };
}

const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** İstenen çabaya en yakın düşünme seviyesi (yoksa bir alttaki, o da yoksa en yakın üstteki). */
export function nearestEffort(wanted: string, available: readonly string[]): string | undefined {
  if (available.includes(wanted)) return wanted;
  const rank = (v: string) => EFFORT_ORDER.indexOf(v);
  const known = available.filter((v) => rank(v) >= 0).sort((a, b) => rank(a) - rank(b));
  const w = rank(wanted);
  return known.filter((v) => rank(v) <= w).at(-1) ?? known[0];
}

export interface AcpSessionInfo {
  images: boolean;
  models: AcpModel[];
  efforts: string[];
}

/** Açık bir ACP oturumu: model/çaba ayarlanır, istemler sırayla gönderilir, iş bitince `close`. */
export class AcpSession {
  private text = "";
  private config: ConfigOption[] = [];
  private available: AcpModel[] = [];

  private constructor(
    private readonly rpc: Rpc,
    private readonly child: AcpChild,
    private readonly dir: string,
    private sessionId = "",
    readonly info: AcpSessionInfo = { images: false, models: [], efforts: [] },
  ) {}

  /** `signal` iptal edilirse bekleyen çağrılar "aborted" ile düşer ve süreç sonlanır (zaman aşımı). */
  static async open(backend: AcpBackend, spawnFn: AcpSpawn = spawnAcp, signal?: AbortSignal): Promise<AcpSession> {
    const dir = await mkdtemp(join(tmpdir(), "ys-acp-"));
    let session: AcpSession | undefined;
    let child: AcpChild;
    try {
      child = spawnFn(backend.command, backend.args, dir);
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      throw e;
    }
    const rpc = new Rpc(
      child,
      (method, params) => session?.notify(method, params),
      (method, params) => {
        if (method === "session/request_permission") return refusePermission(params);
        throw new Error(method);
      },
    );
    session = new AcpSession(rpc, child, dir);
    const opened = session;
    const abort = () => void opened.close(new Error("aborted"));
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const init = await rpc.call<{ agentCapabilities?: { promptCapabilities?: { image?: boolean } } }>("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      const created = await rpc.call<{ sessionId: string; configOptions?: ConfigOption[]; models?: { availableModels?: { modelId: string; name?: string }[] } }>("session/new", {
        cwd: dir,
        mcpServers: [],
      });
      session.sessionId = created.sessionId;
      session.config = created.configOptions ?? [];
      session.available = (created.models?.availableModels ?? []).map((m) => ({ id: m.modelId, name: m.name ?? m.modelId }));
      session.info.images = init?.agentCapabilities?.promptCapabilities?.image === true;
      session.refreshInfo();
      return session;
    } catch (e) {
      await session.close();
      throw e;
    }
  }

  private notify(method: string, params: Record<string, unknown>) {
    if (method !== "session/update") return;
    const update = params.update as { sessionUpdate?: string; content?: { type?: string; text?: string }; configOptions?: ConfigOption[]; title?: string } | undefined;
    // Ajan bir araç çağırmaya başladıysa (dosya okuma, komut, ağ) oturum hemen kesilir: istemin bir kısmı güvenilmez veridir
    // ve ajanın kendi izin ayarları bazı araçları sormadan çalıştırabilir. Burada yalnız metin cevabı beklenir.
    if (update?.sessionUpdate === "tool_call" || update?.sessionUpdate === "tool_call_update") {
      void this.close(new AcpToolError(String(update.title ?? "?").slice(0, 120)));
      return;
    }
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") this.text += update.content.text ?? "";
    if (update?.sessionUpdate === "config_option_update" && update.configOptions) this.setConfig(update.configOptions);
  }

  private setConfig(options: ConfigOption[]) {
    this.config = options;
    this.refreshInfo();
  }

  private option(category: string) {
    return this.config.find((o) => o.category === category);
  }

  /** Modeller: seçenek listesi (config option, kararlı) yoksa session/new'in model listesi. */
  private refreshInfo() {
    const model = this.option("model");
    this.info.models = model?.options?.length ? model.options.map((o) => ({ id: o.value, name: o.name ?? o.value })) : this.available;
    this.info.efforts = this.option("thought_level")?.options?.map((o) => o.value) ?? [];
  }

  /** Modeli (ve varsa düşünme seviyesini) seçer; ajan modeli sunmuyorsa hata. */
  async configure(model: string, effort?: string): Promise<void> {
    const option = this.option("model");
    if (option?.options?.some((o) => o.value === model)) {
      if (option.currentValue !== model) await this.setOption(option.id, model);
    } else if (this.available.some((m) => m.id === model)) {
      await this.rpc.call("session/set_model", { sessionId: this.sessionId, modelId: model });
    } else {
      throw new AcpRpcError("session/new", -32602, `model not offered: ${model}`);
    }
    const thought = this.option("thought_level");
    const level = effort && thought?.options ? nearestEffort(effort, thought.options.map((o) => o.value)) : undefined;
    if (thought && level && thought.currentValue !== level) await this.setOption(thought.id, level);
  }

  private async setOption(configId: string, value: string) {
    const out = await this.rpc.call<{ configOptions?: ConfigOption[] }>("session/set_config_option", { sessionId: this.sessionId, configId, value });
    if (out?.configOptions) this.setConfig(out.configOptions);
  }

  /** Bir tur: ajanın bu turda yazdığı metin ve bitiş nedeni. */
  async prompt(blocks: AcpBlock[]): Promise<{ text: string; stopReason: string }> {
    this.text = "";
    const out = await this.rpc.call<{ stopReason?: string }>("session/prompt", { sessionId: this.sessionId, prompt: blocks });
    return { text: this.text, stopReason: out?.stopReason ?? "end_turn" };
  }

  private closing?: Promise<void>;

  /** Süreci sonlandırır, geçici klasörü siler (iki kez çağrılırsa ilkini bekler). */
  close(reason = new Error("closed")): Promise<void> {
    this.closing ??= (async () => {
      this.rpc.close(reason);
      try {
        this.child.kill();
      } catch {
        // süreç zaten bitmiş
      }
      await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
    })();
    return this.closing;
  }
}

/**
 * Ajanın modellerini, düşünme seviyelerini ve görsel desteğini öğrenir: yalnız initialize + session/new (istem yok,
 * kota harcanmaz). Modeller sayfasındaki "Modelleri bul" düğmesi.
 */
export async function discoverAcp(backend: AcpBackend, spawnFn?: AcpSpawn, timeoutMs = 60_000): Promise<AcpSessionInfo> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const session = await AcpSession.open(backend, spawnFn, abort.signal);
    await session.close();
    return { ...session.info };
  } catch (e) {
    throw abort.signal.aborted ? new Error(`timeout after ${timeoutMs / 1000} s`) : e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Model yanıtından JSON'u çıkarır: kod çiti varsa içi, yoksa ilk { / [ ile son } / ] arası. Ayrıştırılamazsa hata
 * (çağıran düzeltme ister).
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[{[]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start < 0 || end < start) throw new SyntaxError("no JSON object in the answer");
  return JSON.parse(body.slice(start, end + 1));
}
