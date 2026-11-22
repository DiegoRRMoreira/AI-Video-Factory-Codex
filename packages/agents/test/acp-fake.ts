import { EventEmitter } from "node:events";
import type { AcpChild, AcpSpawn } from "../src/acp.ts";

/** Sahte ACP ajanının bir istem turundaki davranışı. */
export interface FakeTurn {
  /** Parça parça gönderilen yanıt metni. */
  text?: string;
  stop?: string;
  /** JSON-RPC hatasıyla yanıtla. */
  error?: { code: number; message: string };
  /** Önce araç izni iste (istemci geri çevirmeli). */
  permission?: { optionId: string; kind: string }[];
  /** Süreç bu turda çöker. */
  exit?: number;
  /** Önce bir araç çağrısı bildirir (başlığı; boşsa başlıksız tool_call_update). */
  tool?: string;
  /** Çökerken stderr'e bir şey yazmaz. */
  quiet?: boolean;
  /** Hiç yanıt verme (zaman aşımı). */
  hang?: boolean;
}

export interface FakeOptions {
  image?: boolean;
  /** configOptions ile model/çaba seçeneği sun (agy gibi); yoksa yalnız models.availableModels. */
  config?: boolean;
  models?: string[];
  efforts?: string[];
  turns?: FakeTurn[];
  /** initialize'a hata ile yanıt ver. */
  initError?: { code: number; message: string };
  /** session/new'e hiç yanıt verme. */
  hangOpen?: boolean;
  /** Açılışta süreç hatası (ENOENT gibi). */
  spawnError?: NodeJS.ErrnoException;
  /** spawn çağrısı eşzamanlı fırlatır. */
  spawnThrows?: boolean;
  /** Protokol dışı stdout satırları ve ajanın kendi isteği (fs/read). */
  noise?: boolean;
  /** En yalın yanıtlar: params'sız mesajlar, adsız seçenekler, model listesi yok, ayar yanıtı boş. */
  bare?: boolean;
}

export interface FakeAgent {
  spawn: AcpSpawn;
  /** İstemciden gelen her mesaj (istekler ve izin yanıtları). */
  received: { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }[];
  spawned: { command: string; args: readonly string[]; cwd: string }[];
  killed: number;
}

export function fakeAcp(opts: FakeOptions = {}): FakeAgent {
  const agent: FakeAgent = { spawn: undefined as unknown as AcpSpawn, received: [], spawned: [], killed: 0 };
  const turns = [...(opts.turns ?? [])];
  const models = opts.models ?? ["m1", "m2"];
  const efforts = opts.efforts ?? ["low", "medium", "high"];
  agent.spawn = (command, args, cwd) => {
    if (opts.spawnThrows) throw new Error("spawn blew up");
    agent.spawned.push({ command, args, cwd });
    const child = new EventEmitter() as EventEmitter & AcpChild;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let dead = false;
    let model = models[0]!;
    let effort = efforts[0]!;
    const send = (m: object) => !dead && stdout.emit("data", Buffer.from(`${JSON.stringify(m)}\n`));
    const config = () => [
      { id: "model", category: "model", type: "select", currentValue: model, options: models.map((v) => ({ value: v, name: v.toUpperCase() })) },
      { id: "thought_level", category: "thought_level", type: "select", currentValue: effort, options: efforts.map((v) => ({ value: v })) },
    ];
    const die = (code: number, quiet = false) => {
      if (!quiet) stderr.emit("data", "warming up\nfatal: lost connection\n");
      child.emit("exit", code);
      dead = true;
    };
    Object.assign(child, {
      stdout,
      stderr,
      kill: () => {
        agent.killed++;
        dead = true;
      },
      stdin: {
        write: (line: string) => {
          for (const raw of line.split("\n").filter(Boolean)) {
            const m = JSON.parse(raw);
            agent.received.push(m);
            if (m.method) setImmediate(() => handle(m));
          }
        },
      },
    });
    const handle = (m: { id: number; method: string; params: Record<string, unknown> }) => {
      if (dead) return;
      const reply = (result: unknown) => send({ jsonrpc: "2.0", id: m.id, result });
      switch (m.method) {
        case "initialize":
          if (opts.initError) return send({ jsonrpc: "2.0", id: m.id, error: opts.initError });
          if (opts.noise) {
            stdout.emit("data", "Agent starting...\n\n");
            send({ jsonrpc: "2.0", id: "fs1", method: "fs/read_text_file", params: { path: "x" } });
            send({ jsonrpc: "2.0", id: 999, result: {} });
            send({ jsonrpc: "2.0", method: "other/notice", params: {} });
          }
          if (opts.bare) {
            send({ jsonrpc: "2.0", id: "r2", method: "fs/write_text_file" });
            send({ jsonrpc: "2.0", method: "session/update" });
            send({ jsonrpc: "2.0", id: "zz", result: {} });
          }
          return reply({ protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: opts.image ?? true } } });
        case "session/new":
          if (opts.hangOpen) return;
          if (opts.bare) return reply({ sessionId: "s1", configOptions: [{ id: "model", category: "model", currentValue: "m1", options: models.map((value) => ({ value })) }] });
          return reply({
            sessionId: "s1",
            models: { availableModels: models.map((id) => ({ modelId: id, ...(id === "m2" ? {} : { name: `Model ${id}` }) })), currentModelId: model },
            ...(opts.config ? { configOptions: config() } : {}),
          });
        case "session/set_config_option":
          if (opts.bare) return reply({});
          if (m.params.configId === "model") model = String(m.params.value);
          else effort = String(m.params.value);
          // Ajan değişikliği ayrıca bildirir (config_option_update) ve yanıtta da döner.
          send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "config_option_update", configOptions: config() } } });
          return reply({ configOptions: config() });
        case "session/set_model":
          model = String(m.params.modelId);
          return reply({});
        case "session/prompt": {
          const turn = turns.shift() ?? { text: "{}" };
          if (turn.hang) return;
          if (turn.exit !== undefined) return die(turn.exit, turn.quiet);
          if (turn.error) return send({ jsonrpc: "2.0", id: m.id, error: turn.error });
          if (turn.tool !== undefined)
            send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: turn.tool ? { sessionUpdate: "tool_call", toolCallId: "t1", title: turn.tool } : { sessionUpdate: "tool_call_update", toolCallId: "t1" } } });
          if (turn.permission) send({ jsonrpc: "2.0", id: "perm1", method: "session/request_permission", params: { sessionId: "s1", options: turn.permission } });
          if (opts.bare) {
            send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "image" } } } });
            send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text" } } } });
          }
          const text = turn.text ?? "";
          const half = Math.floor(text.length / 2);
          for (const part of [text.slice(0, half), text.slice(half)])
            send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: part } } } });
          send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } } } });
          return reply(turn.stop === "none" ? undefined : { stopReason: turn.stop ?? "end_turn" });
        }
        default:
          return send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "nope" } });
      }
    };
    if (opts.spawnError) setImmediate(() => child.emit("error", opts.spawnError));
    return child;
  };
  return agent;
}
