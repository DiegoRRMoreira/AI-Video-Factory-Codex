"use client";

import { acpChoice, AGENT_ROLES, DEFAULT_TIER_MODEL, MODEL_CHOICES, type AcpBackend, type AgentRole, type ModelSetting, type ModelSettings } from "@ys/core/models";
import { useState } from "react";
import type { MessageKey } from "../../lib/i18n";
import { useI18n } from "../locale-provider";
import { AcpAgents } from "./acp-agents";

/** Aşamaya göre gruplu ajanlar: kullanıcı hangi işin hangi modelle yapıldığını bir bakışta görür. */
const GROUPS: { title: MessageKey; roles: AgentRole[] }[] = [
  { title: "models.group.story", roles: ["style-picker", "art-director", "story-architect", "screenwriter", "script-doctor", "casting-director", "pronouncer"] },
  {
    title: "models.group.vector",
    roles: ["vector-director", "asset-planner", "likeness-analyst", "vector-designer:character", "vector-designer:background", "vector-designer:prop", "vector-designer:redraw", "prop-physics", "figure-designer", "set-dresser"],
  },
  { title: "models.group.check", roles: ["asset-guess", "asset-gate", "scene-critic", "frame-inspector", "lesson-curator"] },
  { title: "models.group.publish", roles: ["packager"] },
  { title: "models.group.footage", roles: ["footage-editor", "footage-inspector"] },
  { title: "models.group.youtube", roles: ["youtube-analyst", "youtube-curator"] },
  { title: "models.group.image", roles: ["director"] },
];

export function ModelsForm({ initial, acp = [] }: { initial: ModelSettings; acp?: AcpBackend[] }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ModelSettings>(initial);
  const [backends, setBackends] = useState<AcpBackend[]>(acp);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async (next: ModelSettings) => {
    setSettings(next);
    setSaved("saving");
    try {
      const res = await fetch("/api/settings/models", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      if (!res.ok) throw new Error(String(res.status));
      setSettings((await res.json()) as ModelSettings);
      setSaved("saved");
    } catch {
      setSaved("error");
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={saved === "error" ? "text-bad" : "text-muted"}>
          {saved === "idle" ? t("models.hint") : t(`models.${saved}` as MessageKey)}
        </span>
        {Object.keys(settings).length > 0 && (
          <button className="btn-ghost py-1 text-xs" onClick={() => save({})}>
            {t("models.reset")}
          </button>
        )}
      </div>
      <AcpAgents
        backends={backends}
        onSaved={(saved) => {
          setBackends(saved.acp.backends);
          setSettings(saved.models);
        }}
      />
      {GROUPS.map((g) => (
        <section key={g.title} className="card">
          <h2 className="mb-3 font-semibold">{t(g.title)}</h2>
          <div className="grid gap-2.5">
            {g.roles.map((role) => {
              const fallback = DEFAULT_TIER_MODEL[AGENT_ROLES[role]];
              const chosen = settings[role];
              return (
                <div key={role} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/50 pb-2.5 text-sm last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-medium">{t(`models.role.${role}` as MessageKey)}</div>
                    <div className="text-xs text-muted">
                      <code>{role}</code> · {t("models.default", { model: fallback })}
                    </div>
                  </div>
                  <select
                    disabled={saved === "saving"}
                    className={`rounded-md border bg-panel-2 px-2 py-1 text-sm ${chosen && chosen !== fallback ? "border-accent" : "border-line"}`}
                    value={chosen ?? ""}
                    onChange={(e) => {
                      const next = { ...settings };
                      if (e.target.value) next[role] = e.target.value as ModelSetting;
                      else delete next[role];
                      void save(next);
                    }}
                  >
                    <option value="">{t("models.useDefault", { model: fallback })}</option>
                    {MODEL_CHOICES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {backends
                      .filter((b) => b.models.length)
                      .map((b) => (
                        <optgroup key={b.id} label={b.label}>
                          {b.models.map((m) => (
                            <option key={m.id} value={acpChoice(b.id, m.id)}>
                              {m.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
