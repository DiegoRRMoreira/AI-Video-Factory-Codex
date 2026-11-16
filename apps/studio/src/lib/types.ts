import type { CostGroup, Quota } from "@ys/media-gateway";
import type { EpisodeEstimate, EpisodeState, EpisodeSummary, LibraryCharacter, MotionMode, Progress, RunStatus, Stage } from "@ys/pipeline/light";
export type EpisodePanel = "overview" | "script" | "concept" | "shots" | "costs" | "activity";
export interface EpisodeStatusResponse {
  revision: string;
  summary: EpisodeSummary;
  status: EpisodeResponse["status"];
  progress: Progress | null;
}

/** Sunucu ile istemci arasında paylaşılan yanıt tipleri (sadece tip; çalışma anı kodu yok). */

export interface JobView {
  label: string;
  status: "running" | "done" | "error";
  log: string[];
  startedAt: string;
  endedAt?: string;
}

export interface QuotaView {
  providerId: string;
  quota: Quota;
  /** Kalan aşamalar için gereken miktar (karakter). */
  needed: number;
}

export interface EpisodeResponse {
  revision?: string;
  panel?: EpisodePanel;
  counts?: EpisodeSummary["counts"];
  /** Render kaynakları yalnız CLI'da kullanılır; sık sorgulanan Studio yanıtına girmez. */
  state: Omit<EpisodeState, "timeline">;
  /** Bu bölümün stilinde kütüphanedeki onaylı karakterler (tekrar kullanmak için). */
  library: LibraryCharacter[];
  job: JobView | null;
  /** Ücretli API harcaması (bütçe tavanına sayılan). */
  spentUsd: number;
  /** Claude ajan çağrıları: tavana sayılmaz, ayrıca gösterilir. */
  claudeUsd: number;
  estimates: Record<MotionMode, EpisodeEstimate>;
  /** Defterden aşama ve sağlayıcı bazında gerçekleşen. */
  actual: { byStage: CostGroup[]; byProvider: CostGroup[] };
  progress: Progress | null;
  /** Tek bakışta durum; Stüdyo'nun kendi işi sürüyorsa her zaman "running". */
  status: { status: RunStatus; stage?: Stage };
  quota: QuotaView | null;
}
