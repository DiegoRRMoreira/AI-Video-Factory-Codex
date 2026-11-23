import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Capability } from "@ys/core";
import { pollUntil, requestBytes } from "../http.ts";
import { afterSubmit, promptWithAvoid, SubmittedJobError, type GenerateContext, type GenerationRequest, type GenerationResult, type ProviderAdapter, type ProviderLimits } from "../types.ts";
import { connectKairogen, kairogenData, kairogenDir, saveKairogenJson, type KairogenReply } from "./kairogen-client.ts";

export interface KairogenModelSpec {
  model: string;
  type: "video" | "image";
  capabilities: Capability[];
  limits: ProviderLimits;
  /** Upper reservation, in Kairogen credits, for one output. Live quotes must fit it. */
  maxCredits: number;
  /** User-configured accounting conversion; not a provider price or exchange rate. */
  usdPerCredit: number;
  params?: Record<string, unknown>;
}

interface Job { state: "submitting" | "submitted"; generationId?: string; credits: number }
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** URLs are only reused for byte-identical media previously generated or explicitly mapped. */
async function referenceUrl(bytes: Uint8Array): Promise<string> {
  try {
    const ref = JSON.parse(await readFile(join(kairogenDir(), `ref-${sha(bytes)}.json`), "utf8"));
    if (typeof ref.url === "string" && new URL(ref.url).protocol === "https:") return ref.url;
  } catch { /* Missing provenance is not a reason to discard a reference. */ }
  throw new Error("Kairogen needs a public HTTPS URL for this reference. Generate the keyframe with Kairogen, or map it with pnpm kairogen reference <local-file> <https-url>.");
}

export async function mapKairogenReference(bytes: Uint8Array, url: string): Promise<void> {
  if (new URL(url).protocol !== "https:") throw new Error("Kairogen references require HTTPS URLs.");
  await saveKairogenJson(`ref-${sha(bytes)}.json`, { url });
}

export class KairogenAdapter implements ProviderAdapter {
  readonly local = false;
  readonly id: string;
  readonly capabilities: readonly Capability[];
  readonly limits: ProviderLimits;
  readonly qualityPrior = 0.85;
  readonly price: { unit: "per_output"; usd: number };

  constructor(readonly spec: KairogenModelSpec) {
    if (!/^[a-zA-Z0-9._-]+$/.test(spec.model)) throw new Error("Invalid Kairogen model key.");
    if (!Number.isSafeInteger(spec.maxCredits) || spec.maxCredits <= 0 || !Number.isFinite(spec.usdPerCredit) || spec.usdPerCredit <= 0) throw new Error("Kairogen requires positive maxCredits and usdPerCredit accounting settings.");
    const allowed = spec.type === "video" ? ["t2v", "i2v"] : ["t2i", "i2i_multiref"];
    if (!spec.capabilities.length || spec.capabilities.some((cap) => !allowed.includes(cap))) throw new Error("Invalid Kairogen capabilities.");
    this.id = `kairogen:${spec.model}`;
    this.capabilities = spec.capabilities;
    this.limits = spec.limits;
    this.price = { unit: "per_output", usd: spec.maxCredits * spec.usdPerCredit };
  }

  async arguments(req: GenerationRequest): Promise<Record<string, unknown>> {
    if (!this.capabilities.includes(req.capability)) throw new Error("Unsupported Kairogen capability.");
    // Only configured model parameters are forwarded. Runtime params cannot change the model or billing guard.
    const args: Record<string, unknown> = { ...this.spec.params, model: this.spec.model, prompt: promptWithAvoid(req.prompt, req.negativePrompt), quantity: 1 };
    if (req.aspectRatio) args.aspect_ratio = req.aspectRatio;
    if (req.durationSec !== undefined && this.spec.type === "video") args.duration_seconds = req.durationSec;
    if (req.seed !== undefined) args.seed = req.seed;
    if (this.spec.type === "video" && "generate_audio" in (this.spec.params ?? {})) args.generate_audio = req.withAudio ?? false;
    const images: string[] = [];
    const videos: string[] = [];
    const audios: string[] = [];
    for (const ref of req.refs ?? []) {
      const url = await referenceUrl(ref.bytes);
      if (ref.role === "first_frame" && this.spec.type === "video") args.first_frame_url = url;
      else if (ref.role === "last_frame" && this.spec.type === "video") args.last_frame_url = url;
      else if (ref.role === "source_video") videos.push(url);
      else if (ref.role === "source_audio") audios.push(url);
      else images.push(url);
    }
    if (images.length) args.reference_image_urls = images;
    if (videos.length) args.reference_video_urls = videos;
    if (audios.length) args.reference_audio_urls = audios;
    if ((req.capability === "i2v" || req.capability === "i2i_multiref") && !(req.refs?.length)) throw new Error("Kairogen reference-based generation requires a reference.");
    if (req.withAudio && this.spec.type === "video" && !("generate_audio" in args)) throw new Error("Native audio has not been configured for this Kairogen model.");
    return args;
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    const args = await this.arguments(req);
    const result = await generateKairogenMedia(args, this.spec, ctx);
    return { ...result, providerMeta: { ...result.providerMeta, reservedUsd: this.price.usd } };
  }
}

