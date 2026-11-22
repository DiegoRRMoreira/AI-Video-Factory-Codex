import { z } from "zod";

/**
 * Claude ajanlarının model seçimi. Her ajanın kodda bir varsayılan sınıfı var (creative/fast/cheap, plan §1.5);
 * kullanıcı Stüdyo'nun Modeller sayfasından ajan başına başka bir model seçebilir. Seçim depoda
 * (`settings/models.json`) durur ve bir sonraki çalıştırmada geçerli olur.
 */
export const MODEL_CHOICES = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

export type ModelTier = "creative" | "fast" | "cheap";

export const DEFAULT_TIER_MODEL: Record<ModelTier, ModelChoice> = {
  creative: "claude-opus-5-5",
  fast: "claude-sonnet-5-5",
  cheap: "claude-haiku-5-5",
};

/** Ajan anahtarı → varsayılan sınıf. Anahtar ajan çağrısının adıdır (günlükte ve maliyet dökümünde görünen). */
export const AGENT_ROLES = {
  "style-picker": "cheap",
  "style-analyst": "fast",
  "art-director": "fast",
  "story-architect": "creative",
  screenwriter: "creative",
  "script-doctor": "creative",
  "casting-director": "fast",
  director: "fast",
  "frame-inspector": "cheap",
  "vector-director": "fast",
  "asset-planner": "fast",
  "likeness-analyst": "fast",
  "vector-designer:character": "creative",
  "vector-designer:background": "fast",
  "vector-designer:prop": "fast",
  "vector-designer:redraw": "fast",
  "prop-physics": "cheap",
  "asset-guess": "cheap",
  "asset-gate": "cheap",
  "figure-designer": "cheap",
  "scene-critic": "cheap",
  "lesson-curator": "cheap",
  packager: "fast",
  pronouncer: "cheap",
  "set-dresser": "fast",
  "footage-editor": "fast",
  "footage-inspector": "cheap",
  "youtube-analyst": "fast",
  "youtube-curator": "fast",
} as const satisfies Record<string, ModelTier>;
export type AgentRole = keyof typeof AGENT_ROLES;

/**
 * ACP (Agent Client Protocol) ajanı: stdio üzerinden JSON-RPC konuşan bir ajan CLI'ı (`agy acp`, claude-code-acp,
 * codex-acp…). Seçim `acp:<ajan>:<model>` biçiminde saklanır; modeller ajanın oturumundan keşfedilir (istem göndermeden).
 */
export type AcpChoice = `acp:${string}:${string}`;
export type ModelSetting = ModelChoice | AcpChoice;

const ACP_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ACP_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
/** Komut ve argümanlar kabuk karakteri taşımaz (.cmd/.bat Windows'ta kabukla açılır; enjeksiyon olmasın). */
const SAFE_ARG = /^[\w .:\\/@=+,~-]{1,300}$/;

export const AcpModel = z.object({ id: z.string().regex(ACP_MODEL_ID), name: z.string().max(120) });
export type AcpModel = z.infer<typeof AcpModel>;

export const AcpBackend = z.object({
  id: z.string().regex(ACP_ID),
  label: z.string().min(1).max(80),
  command: z.string().regex(SAFE_ARG),
  args: z.array(z.string().regex(SAFE_ARG)).max(20),
  /** Keşfedilen modeller (boşsa seçilemez). */
  models: z.array(AcpModel).max(300).default([]),
  /** Ajanın düşünme seviyeleri (thought_level), sırayla. */
  efforts: z.array(z.string().max(40)).max(12).default([]),
  /** İstem görsel kabul ediyor mu (initialize → promptCapabilities.image). */
  images: z.boolean().default(false),
});
export type AcpBackend = z.infer<typeof AcpBackend>;

export interface AcpSettings {
  backends: AcpBackend[];
}

/** Antigravity CLI'ının hazır tanımı (Modeller sayfasında tek tıkla eklenir; modeller keşifle gelir). */
export const AGY_BACKEND: AcpBackend = { id: "agy", label: "Antigravity (agy)", command: "agy", args: ["acp"], models: [], efforts: [], images: false };

/** Hazır, doğrulanmış ajan tanımları: komut ve argümanlarıyla birebir bunlar API'den kabul edilir. */
export const ACP_PRESETS: readonly AcpBackend[] = [AGY_BACKEND];

