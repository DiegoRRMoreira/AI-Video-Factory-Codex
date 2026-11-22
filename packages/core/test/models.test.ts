import { describe, expect, it } from "vitest";
import { acpAllowed, acpChoice, acpCommandLine, AGY_BACKEND, cleanAcpSettings, cleanModelSettings, modelFor, parseAcpChoice } from "../src/models.ts";

describe("ajan model seçimi", () => {
  it("bilinmeyen ajan ve model atılır", () => {
    expect(cleanModelSettings({ "asset-gate": "claude-sonnet-5-5", "no-such-agent": "claude-opus-5-5", screenwriter: "gpt-x" })).toEqual({
      "asset-gate": "claude-sonnet-5-5",
    });
    expect(cleanModelSettings("bozuk")).toEqual({});
  });

  it("önce tam ad, sonra ön ek, yoksa ajanın varsayılanı", () => {
    const s = cleanModelSettings({ "vector-designer:prop": "claude-opus-5-5", "asset-planner": "claude-haiku-5-5" });
    expect(modelFor("vector-designer:prop", "claude-sonnet-5-5", s)).toBe("claude-opus-5-5");
    expect(modelFor("asset-planner:character", "claude-sonnet-5-5", s)).toBe("claude-haiku-5-5");
    expect(modelFor("vector-designer:background", "claude-sonnet-5-5", s)).toBe("claude-sonnet-5-5");
    expect(modelFor("asset-gate", "claude-haiku-5-5", undefined)).toBe("claude-haiku-5-5");
  });

  it("ACP seçimi: biçim, tanımlı ajan ve keşfedilmiş model", () => {
    expect(acpChoice("agy", "gemini-4-neon")).toBe("acp:agy:gemini-4-neon");
    expect(parseAcpChoice("acp:agy:gemini-3.8-flash")).toEqual({ backend: "agy", model: "gemini-3.8-flash" });
    expect(parseAcpChoice("claude-opus-5-5")).toBeUndefined();
    expect(parseAcpChoice("acp:Bad Id:m")).toBeUndefined();
    expect(parseAcpChoice("acp:agy:bad model")).toBeUndefined();
    const raw = { "youtube-analyst": "acp:agy:m1", "youtube-curator": "acp:agy:gone", packager: "acp:other:m1", screenwriter: "acp:x" };
    // Ajanlar verilmezse biçimi doğru her seçim kalır.
    expect(cleanModelSettings(raw)).toEqual({ "youtube-analyst": "acp:agy:m1", "youtube-curator": "acp:agy:gone", packager: "acp:other:m1" });
    const agy = { ...AGY_BACKEND, models: [{ id: "m1", name: "M1" }] };
    expect(cleanModelSettings(raw, [agy])).toEqual({ "youtube-analyst": "acp:agy:m1" });
  });

  it("ACP ayarları: geçersiz, yinelenen ve fazlası atılır; kabuk karakteri reddedilir", () => {
    expect(cleanAcpSettings(undefined)).toEqual({ backends: [] });
    expect(cleanAcpSettings({ backends: "x" })).toEqual({ backends: [] });
    const ok = { id: "agy", label: "A", command: "C:\\tools\\agy.exe", args: ["acp", "--sandbox"] };
    const allowed = [acpCommandLine(ok), "a|b"];
    const out = cleanAcpSettings({ backends: [ok, { ...ok, label: "dup" }, { ...ok, id: "evil", args: ["acp & calc"] }, { ...ok, id: "x2", command: "a|b" }, null] }, allowed);
    expect(out.backends).toEqual([{ ...ok, models: [], efforts: [], images: false }]);
    expect(cleanAcpSettings({ backends: Array.from({ length: 12 }, (_, i) => ({ ...ok, id: `b${i}` })) }, allowed).backends).toHaveLength(10);
  });

  it("çalıştırma izni: hazır tanım birebir, yoksa sunucunun izin listesi; izin atlatan bayrak asla", () => {
    expect(acpAllowed(AGY_BACKEND)).toBe(true);
    expect(acpAllowed({ command: "agy", args: ["acp", "--sandbox"] })).toBe(false);
    expect(acpAllowed({ command: "agy", args: ["chat"] })).toBe(false);
    expect(acpAllowed({ command: "evil.exe", args: [] })).toBe(false);
    expect(acpAllowed({ command: "claude-code-acp", args: [] }, ["claude-code-acp"])).toBe(true);
    // Yalnız komut adı yetmez: argümanlar da birebir.
    expect(acpAllowed({ command: "npx", args: ["-y", "evil-pkg"] }, ["npx"])).toBe(false);
    expect(acpAllowed({ command: "npx", args: ["-y", "@zed-industries/claude-code-acp"] }, ["npx  -y @zed-industries/claude-code-acp "])).toBe(true);
    for (const flag of ["--dangerously-skip-permissions", "--yolo", "--auto-approve", "--allow-all-tools", "--no-sandbox", "--trust"])
      expect(acpAllowed({ command: "claude-code-acp", args: [flag] }, ["claude-code-acp"]), flag).toBe(false);
    expect(cleanAcpSettings({ backends: [AGY_BACKEND, { ...AGY_BACKEND, id: "x", command: "rm" }] }).backends.map((b) => b.id)).toEqual(["agy"]);
  });
});
