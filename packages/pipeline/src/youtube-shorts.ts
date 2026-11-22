import { LocalizedError, msg, type WordTiming } from "@ys/core";
import { getJson, type AssetStore } from "@ys/storage";
import { EpisodeRepo, newEpisodeState } from "./actions.ts";
import { planScript, type FootageSource } from "./footage.ts";
import type { EpisodeState } from "./state.ts";
import { candidatePlan, candidateWords } from "./youtube.ts";

/**
 * Analizin seçilen adaylarından footage Short bölümleri: kaynak kütüphanedeki video (kopyalanmaz), döküm adayın
 * parçalarına düşen kelimeler, kurgu adaydan (özgün ses, anlatım yok, kanca yazısı). `review` değilse senaryo onaylı
 * açılır (çalıştırınca önizleme kapısına kadar gider; CLI'da analiz otomatik onaylıysa render'a); öyleyse kurgu Stüdyo'da
 * düzenlenip onaylanır. Yalnız depoyla çalışır: Stüdyo pipeline'ı (Remotion) yüklemeden çağırır.
 */
export async function createYoutubeShorts(store: AssetStore, analysisId: string, picks: string[], opts: { review?: boolean; music?: boolean } = {}): Promise<EpisodeState[]> {
  const repo = new EpisodeRepo(store);
  const analysis = await repo.load(analysisId);
  const yt = analysis.youtube;
  const report = yt?.report;
  if (!analysis.input.youtube || !report || !yt.video || !yt.meta) throw new LocalizedError(msg("err.youtube.noReport"));
  const chosen = picks.map((id) => {
    const c = report.candidates.find((x) => x.id === id);
    if (!c) throw new LocalizedError(msg("err.youtube.candidate", { id }));
    return c;
  });
  const words = yt.transcript?.key ? ((await getJson<WordTiming[]>(store, yt.transcript.key)) ?? []) : [];
  const source: FootageSource = { id: "f1", key: yt.video.key, name: `${yt.meta.title}.mp4`, ext: "mp4", kind: "video", durationMs: yt.video.durationMs, width: yt.video.width, height: yt.video.height, audio: yt.video.audio };
  const now = new Date().toISOString();
  const created: EpisodeState[] = [];
  for (const c of chosen) {
    // İncelenecek Short otomatik onaylanmaz (kurgu Stüdyo'da düzenlenir); değilse analizin onay ayarını taşır.
    const { youtube: _youtube, ...base } = analysis.input;
    const state = newEpisodeState({
      ...base,
      topic: c.title || analysis.input.topic,
      targetSec: Math.round(c.durationMs / 1000),
      aiClipRatio: 0,
      width: 1080,
      height: 1920,
      footage: { sources: [source], narration: false, transcribe: false, texts: [] },
      ...(opts.review ? { autoApprove: false } : {}),
      ...(opts.music === false ? { music: false } : {}),
      fromYoutube: { analysis: analysis.id, candidate: c.id, url: analysis.input.youtube.url },
    });
    const plan = candidatePlan(c, source);
    // Stüdyo'nun kurgu görünümü için adayın aralığındaki küçük kareler bölüme kopyalanır (analiz silinse de kalsın).
    const frames: { atMs: number; key: string }[] = [];
    for (const f of (yt.frames ?? []).filter((f) => c.segments.some((s) => f.atMs >= s.fromMs && f.atMs < s.toMs))) {
      const bytes = await store.get(f.key);
      if (!bytes) continue;
      const key = `assets/footage/${state.id}/frames/${f.atMs}.jpg`;
      await store.put(key, bytes, "image/jpeg");
      frames.push({ atMs: f.atMs, key });
    }
    state.footageScan = { f1: { frames, words: candidateWords(words, c) } };
    state.footagePlan = plan;
    state.story = { title: c.title, logline: c.why, premise: "", hook: c.hook, beats: [] };
    state.script = planScript(plan);
    state.done = { story: now, script: now };
    if (!opts.review) state.approvals = { script: now };
    await repo.save(state);
    created.push(state);
  }
  yt.shorts = [...(yt.shorts ?? []), ...created.map((s, i) => ({ candidate: chosen[i]!.id, episodeId: s.id }))];
  await repo.save(analysis);
  return created;
}
