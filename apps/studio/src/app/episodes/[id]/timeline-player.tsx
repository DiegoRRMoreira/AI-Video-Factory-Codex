"use client";
import { Player, type PlayerRef } from "@remotion/player";
import type { Timeline } from "@ys/core";
import { Episode } from "@ys/video";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../locale-provider";

/** Zaman çizelgesindeki göreli yollar (depo anahtarları, yazı tipleri) render'da public/ klasöründen, burada bu uçtan okunur. */
export const STATIC_BASE = "/api/assets";

/**
 * Bölümü render etmeden oynatır: render'ın çizdiği aynı `Episode` bileşeni Remotion oynatıcısında, tarayıcıda canlı çalışır
 * (12 Kas, kullanıcı: "render etmeden saniye saniye oynatma olsa"). MP4 üretilmez, API çağrısı ve render kilidi gerekmez;
 * durdurulan kare render ile aynıdır, oynarken tarayıcı yetişemezse kare atlar (ses senkron kalır). Ses render'daki son
 * düzey ayarını (loudnorm) almaz. Bileşen yalnız tarayıcıda yüklenir (three, pixi ve paper `window` ister).
 * `shot` verilince oynatıcı o çekimin ilk karesine atlar ve oynar; `seek` her istekte artar, aynı çekim yeniden istenebilir.
 */
export interface TimelinePlayerProps { id: string; shot?: string; seek?: number; version?: string; seconds?: number; initialFrame?: number; active?: boolean; play?: boolean; onFrame?: (frame: number) => void }
export default function TimelinePlayer({ id, shot, seek, version, seconds, initialFrame, active = true, play = true, onFrame }: TimelinePlayerProps) {
  const { t } = useI18n();
  const [timeline, setTimeline] = useState<Timeline>();
  const [error, setError] = useState<string>();
  const player = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const frameHandler = useRef(onFrame); frameHandler.current = onFrame;
  const initial = useRef(initialFrame); initial.current = initialFrame;
  const applied = useRef<{ timeline: Timeline; key: string } | undefined>(undefined);

  useEffect(() => {
    if (!timeline || !onFrame) return;
    const current = player.current!;
    const listener = (event: { detail: { frame: number } }) => frameHandler.current?.(event.detail.frame);
    current.addEventListener("frameupdate", listener);
    return () => { current.removeEventListener("frameupdate", listener); current.pause(); };
  }, [timeline, Boolean(onFrame)]);
  useEffect(() => { if (!active) player.current?.pause(); }, [active]);

  // Çekimden oynat: zaman çizelgesi gelince (ya da açıkken yeni istekte) çekimin başına atlanır, oynatıcı görünür kılınır.
  useEffect(() => {
    if (!timeline || !active || (!shot && seconds === undefined)) return;
    const visual = shot ? timeline.visuals.find((v) => v.shotId === shot) : undefined;
    if (seconds === undefined && !visual) return;
    const key = JSON.stringify([shot, seek, seconds, play]);
    if (applied.current?.timeline === timeline && applied.current.key === key) return;
    applied.current = { timeline, key };
    // Zaman çizelgesi varken oynatıcı ve kutusu çizilmiştir (çocuk ref'leri bu etkiden önce bağlanır).
    player.current!.seekTo(Math.max(0, Math.min(timeline.durationInFrames - 1, seconds !== undefined ? Math.round(seconds * timeline.fps) : visual!.fromFrame)));
    if (play) player.current!.play();
    else player.current!.pause();
    // Üst kenara hizalanır: "nearest" alttaki karttan gelince oynatıcının üstünü ekran dışında bırakıyordu (oynatıcı ≤ 75vh).
    box.current!.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [timeline, shot, seek, seconds, play, active]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { setError(t("shots.play.error")); controller.abort(); }, 30_000);
    // Remotion'ın staticFile() çağrıları bu köke çözülür; oynatıcı yüklenmeden önce ayarlanır.
    window.remotion_staticBase = STATIC_BASE;
    setTimeline(undefined);
    setError(undefined);
    void (async () => {
      try {
        const res = await fetch(`/api/episodes/${id}/timeline`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as Timeline & { error?: string };
        if (controller.signal.aborted) return;
        if (res.ok) setTimeline(body);
        else setError(body.error ?? t("shots.play.error"));
      } catch {
        if (!controller.signal.aborted) setError(t("shots.play.error"));
      } finally { clearTimeout(timer); }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [id, t, version]);

  if (error) return <p className="text-sm text-red-400" role="alert">{error}</p>;
  if (!timeline) return <p className="text-sm text-muted">{t("shots.play.loading")}</p>;
  return (
    <div className="grid scroll-mt-4 gap-2" ref={box}>
      <Player
        ref={player}
        component={Episode}
        inputProps={{ timeline }}
        durationInFrames={timeline.durationInFrames}
        fps={timeline.fps}
        compositionWidth={timeline.width}
        compositionHeight={timeline.height}
        controls
        initialFrame={Math.max(0, Math.min(timeline.durationInFrames - 1, initial.current ?? 0))}
        showPlaybackRateControl
        acknowledgeRemotionLicense
        style={{ width: "100%", aspectRatio: `${timeline.width} / ${timeline.height}`, maxHeight: "75vh", borderRadius: 8, overflow: "hidden" }}
      />
      <p className="text-xs text-muted">{t("shots.play.note")}</p>
    </div>
  );
}
