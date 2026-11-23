import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connectKairogen, kairogenData, kairogenDir, saveKairogenJson, type KairogenReply } from "../packages/media-gateway/src/providers/kairogen-client.ts";
import { mapKairogenReference } from "../packages/media-gateway/src/providers/kairogen.ts";

const command = process.argv[2] ?? "models";
if (command === "reference") {
  await mapKairogenReference(await readFile(process.argv[3]!), process.argv[4]!);
  console.log("Reference mapped by content hash. No media uploaded and no generation started.");
} else if (command === "connect") {
  const clientResponse = await fetch("https://api.kairogen.ai/oauth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "AI Video Factory Local", grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"], response_types: [], token_endpoint_auth_method: "none", scope: "kairogen:read kairogen:generate" }),
  });
  if (!clientResponse.ok) throw new Error(`Kairogen client registration failed (${clientResponse.status}).`);
  const registration = await clientResponse.json();
  await saveKairogenJson("pending-client.json", registration);
  const response = await fetch("https://api.kairogen.ai/oauth/device_authorization", { method: "POST", body: new URLSearchParams({ client_id: registration.client_id, scope: "kairogen:read kairogen:generate", resource: "https://mcp.kairogen.ai" }) });
  if (!response.ok) throw new Error(`Kairogen device authorization failed (${response.status}).`);
  const device = await response.json();
  await saveKairogenJson("device.json", device);
  console.log(`Open ${device.verification_uri_complete ?? device.verification_uri}\nCode: ${device.user_code}\nAfter approving, run pnpm kairogen finish.`);
} else if (command === "finish") {
  const registration = JSON.parse(await readFile(join(kairogenDir(), "pending-client.json"), "utf8"));
  const device = JSON.parse(await readFile(join(kairogenDir(), "device.json"), "utf8"));
  const response = await fetch("https://api.kairogen.ai/oauth/token", { method: "POST", body: new URLSearchParams({ client_id: registration.client_id, device_code: device.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) });
  if (!response.ok) throw new Error(`Kairogen authorization is pending or expired (${response.status}).`);
  const tokens = await response.json();
  await saveKairogenJson("client.json", registration);
  await saveKairogenJson("tokens.json", { ...tokens, expires_at: Date.now() / 1000 + tokens.expires_in });
  console.log("Kairogen connected. Credentials saved locally; no generation was started.");
} else {
  const client = await connectKairogen();
  try {
    const name = command === "models" ? "list_models" : command === "account" ? "get_me_context" : command === "gallery" ? "list_my_gallery" : command === "status" || command === "download" ? "get_generation" : command === "quote" ? "estimate_cost" : "";
    if (!name) throw new Error("Commands: connect, finish, models [search], gallery, status <id>, quote <arguments.json>");
    const args = command === "models" ? { type: process.argv[4] ?? "video", ...(process.argv[3] ? { search: process.argv[3] } : {}) } : command === "status" || command === "download" ? { generation_id: process.argv[3], wait_for_completion: false } : command === "quote" ? JSON.parse(await readFile(process.argv[3]!, "utf8")) : command === "account" ? {} : { limit: 1 };
    const raw = await client.callTool({ name, arguments: args });
    await saveKairogenJson(`${command}-response.json`, raw);
    const result = kairogenData(raw as KairogenReply);
    await saveKairogenJson(`${command}-latest.json`, result);
    if (command === "download") {
      const url = (result.output_urls as string[] | undefined)?.[0];
      if (String(result.status).toLowerCase() !== "completed" || !url || new URL(url).protocol !== "https:") throw new Error("No completed HTTPS media output is available.");
      const media = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!media.ok || !/^(video|image)\//.test(media.headers.get("content-type") ?? "")) throw new Error("Kairogen media download failed.");
      await writeFile(process.argv[4]!, new Uint8Array(await media.arrayBuffer()));
      console.log(`Existing output downloaded to ${process.argv[4]}; no generation started.`);
    } else console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); }
}