/**
 * Ajanın izin sormasını kapatan bayraklar (--dangerously-skip-permissions, --yolo, --auto-approve…): ajana giden metnin
 * bir kısmı güvenilmez (video başlığı, döküm) ve izin soran ajan geri çevrilir; bu bayrakla araçlarını sormadan çalıştırırdı.
 */
const BYPASS = /danger|skip-?perm|yolo|bypass|allow-?all|auto-?approve|no-?sandbox|trust/i;

/**
 * Ajan çalıştırılabilir mi (22 Kas güvenlik incelemesi: Modeller API'si çalıştırılacak komutu kaydediyor): izin atlatan
 * bayrak hiçbir zaman; komut ve argümanları birlikte ya hazır bir tanımla ya da sunucu ortamında (`YS_ACP_COMMANDS`)
 * izinli bir komut satırıyla birebir aynıysa. Yalnız komut adına izin verilmez: `npx`, `node` gibi bir başlatıcı API'den
 * gelen argümanlarla her şeyi çalıştırırdı.
 */
export function acpAllowed(b: Pick<AcpBackend, "command" | "args">, allowed: readonly string[] = []): boolean {
  if (b.args.some((a) => BYPASS.test(a))) return false;
  const line = acpCommandLine(b);
  return ACP_PRESETS.some((p) => acpCommandLine(p) === line) || allowed.some((a) => acpCommandLine({ command: a, args: [] }) === line);
}

/** Karşılaştırma için tek boşluklu komut satırı. */
export const acpCommandLine = (b: Pick<AcpBackend, "command" | "args">) => [b.command, ...b.args].join(" ").trim().replace(/\s+/g, " ");

/** Geçersiz, yinelenen ya da izinsiz komutlu ajanlar sessizce atılır (bozuk dosya çalışmayı bozmaz). */
export function cleanAcpSettings(raw: unknown, allowed: readonly string[] = []): AcpSettings {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { backends?: unknown }).backends) ? (raw as { backends: unknown[] }).backends : [];
  const backends: AcpBackend[] = [];
  for (const item of list.slice(0, 10)) {
    const parsed = AcpBackend.safeParse(item);
    if (parsed.success && acpAllowed(parsed.data, allowed) && !backends.some((b) => b.id === parsed.data.id)) backends.push(parsed.data);
  }
  return { backends };
}

export const acpChoice = (backend: string, model: string): AcpChoice => `acp:${backend}:${model}`;

/** `acp:<ajan>:<model>` seçimini çözer; ACP seçimi değilse undefined. */
export function parseAcpChoice(model: string): { backend: string; model: string } | undefined {
  const m = /^acp:([^:]+):(.+)$/.exec(model);
  return m && ACP_ID.test(m[1]!) && ACP_MODEL_ID.test(m[2]!) ? { backend: m[1]!, model: m[2]! } : undefined;
}

export const ModelSettings = z.record(z.string(), z.string());
export type ModelSettings = Partial<Record<AgentRole, ModelSetting>>;

/**
 * Geçerli seçimleri süzer: bilinmeyen ajan ya da model sessizce atılır (eski ayar dosyası çalışmayı bozmaz). ACP seçimi,
 * ajanlar verilmişse yalnız tanımlı bir ajanın keşfedilmiş bir modeliyse kalır (silinen ajan çağrıyı düşürmesin).
 */
export function cleanModelSettings(raw: unknown, backends?: readonly AcpBackend[]): ModelSettings {
  const parsed = ModelSettings.safeParse(raw);
  if (!parsed.success) return {};
  const out: ModelSettings = {};
  for (const [role, model] of Object.entries(parsed.data)) {
    if (!Object.hasOwn(AGENT_ROLES, role)) continue;
    if ((MODEL_CHOICES as readonly string[]).includes(model)) out[role as AgentRole] = model as ModelChoice;
    const acp = parseAcpChoice(model);
    if (acp && (!backends || backends.some((b) => b.id === acp.backend && b.models.some((m) => m.id === acp.model)))) out[role as AgentRole] = model as AcpChoice;
  }
  return out;
}

/**
 * Çağrının modeli: önce tam ad ("vector-designer:prop"), sonra ön ek ("asset-planner:character" → "asset-planner")
 * için kullanıcı seçimi; yoksa ajanın kendi varsayılanı.
 */
export function modelFor(name: string, fallback: string, settings: ModelSettings | undefined): string {
  if (!settings) return fallback;
  const own = (key: string) => (Object.hasOwn(settings, key) ? settings[key as AgentRole] : undefined);
  return own(name) ?? own(name.split(":")[0]!) ?? fallback;
}
