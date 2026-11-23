import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverAcp } from "../packages/agents/src/acp.ts";
import { AGENT_ROLES, acpChoice, type AcpBackend, type ModelSettings } from "../packages/core/src/models.ts";
import { FsAssetStore } from "../packages/storage/src/index.ts";
import { loadAcpSettings, saveAcpSettings, saveModelSettings } from "../packages/pipeline/src/settings.ts";

const root = resolve(import.meta.dirname, "..");
const backend: AcpBackend = { id: "codex", label: "Codex local (ACP)", command: process.execPath, args: [resolve(root, "node_modules/@agentclientprotocol/codex-acp/dist/index.js")], models: [], efforts: [], images: false };
const found = await discoverAcp(backend);
const requested = process.argv[2];
if (requested && !found.models.some((m) => m.id === requested)) throw new Error("Requested model is not offered by this Codex login.");
const commandLine = [backend.command, ...backend.args].join(" ");
const envFile = resolve(root, ".env");
let env: string;
try { env = await readFile(envFile, "utf8"); }
catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  await copyFile(resolve(root, ".env.example"), envFile);
  env = await readFile(envFile, "utf8");
}
const old = /^YS_ACP_COMMANDS=(.*)$/m.exec(env)?.[1]?.replace(/^['"]|['"]$/g, "") ?? "";
const allowed = [...new Set([...old.split(";").filter(Boolean), commandLine])].join(";");
env = env.replace(/^YS_ACP_COMMANDS=.*\r?\n?/m, "");
await writeFile(envFile, `${env.trimEnd()}\nYS_ACP_COMMANDS=${allowed}\n`);
process.env.YS_ACP_COMMANDS = allowed;
const store = new FsAssetStore(resolve(root, ".data/assets"));
const current = await loadAcpSettings(store);
await saveAcpSettings(store, { backends: [...current.backends.filter((b) => b.id !== "codex"), { ...backend, ...found }] });
if (requested) {
  const settings = Object.fromEntries(Object.keys(AGENT_ROLES).map((role) => [role, acpChoice("codex", requested)])) as ModelSettings;
  await saveModelSettings(store, settings);
  console.log(`All ${Object.keys(settings).length} production roles now use Codex ${requested}. Restart Studio.`);
}
console.log(JSON.stringify(found, null, 2));