/** Credit-native entry point for an explicitly requested production, without inventing a USD exchange rate. */
export async function generateKairogenMedia(
  args: Record<string, unknown>,
  spec: Pick<KairogenModelSpec, "model" | "type" | "maxCredits">,
  ctx: GenerateContext,
): Promise<GenerationResult> {
    if (args.model !== spec.model || !Number.isSafeInteger(spec.maxCredits) || spec.maxCredits <= 0) throw new Error("Invalid Kairogen model or credit cap.");
    const dir = kairogenDir();
    await mkdir(dir, { recursive: true });
    // Account-wide serialization across CLI/Studio processes, as required by generate_video.
    const lockPath = join(dir, "generation.lock");
    const lock = await pollUntil(async () => {
      try { return await open(lockPath, "wx", 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return undefined; throw e; }
    }, { intervalMs: 1000, timeoutMs: 25 * 60_000, signal: ctx.signal });
    let client: Awaited<ReturnType<typeof connectKairogen>> | undefined;
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
      client = await connectKairogen(ctx.fetch);
      const call = async (name: string, values: Record<string, unknown>) => kairogenData(await client!.callTool({ name, arguments: values }, undefined, { signal: ctx.signal, timeout: 120_000 }) as KairogenReply);
      const account = await call("get_me_context", {});
      const userId = (account.user as { id?: string } | undefined)?.id;
      if (!userId) throw new Error("Kairogen did not identify the connected account.");
      const jobName = `job-${sha(JSON.stringify({ userId, args }))}.json`;
      let job: Job | undefined;
      try { job = JSON.parse(await readFile(join(dir, jobName), "utf8")); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (job && !job.generationId) throw new SubmittedJobError("Kairogen submission has an unknown outcome. Recover its generation ID before retrying; no duplicate was submitted.");
      if (!job) {
        // Catalog lookup and quote are read-only; neither starts media generation.
        const catalog = await call("list_models", { type: spec.type, search: spec.model });
        if (!Array.isArray(catalog.models) || !catalog.models.some((model: { model_key?: string }) => model.model_key === spec.model)) throw new Error("Kairogen model is not in the live catalog.");
        const quote = await call("estimate_cost", args);
        const credits = quote.credit_cost;
        if (!Number.isSafeInteger(credits) || (credits as number) < 0) throw new Error("Kairogen returned no valid credit_cost quote. No generation started.");
        if ((credits as number) > spec.maxCredits) throw new Error(`Kairogen quote (${credits} credits) exceeds the configured per-output cap (${spec.maxCredits}).`);
        job = { state: "submitting", credits: credits as number };
        await saveKairogenJson(jobName, job, dir);
        await afterSubmit(undefined, async () => {
          const submitted = await call(spec.type === "video" ? "generate_video" : "generate_image", { ...args, expected_credits: credits, wait_for_completion: false });
          if (typeof submitted.generation_id !== "string" || !submitted.generation_id) throw new Error("Kairogen did not return a generation_id; inspect the account before retrying.");
          job = { state: "submitted", generationId: submitted.generation_id, credits: credits as number };
          await saveKairogenJson(jobName, job, dir);
        });
      }
      const pending = job!;
      return await afterSubmit(pending.generationId, async () => {
        const completed = await pollUntil(async () => {
          const result = await call("get_generation", { generation_id: pending.generationId, wait_for_completion: false });
          ctx.onProgress?.(`Kairogen ${pending.generationId}: ${result.status ?? "pending"}`);
          const status = String(result.status).toLowerCase();
          if (["failed", "error", "cancelled", "canceled"].includes(status)) throw new Error("Kairogen generation failed. Its job ID was retained for recovery.");
          return ["completed", "succeeded", "success"].includes(status) ? result : undefined;
        }, { intervalMs: 5000, timeoutMs: 20 * 60_000, signal: ctx.signal });
        const urls = completed.output_urls;
        if (!Array.isArray(urls) || !urls.length || urls.some((url) => typeof url !== "string" || new URL(url).protocol !== "https:")) throw new Error("Kairogen returned no valid HTTPS output_urls.");
        const files = [];
        for (const url of urls as string[]) {
          // Do not send OAuth credentials to the media CDN.
          const file = await requestBytes(ctx.fetch, url, { signal: ctx.signal });
          if (!file.mimeType.startsWith(`${spec.type}/`)) throw new Error("Kairogen media type does not match the requested output.");
          if (spec.type === "image") await mapKairogenReference(file.bytes, url);
          files.push(file);
        }
        return { files, providerMeta: { generationId: pending.generationId, credits: pending.credits } };
      });
    } finally {
      await client?.close().catch(() => {});
      await lock.close();
      await unlink(lockPath);
    }
}
