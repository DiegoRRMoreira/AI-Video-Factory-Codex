import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function workspaceDir(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}
export const KAIROGEN_DIR = join(workspaceDir(), ".data", "kairogen");
export const kairogenDir = () => resolve(process.env.KAIROGEN_AUTH_DIR ?? KAIROGEN_DIR);
type Tokens = { access_token: string; refresh_token?: string; expires_in?: number; expires_at?: number };
let refreshing: Promise<string> | undefined;

export async function saveKairogenJson(name: string, data: unknown, dir = kairogenDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(`${path}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export async function kairogenToken(fetchFn: typeof fetch = fetch): Promise<string> {
  if (process.env.KAIROGEN_ACCESS_TOKEN) return process.env.KAIROGEN_ACCESS_TOKEN;
  const dir = kairogenDir();
  let tokens: Tokens;
  try { tokens = JSON.parse(await readFile(join(dir, "tokens.json"), "utf8")); }
  catch { throw new Error("Kairogen is not connected. Run pnpm kairogen connect."); }
  if (!tokens.expires_at || tokens.expires_at > Date.now() / 1000 + 60) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("Kairogen login expired. Run pnpm kairogen connect.");
  if (!refreshing) refreshing = (async () => {
    const client = JSON.parse(await readFile(join(dir, "client.json"), "utf8"));
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token! });
    if (client.client_secret) body.set("client_secret", client.client_secret);
    const response = await fetchFn("https://api.kairogen.ai/oauth/token", { method: "POST", body, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Kairogen token refresh failed (${response.status}). Reconnect your account.`);
    const next = await response.json() as Tokens;
    if (!next.access_token) throw new Error("Kairogen returned no access token.");
    await saveKairogenJson("tokens.json", { ...tokens, ...next, expires_at: Date.now() / 1000 + (next.expires_in ?? 3600) }, dir);
    return next.access_token;
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

/** The SDK handles Streamable HTTP sessions, SSE responses and protocol negotiation. */
export async function connectKairogen(fetchFn: typeof fetch = fetch): Promise<Client> {
  const token = await kairogenToken(fetchFn);
  const client = new Client({ name: "ai-video-factory", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.kairogen.ai/mcp"), {
    fetch: fetchFn,
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  try { await client.connect(transport, { timeout: 30_000 }); }
  catch { await client.close().catch(() => {}); throw new Error("Could not connect to Kairogen MCP. Check your login and network."); }
  return client;
}

export interface KairogenReply { isError?: boolean; structuredContent?: Record<string, unknown>; content?: unknown[] }
export function kairogenData(result: KairogenReply): Record<string, unknown> {
  if (result.isError) {
    const text = result.content?.find((block) => (block as { type?: string }).type === "text") as { text?: string } | undefined;
    throw new Error(`Kairogen refused the request: ${text?.text?.slice(0, 800) ?? "inspect account/model settings before retrying"}`);
  }
  if (result.structuredContent) return result.structuredContent;
  for (const block of result.content ?? []) {
    const item = block as { type?: string; text?: string };
    if (item.type === "text" && item.text) {
      try { const data = JSON.parse(item.text); if (data && typeof data === "object") return data; } catch { /* Other text blocks are presentation only. */ }
    }
  }
  throw new Error("Kairogen returned no structured result.");
}
