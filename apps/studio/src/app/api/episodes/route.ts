import { BudgetTier, LineStyle, STYLE_AUTO, STYLE_CUSTOM, stylePackOf } from "@ys/core";
import { cleanSeries, loadCustomStyle, newEpisodeState, UPLOAD_KEY, withBankChoice, youtubeInput, type EpisodeInput, type MotionMode } from "@ys/pipeline/light";
import { msg } from "@ys/core/messages";
import { apiError, errorResponse, readJson } from "../../../lib/api";
import { repo, startJob, store } from "../../../lib/server";
import { filterLibrary, libraryFilters, LIBRARY_QUEUES } from "../../../lib/library";

export async function GET(req?: Request) {
  const list = await repo().summaries();
  const query = req && new URL(req.url).searchParams;
  if (query?.size) {
    const offset = Number(query.get("offset") ?? 0), limit = Number(query.get("limit") ?? 20);
    const status = query.get("status"), queue = query.get("queue");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || status && !["running", "stalled", "waiting", "error", "done", "idle"].includes(status)) return apiError(req!, msg("api.badJson"));
    if (queue && !LIBRARY_QUEUES.includes(queue as typeof LIBRARY_QUEUES[number])) return apiError(req!, msg("api.badJson"));
    const episodes = filterLibrary(list.episodes, libraryFilters(Object.fromEntries(query)));
    return Response.json({ episodes: episodes.slice(offset, offset + limit), total: episodes.length, offset, limit, notices: list.notices });
  }
  const episodes = list.episodes;
  return Response.json(
    episodes.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      topic: e.input.topic,
      title: e.title,
      lang: e.input.lang,
      done: Object.keys(e.done),
      waitingFor: e.waitingFor,
      hasVideo: Boolean(e.render),
    })),
  );
}

interface CreateBody {
  topic: string;
  lang: string;
  minutes: number;
  tier: string;
  motionMode: MotionMode;
  voiceId?: string;
  styleHint?: string;
  customStyleId?: string;
  budgetUsd: number;
  vertical?: boolean;
  qa?: boolean;
  realism?: boolean;
  sideViews?: boolean;
  reverseViews?: boolean;
  setDressing?: boolean;
  captions?: boolean;
  sfx?: boolean;
  music?: boolean;
  short?: boolean;
  /** Karakter bankasından sunucu ve kadroya eklenecekler (kütüphane kimlikleri). */
  presenter?: string;
  bankCast?: string[];
  lineStyle?: string;
  stylePack?: string;
  series?: string;
  /** Kendi görüntünden Short (footage modu): yüklenmiş dosyalar (api/footage), süre ve seçenekler. */
  footage?: { uploads?: unknown; sec?: unknown; narration?: unknown; transcribe?: unknown; texts?: unknown };
  /** YouTube'dan Short: adres, aday sayısı, Short süresi, konuşma tanıma ve hak onayı. */
  youtube?: { url?: unknown; count?: unknown; minSec?: unknown; maxSec?: unknown; transcribe?: unknown; rights?: unknown };
}

const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));

/**
 * YouTube analiz bölümü: adres doğrulanır (yalnız kanonik adres yt-dlp'ye gider), kullanıcı hakkını onaylamalı. İş hemen
 * başlar ve onay beklemeden rapora kadar gider; Short'lar rapordan seçilir.
 */
async function createYoutube(req: Request, body: CreateBody): Promise<Response> {
  const y = body.youtube!;
  if (y.rights !== true) return apiError(req, msg("api.youtube.rights"));
  const budget = Number(body.budgetUsd ?? 5);
  if (!Number.isFinite(budget) || budget <= 0) return apiError(req, msg("api.budget"));
  try {
    const counts = [num(y.count), num(y.minSec), num(y.maxSec)].map((n) => (n !== undefined && Number.isFinite(n) ? n : undefined));
    const youtube = youtubeInput({ url: typeof y.url === "string" ? y.url : "", count: counts[0], minSec: counts[1], maxSec: counts[2], transcribe: y.transcribe !== false });
    const lang = typeof body.lang === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.lang) ? body.lang : "tr";
    const state = newEpisodeState({
      topic: typeof body.topic === "string" && body.topic.trim() ? body.topic.trim().slice(0, 300) : "YouTube",
      lang,
      targetSec: 60,
      tier: BudgetTier.catch("standard").parse(body.tier),
      aiClipRatio: 0,
      budgetUsd: budget,
      autoApprove: false,
      captions: body.captions !== false,
      sfx: body.sfx !== false,
      music: body.music !== false,
      youtube,
      width: 1080,
      height: 1920,
      fps: 30,
    });
    await repo().save(state);
    startJob(state.id, "job.youtube", ["episode", "run", state.id]);
    return Response.json({ id: state.id });
  } catch (e) {
    return errorResponse(req, e);
  }
}

/**
 * Footage bölümü: yüklenmiş dosyalar bekleme alanından bölüme işin ilk aşamasında alınır (ölçüm orada). Dikey 1080×1920,
 * kurgu onayında durur (senaryo kapısı), konu isteğe bağlı kısa bilgidir.
 */
