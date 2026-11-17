// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QualityIssueBoard } from "../../src/app/episodes/[id]/quality-issue-board.tsx";
import { en, renderIn } from "./fixtures.tsx";
import { LocaleProvider } from "../../src/app/locale-provider.tsx";
import type { QualityIssue } from "@ys/pipeline/light";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const page = (): { issues: QualityIssue[]; total: number; offset: number; notices: string[]; historicalDecisions: number } => ({ issues: [{ key: "a".repeat(64), source: "audit", target: "short", kind: "freeze", detail: "Held shot", shotId: "s1", seconds: 3, exportId: "v1", evidence: "report.json", status: "open" },
  { key: "b".repeat(64), source: "review", target: "plan", kind: "off_story", detail: "Preview complaint", evidence: "preview", status: "open" }], total: 80, offset: 0, notices: ["short: editorial skipped"], historicalDecisions: 1 });
describe("quality issue board", () => {
  it("navigates unresolved page boundaries, ignores resolved issues and opens linked scenes safely", async () => {
    const data = page(); data.issues.push({ ...data.issues[0]!, key: "research", source: "research", status: "accepted", shotId: undefined }, { ...data.issues[0]!, key: "voice", source: "voice", shotId: "scene" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(data)));
    const inspect = vi.fn(), scene = vi.fn();
    const view = renderIn(<QualityIssueBoard id="e" busy={false} version="v1" onInspect={inspect} onScene={scene} />, "en");
    fireEvent.click(screen.getByRole("button", { name: en("quality.title") })); await screen.findAllByText("Held shot");
    fireEvent.click(screen.getByRole("button", { name: en("workspace.previousIssue") })); expect(inspect.mock.calls.at(-1)![0].key).toBe("voice");
    fireEvent.click(screen.getByRole("button", { name: en("workspace.previousIssue") })); expect(inspect.mock.calls.at(-1)![0].key).toBe("b".repeat(64));
    view.rerender(<LocaleProvider locale="en"><QualityIssueBoard id="e" busy={false} version="v1" onInspect={inspect} selectedKey="absent" onScene={scene} /></LocaleProvider>);
    fireEvent.click(screen.getByRole("button", { name: en("workspace.nextIssue") })); expect(inspect.mock.calls.at(-1)![0].key).toBe("a".repeat(64));
    fireEvent.click(screen.getAllByRole("button", { name: "s1 · 3.0s" })[0]!); expect(inspect.mock.calls.at(-1)![0].target).toBe("short");
    fireEvent.click(screen.getByRole("link", { name: en("research.open") })); expect(scene).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: en("voiceAudit.open") })); expect(scene).toHaveBeenCalledWith("scene");
  });
  it.each(["success", "failure"])("aborts a previous export decision and ignores its late %s", async result => {
    let finish!: (r: Response) => void, fail!: (e: Error) => void, signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url, opts?: RequestInit) => {
      if (opts?.method !== "POST") return Response.json(page());
      signal = opts.signal!; return new Promise<Response>((resolve, reject) => { finish = resolve; fail = reject; });
    }));
    const decided = vi.fn(), view = renderIn(<QualityIssueBoard id="e" busy={false} version="v1" onDecision={decided} />, "en");
    fireEvent.click(screen.getByRole("button", { name: en("quality.title") })); await screen.findByText("Held shot");
    fireEvent.change(screen.getByRole("combobox", { name: "Decision freeze s1" }), { target: { value: "accepted" } });
    view.rerender(<LocaleProvider locale="en"><QualityIssueBoard id="e" busy={false} version="v2" onDecision={decided} /></LocaleProvider>);
    expect(signal.aborted).toBe(true);
    await act(async () => { if (result === "success") finish(Response.json({ ok: true })); else fail(new Error("old failure")); });
    expect(decided).not.toHaveBeenCalled(); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("bounds a stuck decision request and keeps evidence usable after timeout", async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url, opts?: RequestInit) => {
      if (opts?.method !== "POST") return Response.json(page());
      signal = opts.signal!; return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject("timeout"), { once: true }));
    }));
    const view = renderIn(<QualityIssueBoard id="e" busy={false} version="v1" />, "en");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: en("quality.title") })); });
    fireEvent.change(screen.getByRole("combobox", { name: "Decision freeze s1" }), { target: { value: "accepted" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(signal.aborted).toBe(true); expect(screen.getByRole("alert")).toHaveProperty("textContent", en("quality.error"));
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("selects evidence and moves through unresolved issues without changing filters", async () => {
    const data = page(); data.total = 2;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(data)));
    const inspect = vi.fn();
    renderIn(<QualityIssueBoard id="e" busy={false} version="v1" onSeek={() => {}} onInspect={inspect} />, "en");
    fireEvent.click(screen.getByRole("button", { name: en("quality.title") }));
    await screen.findByText("Held shot");
    fireEvent.click(screen.getAllByRole("button", { name: "Inspect issue" })[0]!);
    expect(inspect).toHaveBeenLastCalledWith(data.issues[0]);
    fireEvent.click(screen.getByRole("button", { name: "Next unresolved issue on this page" }));
    expect(inspect).toHaveBeenLastCalledWith(data.issues[1]);
    expect(screen.getByLabelText("Source")).toHaveProperty("value", "");
  });
  it("loads on demand, seeks the correct output and records export-bound decisions", async () => {
    const fetcher = vi.fn(async (_url: string, opts?: RequestInit) => Response.json(opts?.method === "POST" ? { ok: true } : page()));
    vi.stubGlobal("fetch", fetcher); const seek = vi.fn();
    renderIn(<QualityIssueBoard id="e" busy={false} version="v1" onSeek={seek} />, "en");
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: en("quality.title") }));
    await screen.findByText("Held shot");
    expect(screen.getByText("short: editorial skipped")).toBeTruthy();
    expect(screen.getByText(en("quality.historical", { n: 1 }))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "s1 · 3.0s" })); expect(seek).toHaveBeenCalledWith("short", 3);
    expect(screen.getAllByRole("combobox")).toHaveLength(4); // Three filters, one export decision; no plan approval.
    fireEvent.change(screen.getByRole("combobox", { name: "Decision freeze s1" }), { target: { value: "accepted" } });
    await waitFor(() => expect(fetcher.mock.calls.some(([, opts]) => opts?.method === "POST")).toBe(true));
    const body = JSON.parse(fetcher.mock.calls.find(([, opts]) => opts?.method === "POST")![1]!.body as string);
    expect(body).toEqual({ issueKey: "a".repeat(64), exportId: "v1", status: "accepted" });
    await waitFor(() => expect(fetcher.mock.calls.filter(([, opts]) => !opts?.method).length).toBe(2));
  });
  it("filters and pages on the server and surfaces failed requests", async () => {
    const fetcher = vi.fn(async (_url: string) => Response.json(page())); vi.stubGlobal("fetch", fetcher);
    renderIn(<QualityIssueBoard id="e" busy={false} version="v1" onSeek={() => {}} />, "en");
    fireEvent.click(screen.getByRole("button", { name: en("quality.title") })); await screen.findByText("Held shot");
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "audit" } });
    await waitFor(() => expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain("source=audit"));
    await screen.findByText("Held shot"); fireEvent.click(screen.getByRole("button", { name: en("quality.next") }));
    await waitFor(() => expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain("offset=50"));
    await screen.findByText("Held shot");
    fetcher.mockImplementation(async () => Response.json({ error: "Evidence changed" }, { status: 400 }));
    fireEvent.click(screen.getByRole("button", { name: en("quality.refresh") }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Evidence changed");
  });
  it("filters target/status, pages backward and links authoring evidence without an export approval", async () => {
    const data = { ...page(), historicalDecisions: 0, issues: [{ ...page().issues[0]!, shotId: undefined }, ...["voice", "research"].map((source, i) => ({ ...page().issues[1]!, key: String(i), source }))] };
    const fetcher = vi.fn(async (_url: string) => Response.json(data)); vi.stubGlobal("fetch", fetcher);
    renderIn(<QualityIssueBoard id="e" busy={false} version="v1" onSeek={() => {}} />, "en"); fireEvent.click(screen.getByRole("button", { name: en("quality.title") })); await screen.findByText("Held shot");
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#script", "#script"]);
    // Eski kayıtta sahne kimliği bulunmasa da bağlantı güvenle Senaryo sekmesine döner.
    for (const link of screen.getAllByRole("link")) fireEvent.click(link);
    fireEvent.change(screen.getByLabelText(en("quality.target")), { target: { value: "main" } }); await screen.findByText("Held shot");
    fireEvent.change(screen.getByLabelText(en("quality.status")), { target: { value: "open" } }); await screen.findByText("Held shot");
    fireEvent.click(screen.getByRole("button", { name: en("quality.next") })); await screen.findByText("Held shot");
    fireEvent.click(screen.getByRole("button", { name: en("quality.previous") })); await screen.findByText("Held shot");
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain("target=main"); expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain("offset=0");
  });
  it.each(["http", "network", "explicit"])("preserves evidence and reports a %s decision failure", async (failure) => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, opts?: RequestInit) => { if (opts?.method !== "POST") return Response.json(page()); if (failure === "network") throw "offline"; if (failure === "explicit") throw new Error("Decision failed"); return Response.json({}, { status: 400 }); }));
    renderIn(<QualityIssueBoard id="e" busy={false} version="v1" onSeek={() => {}} />, "en"); fireEvent.click(screen.getByRole("button", { name: en("quality.title") })); await screen.findByText("Held shot");
    fireEvent.change(screen.getByRole("combobox", { name: "Decision freeze s1" }), { target: { value: "accepted" } });
    expect((await screen.findByRole("alert")).textContent).toBe(failure === "explicit" ? "Decision failed" : en("quality.error"));
    expect(screen.getByRole("combobox", { name: "Decision freeze s1" })).toHaveProperty("value", "open");
  });
});
