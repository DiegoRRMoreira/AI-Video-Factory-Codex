// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { colorsOf, MotionForm, MOTION_ACCEPT } from "../../src/app/motion-form.tsx";
import { json, renderIn, tr } from "./fixtures.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockReset();
});

function mockApi({ upload = () => json({ key: "uploads/footage/k.png" }), create = () => json({ id: "film" }) }: { upload?: () => Response | Promise<Response>; create?: () => Response | Promise<Response> } = {}) {
  const uploads: Record<string, string>[] = [];
  const creates: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/footage") {
        uploads.push(init.headers as Record<string, string>);
        return upload();
      }
      creates.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return create();
    }),
  );
  return { uploads, creates };
}

const pick = (...files: File[]) => act(async () => void fireEvent.change(screen.getByTestId("motion-input"), { target: { files } }));
const submit = () => act(async () => void fireEvent.submit(document.querySelector("form")!));
const button = () => document.querySelector("button.btn-primary") as HTMLButtonElement;

describe("marka renkleri", () => {
  it("#RRGGBB'ler küçük harfe iner, tekrar ve bozuklar atılır, en çok 6", () => {
    expect(colorsOf("#2563EB, #2563eb; mavi #abc #f59e0b")).toEqual(["#2563eb", "#f59e0b"]);
    expect(colorsOf("#000001 #000002 #000003 #000004 #000005 #000006 #000007")).toHaveLength(6);
    expect(colorsOf("")).toEqual([]);
  });
});

describe("hareketli grafik filmi formu", () => {
  it("görselsiz de gönderilir: brif, süre, yatay, renkler, anlatım kapalı; bölüm sayfasına gider", async () => {
    const api = mockApi();
    renderIn(<MotionForm />);
    expect(screen.getByTestId("motion-input").getAttribute("accept")).toBe(MOTION_ACCEPT);
    // Anlatım kapalıyken ses seçimi yok.
    expect(document.getElementById("voiceId")).toBeNull();
    expect(button().disabled).toBe(false);
    (document.getElementById("topic") as HTMLTextAreaElement).value = "Render önbelleği 27 dakikadan 3 dakikaya";
    fireEvent.change(document.getElementById("colors")!, { target: { value: "#2563EB, bozuk" } });
    expect(screen.getByTestId("film-swatches").children).toHaveLength(1);
    expect(screen.getByText(tr("film.summary", { n: 0, colors: 1 }))).toBeTruthy();
    await submit();
    expect(api.uploads).toEqual([]);
    expect(api.creates[0]).toMatchObject({
      topic: "Render önbelleği 27 dakikadan 3 dakikaya",
      lang: "tr",
      budgetUsd: 5,
      captions: true,
      music: true,
      sfx: true,
      motion: { uploads: [], sec: 30, vertical: false, colors: ["#2563eb"], narration: false },
    });
    expect(api.creates[0]!.voiceId).toBeNull();
    expect(router.push).toHaveBeenCalledWith("/episodes/film");
  });

  it("görseller yüklenir, anlatım açılınca ses seçilir, dikey gönderilir; yüklenemeyen kaldırılabilir", async () => {
    let n = 0;
    const api = mockApi({ upload: () => (++n === 2 ? json({ error: "Bozuk görsel" }, 400) : json({ key: "uploads/footage/k.png" })) });
    renderIn(<MotionForm />);
    await pick(new File([new Uint8Array([1])], "logo.png", { type: "image/png" }), new File([], "bozuk.webp"));
    expect(api.uploads).toEqual([
      { "content-type": "image/png", "x-file-name": "logo.png" },
      { "content-type": "application/octet-stream", "x-file-name": "bozuk.webp" },
    ]);
    expect(screen.getByText(tr("footage.uploaded"))).toBeTruthy();
    expect(screen.getByText("Bozuk görsel")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText(tr("footage.remove"))[1]!);
    expect(document.querySelectorAll("li")).toHaveLength(1);
    fireEvent.click(screen.getByText(tr("film.narration")));
    expect(document.getElementById("voiceId")).toBeTruthy();
    (document.getElementById("topic") as HTMLTextAreaElement).value = "Brif";
    fireEvent.change(document.getElementById("aspect")!, { target: { value: "vertical" } });
    (document.getElementById("sec") as HTMLInputElement).value = "45";
    fireEvent.click(document.querySelector('input[name="music"]')!);
    await submit();
    expect(api.creates[0]).toMatchObject({ music: false, motion: { uploads: [{ key: "uploads/footage/k.png", name: "logo.png" }], sec: 45, vertical: true, colors: [], narration: true } });
    expect(typeof api.creates[0]!.voiceId).toBe("string");
    // Boş seçim bir şey eklemez.
    await act(async () => void fireEvent.change(screen.getByTestId("motion-input"), { target: { files: null } }));
    expect(document.querySelectorAll("li")).toHaveLength(1);
  });

  it("yükleme sürerken düğme bekler", async () => {
    let release!: () => void;
    mockApi({ upload: () => new Promise<Response>((r) => (release = () => r(json({ key: "uploads/footage/k.jpg" })))) });
    renderIn(<MotionForm />);
    await pick(new File([], "a.jpg", { type: "image/jpeg" }));
    expect(button().textContent).toContain(tr("footage.waitUploads"));
    expect(button().disabled).toBe(true);
    await act(async () => release());
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain(tr("film.submit"));
  });

  it("sunucu hatası, gövdesiz hata ve ağ hatası gösterilir; form yeniden gönderilebilir", async () => {
    let mode = 0;
    mockApi({
      create: () => {
        mode++;
        if (mode === 1) return json({ error: "Film süresi 10–180 sn olmalı" }, 400);
        if (mode === 2) return new Response("bozuk", { status: 500 });
        throw new Error("ağ");
      },
    });
    renderIn(<MotionForm />);
    await submit();
    expect(screen.getByText("Film süresi 10–180 sn olmalı")).toBeTruthy();
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    await submit();
    expect(screen.getByText(tr("form.failed"))).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it("başarılı gönderimden sonra düğme sayfa açılana dek kilitli kalır", async () => {
    mockApi();
    renderIn(<MotionForm />);
    await submit();
    expect(router.push).toHaveBeenCalledWith("/episodes/film");
    expect(button().textContent).toContain(tr("form.submitting"));
    expect(button().disabled).toBe(true);
  });
});