async function createFootage(req: Request, body: CreateBody): Promise<Response> {
  const f = body.footage;
  const raw: unknown[] = Array.isArray(f?.uploads) ? f.uploads : [];
  const uploads = raw.flatMap((u) => {
    const { key, name } = (u ?? {}) as { key?: unknown; name?: unknown };
    return typeof key === "string" && UPLOAD_KEY.test(key) && typeof name === "string" ? [{ key, name: name.slice(-120) }] : [];
  });
  if (!uploads.length || uploads.length !== raw.length || uploads.length > 20) return apiError(req, msg("api.footage.uploads"));
  for (const u of uploads) if (!(await store().list(u.key)).includes(u.key)) return apiError(req, msg("api.footage.uploads"));
  const sec = Number(f!.sec ?? 30);
  if (!Number.isFinite(sec) || sec < 15 || sec > 180) return apiError(req, msg("api.footage.sec"));
  const budget = Number(body.budgetUsd ?? 5);
  if (!Number.isFinite(budget) || budget <= 0) return apiError(req, msg("api.budget"));
  const texts = (Array.isArray(f!.texts) ? f!.texts : []).filter((t): t is string => typeof t === "string" && Boolean(t.trim())).map((t) => t.trim().slice(0, 60)).slice(0, 8);
  const lang = typeof body.lang === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.lang) ? body.lang : "tr";
  const input: EpisodeInput = {
    topic: typeof body.topic === "string" && body.topic.trim() ? body.topic.trim().slice(0, 300) : "Short",
    lang,
    targetSec: Math.round(sec),
    tier: BudgetTier.catch("standard").parse(body.tier),
    aiClipRatio: 0,
    budgetUsd: budget,
    voiceId: typeof body.voiceId === "string" && body.voiceId ? body.voiceId : undefined,
    autoApprove: false,
    captions: body.captions !== false,
    sfx: body.sfx !== false,
    music: body.music !== false,
    footage: { sources: [], pending: uploads, narration: f!.narration !== false, transcribe: f!.transcribe !== false, texts },
    width: 1080,
    height: 1920,
    fps: 30,
  };
  const state = newEpisodeState(input);
  await repo().save(state);
  startJob(state.id, "job.script", ["episode", "run", state.id, "--until", "script"]);
  return Response.json({ id: state.id });
}

/** Bölümü oluşturur ve senaryo üretimini hemen başlatır (stil → hikâye → senaryo, sonra onay bekler). */
export async function POST(req: Request) {
  let body: CreateBody;
  try {
    body = await readJson<CreateBody>(req);
  } catch (e) {
    return errorResponse(req, e);
  }
  if (body.footage !== undefined) return createFootage(req, body);
  if (body.youtube !== undefined) return createYoutube(req, body);
  if (typeof body.topic !== "string" || !body.topic.trim()) return apiError(req, msg("api.topic"));
  const minutes = Number(body.minutes ?? 3);
  const budget = Number(body.budgetUsd ?? 20);
  if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 30) return apiError(req, msg("api.minutes"));
  if (!Number.isFinite(budget) || budget <= 0) return apiError(req, msg("api.budget"));
  const motionMode = (["animated", "mixed", "still", "vector"] as const).find((m) => m === body.motionMode) ?? "animated";
  const lang = typeof body.lang === "string" && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.lang) ? body.lang : "tr";
  if (body.customStyleId !== undefined) {
    if (typeof body.customStyleId !== "string" || !await loadCustomStyle(store(), body.customStyleId)) return apiError(req, msg("api.style.missing"));
    if (body.presenter || (Array.isArray(body.bankCast) && body.bankCast.length)) return apiError(req, msg("api.style.bank"));
  }
  let input: EpisodeInput = {
    topic: body.topic.trim(),
    lang,
    targetSec: Math.round(minutes * 60),
    tier: BudgetTier.catch("standard").parse(body.tier),
    motionMode,
    aiClipRatio: 0.2,
    budgetUsd: budget,
    voiceId: typeof body.voiceId === "string" && body.voiceId ? body.voiceId : undefined,
    customStyleId: body.customStyleId,
    styleHint: typeof body.styleHint === "string" ? body.styleHint.trim().slice(0, 300) || undefined : undefined,
    autoApprove: false,
    qa: body.qa !== false,
    realism: body.realism !== false,
    sideViews: body.sideViews === true,
    // Ters açı (vektör modunda çok kullanılan odalar); gönderilmezse açık.
    reverseViews: body.reverseViews !== false,
    // Set eşyası (vektör modunda mekân başına döneme uygun mobilya); gönderilmezse açık.
    setDressing: body.setDressing !== false,
    // Gönderilmezse eski davranış: gömülü.
    captions: body.captions !== false,
    // Efekt sesleri yalnız vektör modunda; gönderilmezse açık.
    sfx: body.sfx !== false,
    // Arka plan müziği her modda; gönderilmezse açık.
    music: body.music !== false,
    // Yatay bölümden dikey Short; gönderilmezse açık.
    short: body.short !== false,
    // Boş: stil paketinin çizgi stili.
    lineStyle: body.lineStyle ? LineStyle.optional().catch(undefined).parse(body.lineStyle) : undefined,
    series: typeof body.series === "string" ? cleanSeries(body.series) : undefined,
    stylePack: body.customStyleId ? STYLE_CUSTOM : (body.stylePack === STYLE_CUSTOM || stylePackOf(body.stylePack) ? body.stylePack : STYLE_AUTO),
    width: body.vertical ? 1080 : 1920,
    height: body.vertical ? 1920 : 1080,
    fps: 30,
    presenter: typeof body.presenter === "string" && body.presenter ? body.presenter : undefined,
    bankCast: Array.isArray(body.bankCast) ? body.bankCast.filter((id): id is string => typeof id === "string" && Boolean(id)).slice(0, 5) : undefined,
  };
  // Bankadan karakter seçildiyse bölüm onların stil paketine ve çizgi stiline geçer.
  try {
    input = await withBankChoice(store(), input);
  } catch (e) {
    return errorResponse(req, e);
  }
  const state = newEpisodeState(input);
  await repo().save(state);
  startJob(state.id, "job.script", ["episode", "run", state.id, "--until", "script"]);
  return Response.json({ id: state.id });
}
