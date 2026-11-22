// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGY_BACKEND, type AcpBackend } from "@ys/core/models";
import { ModelsForm } from "../../src/app/models/models-form.tsx";
import { en, json, renderIn, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const found: AcpBackend = { ...AGY_BACKEND, images: true, efforts: ["low"], models: [{ id: "gemini-4-neon", name: "Gemini 4 Neon" }] };

type Call = { url: string; method?: string; body: Record<string, unknown> };
function mockApi(reply: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const c = { url, method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      calls.push(c);
      return reply(c);
    }),
  );
  return calls;
}

describe("ACP ajanları (Modeller)", () => {
  it("Antigravity tek tıkla eklenir, modelleri bulunur ve ajan listelerinde ajan adıyla seçilebilir", async () => {
    const calls = mockApi((c) => {
      if (c.url === "/api/settings/acp") return json({ acp: c.body, models: {} });
      if (c.url === "/api/settings/acp/discover") return json({ acp: { backends: [found] }, models: {} });
      return json(c.body);
    });
    renderIn(<ModelsForm initial={{}} />);
    expect(screen.getByText(tr("models.acp.none"))).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: tr("models.acp.addAgy") })));
    expect(calls.slice(0, 2)).toEqual([
      { url: "/api/settings/acp", method: "PUT", body: { backends: [AGY_BACKEND] } },
      { url: "/api/settings/acp/discover", method: "POST", body: { id: "agy" } },
    ]);
    expect(screen.getByText(found.label)).toBeTruthy();
    expect(screen.getByText(`${tr("models.acp.count", { n: 1 })}`, { exact: false })).toBeTruthy();
    expect(screen.queryByRole("button", { name: tr("models.acp.addAgy") })).toBeNull();
    const select = screen.getByText("youtube-analyst").closest("div.flex")!.querySelector("select")!;
    const group = select.querySelector("optgroup")!;
    expect(group.label).toBe(found.label);
    expect(group.querySelector("option")!.value).toBe("acp:agy:gemini-4-neon");
    await act(async () => void fireEvent.change(select, { target: { value: "acp:agy:gemini-4-neon" } }));
    expect(calls.at(-1)).toEqual({ url: "/api/settings/models", method: "PUT", body: { "youtube-analyst": "acp:agy:gemini-4-neon" } });
  });

  it("ajan yeniden keşfedilir ya da kaldırılır; sunucunun model seçimi geri yazılır", async () => {
    const calls = mockApi((c) => (c.url === "/api/settings/acp" ? json({ acp: c.body, models: {} }) : json({ acp: { backends: [found] }, models: { packager: "acp:agy:gemini-4-neon" } })));
    renderIn(<ModelsForm initial={{}} acp={[{ ...found, models: [], images: false }]} />, "en");
    expect(screen.getByText(en("models.acp.noImages"), { exact: false })).toBeTruthy();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: en("models.acp.discover") })));
    expect(calls[0]).toEqual({ url: "/api/settings/acp/discover", method: "POST", body: { id: "agy" } });
    expect(screen.getByText(en("models.acp.images"), { exact: false })).toBeTruthy();
    expect((screen.getByText("packager").closest("div.flex")!.querySelector("select") as HTMLSelectElement).value).toBe("acp:agy:gemini-4-neon");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: en("models.acp.remove") })));
    expect(calls.at(-1)).toEqual({ url: "/api/settings/acp", method: "PUT", body: { backends: [] } });
    expect(screen.getByText(en("models.acp.none"))).toBeTruthy();
  });

  it("başka bir ajan komutuyla eklenir; geçersiz kayıt ve sunucu hatası gösterilir", async () => {
    let accept = false;
    const calls = mockApi((c) => {
      if (c.url === "/api/settings/acp/discover") return json({ error: "Could not list the models of Claude: boom" }, 400);
      return json({ acp: accept ? c.body : { backends: [] }, models: {} });
    });
    renderIn(<ModelsForm initial={{}} />);
    const add = screen.getByRole("button", { name: tr("models.acp.add") }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    const field = (key: string) => screen.getByText(tr(`models.acp.field.${key}` as never)).querySelector("input")!;
    fireEvent.change(field("id"), { target: { value: "claude" } });
    fireEvent.change(field("command"), { target: { value: "claude-code-acp.cmd" } });
    fireEvent.change(field("args"), { target: { value: " --x   --y " } });
    expect(add.disabled).toBe(false);
    // Sunucu ajanı süzdü (geçersiz): uyarı, keşif yok
    await act(async () => void fireEvent.click(add));
    expect(screen.getByText(tr("models.acp.failed", { error: tr("models.acp.invalid") }))).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ backends: [{ id: "claude", label: "claude", command: "claude-code-acp.cmd", args: ["--x", "--y"], models: [], efforts: [], images: false }] });
    // Kabul edildi ama keşif başarısız: sunucunun iletisi
    accept = true;
    fireEvent.change(field("label"), { target: { value: "Claude" } });
    await act(async () => void fireEvent.click(add));
    expect(screen.getByText(tr("models.acp.failed", { error: "Could not list the models of Claude: boom" }))).toBeTruthy();
    expect(field("id").value).toBe("");
  });

  it("gövdesi okunamayan hata durum koduyla bildirilir", async () => {
    mockApi(() => new Response("<html>", { status: 502 }));
    renderIn(<ModelsForm initial={{}} acp={[found]} />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: tr("models.acp.remove") })));
    expect(screen.getByText(tr("models.acp.failed", { error: "502" }))).toBeTruthy();
  });
});
