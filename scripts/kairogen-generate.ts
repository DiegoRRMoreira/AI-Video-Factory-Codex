import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { generateKairogenMedia } from "../packages/media-gateway/src/providers/kairogen.ts";
import { connectKairogen, kairogenData, type KairogenReply } from "../packages/media-gateway/src/providers/kairogen-client.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv[argv.indexOf(name) + 1];
const input = argv[0];
const cap = Number(argv.includes("--max-credits") ? flag("--max-credits") : NaN);
if (!input || !Number.isSafeInteger(cap) || cap <= 0) throw new Error("Usage: pnpm kairogen:generate request.json --max-credits N --out out/reel [--submit]");
const request = JSON.parse(await readFile(resolve(input), "utf8")) as Record<string, unknown>;
if (typeof request.model !== "string" || typeof request.prompt !== "string") throw new Error("The request must contain model and prompt.");
const type = argv.includes("--image") ? "image" : "video";
if (argv.includes("--submit")) {
  let last = "";
  const result = await generateKairogenMedia(request, { model: request.model, type, maxCredits: cap }, {
    fetch,
    onProgress: (message) => { if (message !== last) { console.log(message); last = message; } },
  });
  const dir = resolve(argv.includes("--out") ? flag("--out")! : "out/kairogen");
  await mkdir(dir, { recursive: true });
  for (const [i, file] of result.files.entries()) {
    const ext = ({ "video/mp4": "mp4", "video/webm": "webm", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as Record<string, string>)[file.mimeType];
    if (!ext) throw new Error(`Unsupported delivery media type: ${file.mimeType}`);
    await writeFile(join(dir, `source-${i + 1}.${ext}`), file.bytes);
  }
  await writeFile(join(dir, "generation.json"), JSON.stringify(result.providerMeta, null, 2));
  console.log(`Saved in ${dir}. Credits: ${result.providerMeta?.credits}`);
} else {
  const client = await connectKairogen();
  try {
    const result = kairogenData(await client.callTool({ name: "estimate_cost", arguments: request }) as KairogenReply);
    console.log(JSON.stringify(result, null, 2));
    console.log(`Configured cap: ${cap} credits. No generation started. Add --submit to generate.`);
  } finally { await client.close(); }
}
