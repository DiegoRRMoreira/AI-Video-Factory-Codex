import { discoverAcpBackend } from "@ys/pipeline/acp";
import { errorResponse, readJson } from "../../../../../lib/api";
import { store } from "../../../../../lib/server";

export const maxDuration = 120;

/** Ajanın modellerini bulur ve kaydına yazar (istem gönderilmez); ajan listesi ve model seçimi birlikte döner. */
export async function POST(req: Request) {
  try {
    const { id } = await readJson<{ id?: unknown }>(req);
    return Response.json(await discoverAcpBackend(store(), id));
  } catch (e) {
    return errorResponse(req, e);
  }
}
