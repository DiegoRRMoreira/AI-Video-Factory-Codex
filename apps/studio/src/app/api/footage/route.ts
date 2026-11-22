import { createHash } from "node:crypto";
import { msg } from "@ys/core/messages";
import { FOOTAGE_TYPES, isFootageExt, sniffFootage } from "@ys/pipeline/light";
import { apiError } from "../../../lib/api";
import { store } from "../../../lib/server";

/** Yükleme sınırı (MB); büyük telefon videoları için YS_FOOTAGE_MAX_MB ile artırılır. */
const maxMb = () => Number(process.env.YS_FOOTAGE_MAX_MB) || 1024;

/** Gövdeyi sınırla okur: sınır aşılınca okuma kesilir (belleğe sınırsız dosya alınmaz). */
async function readLimited(req: Request, limit: number): Promise<Uint8Array | undefined> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return undefined;
    }
    parts.push(value);
  }
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * Footage yüklemesi (22 Kas): gövde dosyanın kendisidir (JSON değil; proxy yalnız bu uç noktada izinli video/resim
 * türlerine açar), adı `x-file-name` başlığında. Uzantı izin listesinden, ilk baytlar uzantının imzasına uymalı;
 * dosya içerik adresli bekleme alanına (uploads/footage/…) yazılır. Ölçüm (ffprobe) bölüm işinde yapılır: Stüdyo
 * Remotion ve ffmpeg yüklemez.
 */
export async function POST(req: Request) {
  let name: string;
  try {
    name = decodeURIComponent(req.headers.get("x-file-name") ?? "").replace(/[\\/]/g, "_").trim().slice(-120);
  } catch {
    name = "";
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!isFootageExt(ext)) return apiError(req, msg("api.footage.type", { name: name || "?" }));
  const limit = maxMb() * 1024 * 1024;
  const tooLarge = () => apiError(req, msg("api.footage.tooLarge", { name, mb: maxMb() }), 413);
  if (Number(req.headers.get("content-length")) > limit) return tooLarge();
  const bytes = await readLimited(req, limit);
  if (!bytes) return tooLarge();
  if (!sniffFootage(bytes.subarray(0, 16), ext)) return apiError(req, msg("api.footage.type", { name }));
  const key = `uploads/footage/${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${ext}`;
  await store().put(key, bytes, FOOTAGE_TYPES[ext]);
  return Response.json({ key, name, size: bytes.length });
}
