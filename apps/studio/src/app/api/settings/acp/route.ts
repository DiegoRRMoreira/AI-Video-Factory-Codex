import { loadAcpSettings, loadModelSettings, saveAcpSettings } from "@ys/pipeline/light";
import { errorResponse, readJson } from "../../../../lib/api";
import { store } from "../../../../lib/server";

/** Tanımlı ACP ajanları (Modeller sayfası). */
export async function GET() {
  return Response.json(await loadAcpSettings(store()));
}

/** Ajan listesini yazar; silinen bir ajanın modeline bağlı seçimler de düşer, ikisi birlikte döner. */
export async function PUT(req: Request) {
  try {
    const acp = await saveAcpSettings(store(), await readJson(req));
    return Response.json({ acp, models: await loadModelSettings(store()) });
  } catch (e) {
    return errorResponse(req, e);
  }
}
