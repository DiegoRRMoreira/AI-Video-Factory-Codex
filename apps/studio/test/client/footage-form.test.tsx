// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { FootageForm, FOOTAGE_ACCEPT } from "../../src/app/footage-form.tsx";
import { json, renderIn, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
});

type Upload = (headers: Record<string, string>, body: unknown) => Response | Promise<Response>;

function mockApi({ upload = () => json({ key: "uploads/footage/k.mp4" }), create = () => json({ id: "yeni" }) }: { upload?: Upload; create?: (body: Record<string, unknown>) => Response | Promise<Response> } = {}) {
  const uploads: Record<string, string>[] = [];
  const creates: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/footage") {
        const headers = init.headers as Record<string, string>;
        uploads.push(headers);
        return upload(headers, init.body);
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      creates.push(body);
      return create(body);
    }),
  );
  return { uploads, creates };
}

const pick = (...files: File[]) => act(async () => void fireEvent.change(screen.getByTestId("footage-input"), { target: { files } }));
const submit = () => act(async () => void fireEvent.submit(document.querySelector("form")!));
const button = () => document.querySelector("button.btn-primary") as HTMLButtonElement;

describe("kendi görüntünden Short formu", () => {
  it("seçilen dosyalar sırayla yüklenir; bölüm yüklenenlerle açılır", async () => {
    const api = mockApi();
    renderIn(<FootageForm />);
    expect(screen.getByTestId("footage-input").getAttribute("accept")).toBe(FOOTAGE_ACCEPT);
    expect(button().disabled).toBe(true);
    await pick(new File([new Uint8Array([1])], "yol.mp4", { type: "video/mp4" }), new File([new Uint8Array([2])], "eski.mkv"));
    expect(api.uploads).toEqual([
      { "content-type": "video/mp4", "x-file-name": "yol.mp4" },
      { "content-type": "application/octet-stream", "x-file-name": "eski.mkv" },
    ]);
    expect(screen.getAllByText(tr("footage.uploaded"))).toHaveLength(2);
    expect(screen.getByText(tr("footage.summary", { n: 2 }))).toBeTruthy();
    (document.getElementById("texts") as HTMLTextAreaElement).value = "Bir\nİki";
    (document.getElementById("sec") as HTMLInputElement).value = "45";
    fireEvent.click(document.querySelector('input[name="narration"]')!);
    await submit();
    expect(api.creates[0]).toMatchObject({
      lang: "tr",
      budgetUsd: 5,
      captions: true,
      music: true,
      sfx: true,
      footage: { uploads: [{ key: "uploads/footage/k.mp4", name: "yol.mp4" }, { key: "uploads/footage/k.mp4", name: "eski.mkv" }], sec: 45, narration: false, transcribe: true, texts: ["Bir", "İki"] },
    });
    expect(router.push).toHaveBeenCalledWith("/episodes/yeni");
  });

  it("reddedilen ve ağda düşen yükleme hatayla görünür, kaldırılabilir; yüklenen yoksa gönderilemez", async () => {
    let n = 0;
    mockApi({
      upload: () => {
        n++;
        if (n === 1) return json({ error: "Desteklenmeyen ya da bozuk dosya: a.gif" }, 400);
        if (n === 2) return new Response("x", { status: 413, statusText: "Too Large" });
        throw new Error("ağ yok");
      },
    });
    renderIn(<FootageForm />);
    await pick(new File([], "a.gif"), new File([], "b.mp4"), new File([], "c.mp4"));
    expect(screen.getByText("Desteklenmeyen ya da bozuk dosya: a.gif")).toBeTruthy();
    expect(screen.getByText("Too Large")).toBeTruthy();
    expect(screen.getByText("ağ yok")).toBeTruthy();
    expect(button().disabled).toBe(true);
    for (const b of screen.getAllByLabelText(tr("footage.remove"))) fireEvent.click(b);
    expect(document.querySelectorAll("li")).toHaveLength(0);
    // Boş seçim bir şey eklemez.
    await pick();
    await act(async () => void fireEvent.change(screen.getByTestId("footage-input"), { target: { files: null } }));
    expect(document.querySelectorAll("li")).toHaveLength(0);
  });

  it("yükleme sürerken düğme bekler; düz hata metni olarak atılan değer de gösterilir", async () => {
    let release!: () => void;
    mockApi({ upload: () => new Promise<Response>((r) => (release = () => r(json({ key: "uploads/footage/k.jpg" })))) });
    renderIn(<FootageForm />);
    await pick(new File([], "a.jpg", { type: "image/jpeg" }));
    expect(button().textContent).toContain(tr("footage.waitUploads"));
    expect(button().disabled).toBe(true);
    await act(async () => release());
    expect(button().disabled).toBe(false);

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject("düz")));
    renderIn(<FootageForm />);
    await pick(new File([], "a.jpg"));
    expect(screen.getByText("düz")).toBeTruthy();
  });

  it("sunucu hatası ya da ağ hatası gösterilir, form yeniden gönderilebilir", async () => {
    let mode = 0;
    mockApi({
      create: () => {
        mode++;
        if (mode === 1) return json({ error: "Short süresi 15–180 sn olmalı" }, 400);
        if (mode === 2) return new Response("bozuk", { status: 500 });
        throw new Error("ağ");
      },
    });
    renderIn(<FootageForm />);
    await pick(new File([], "a.jpg"));
    await submit();
    expect(screen.getByText("Short süresi 15–180 sn olmalı")).toBeTruthy();
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });
});
