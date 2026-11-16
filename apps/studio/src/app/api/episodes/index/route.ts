import { msg } from "@ys/core/messages";
import { apiError, errorResponse, readJson } from "../../../../lib/api";
import { repo } from "../../../../lib/server";

/** Yalnız türetilmiş özetleri yeniden kurar; bölüm içeriği ve üretim değişmez. */
export async function POST(req: Request) {
  let body: { rebuild?: boolean };
  try { body = await readJson<{ rebuild?: boolean }>(req); }
  catch (error) { return errorResponse(req, error); }
  if (body.rebuild !== true) return apiError(req, msg("api.badJson"));
  try {
    return Response.json(await repo().summaries(true));
  } catch (error) { return errorResponse(req, error, 500); }
}
