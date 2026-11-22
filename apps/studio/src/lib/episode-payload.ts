import { createHash } from "node:crypto";
import type { EpisodePanel, EpisodeResponse, JobView } from "./types.ts";

/** İstenen panel; "auto" ise bölümün durumuna göre (istemcinin açtığı sekmeyle aynı kural). YouTube analizinin ana paneli rapordur. */
export function selectedPanel(value: string | null, status: EpisodeResponse["status"], youtube = false): EpisodePanel {
  if (["overview", "script", "concept", "shots", "costs", "activity", "youtube"].includes(value ?? "")) return value as EpisodePanel;
  return status.status === "waiting" ? status.stage === "render" ? "shots" : status.stage === "voice" ? "concept" : "script" : status.status === "running" ? "activity" : youtube ? "youtube" : "overview";
}
export function responseRevision(source: string, ledger: string, job: JobView | null, panel: EpisodePanel, voicePending: boolean) {
  return createHash("sha256").update(JSON.stringify([source, ledger, job, panel, voicePending ? Math.floor(Date.now() / 60_000) : null])).digest("hex");
}

/** Eski API tam yanıtı korur; yeni istemci yalnız etkin panelin ağır alanlarını ister. */
export function panelPayload(data: EpisodeResponse, panel: EpisodePanel): EpisodeResponse {
  const s = data.state;
  const base: EpisodeResponse["state"] = {
    id: s.id, createdAt: s.createdAt, input: s.input, done: s.done, stats: s.stats, heartbeatAt: s.heartbeatAt,
    lastError: s.lastError, approvals: s.approvals, waitingFor: s.waitingFor, agentCostUsd: s.agentCostUsd,
    renderPct: s.renderPct, story: s.story ? { ...s.story, beats: [] } : undefined,
    script: s.script ? { ...s.script, scenes: [] } : undefined, activity: s.activity?.slice(-6),
  };
  const fields: Record<EpisodePanel, (keyof typeof s)[]> = {
    overview: ["render", "short", "package", "review", "draftReview", "voice", "style", "shots", "keyframes", "stills", "voiceAudit", "styleReference", "scriptNotes", "voiceProviderId"],
    script: ["script", "scriptNotes", "voice", "pronunciations", "pronunciationOverrides", "pronunciationPlan", "narrationEdit", "voiceAudit"],
    concept: ["cast", "concept", "style", "assetChecks", "figurePreviews", "sideViews", "backgroundViews"],
    shots: ["shots", "keyframes", "stills", "clips", "draftReview", "review", "style", "qa", "archives", "replans", "render", "short", "voiceAudit", "script", "cast", "vectorProps"],
    costs: [], activity: ["activity"], youtube: ["youtube"],
  };
  for (const key of fields[panel]) if (key in s) Object.assign(base, { [key]: s[key] });
  // Koddan oynatma ayrı timeline ucunu kullanır; çekim tarifi kartlarda çizilmez.
  if (base.shots) base.shots = base.shots.map(({ vector: _vector, ...shot }) => shot);
  if (panel === "overview") {
    base.shots = base.shots?.slice(0, 1);
    if (base.voice) base.voice = Object.fromEntries(Object.entries(base.voice).map(([id, voice]) => [id, { ...voice, words: [], text: undefined, spoken: undefined }]));
  }
  return { ...data, panel, state: base, library: panel === "concept" ? data.library : [], job: data.job ? { ...data.job, log: panel === "activity" ? data.job.log : data.job.log.slice(-6) } : null };
}
