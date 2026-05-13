"use client";

import { useEffect, useRef } from "react";

/**
 * Опрашивает /api/version в фоне. Если commit SHA изменился — НЕ дёргаем
 * пользователя. Reload происходит только когда вкладка ушла в фон
 * (document.hidden), чтобы при возврате пользователь увидел уже свежую
 * версию без "This page couldn't load" в Telegram WebView.
 */
export function AutoRefresh() {
  const initial = useRef<string | null>(null);
  const updateAvailable = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { sha } = (await res.json()) as { sha: string };
        if (!initial.current) {
          initial.current = sha;
          return;
        }
        if (sha !== initial.current && !cancelled) {
          updateAvailable.current = true;
          // Если вкладка уже в фоне — релоадим прямо сейчас
          if (document.hidden) window.location.reload();
        }
      } catch {
        /* swallow */
      }
    };

    const onVisibility = () => {
      if (document.hidden && updateAvailable.current) {
        window.location.reload();
      }
    };

    const interval = setInterval(tick, 4000);
    document.addEventListener("visibilitychange", onVisibility);
    void tick();

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
