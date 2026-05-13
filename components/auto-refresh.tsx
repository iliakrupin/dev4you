"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Опрашивает /api/version. Когда commit SHA сменился относительно того,
 * с которым страница загрузилась — показываем banner с кнопкой "Обновить".
 *
 * НЕ делаем автоматический window.location.reload — в Telegram WebView
 * это приводило к ошибке "This page couldn't load", если reload совпадал
 * с user-initiated действием (например клик удалить).
 */
export function AutoRefresh() {
  const initial = useRef<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

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
          setUpdateAvailable(true);
        }
      } catch {
        /* swallow */
      }
    };
    const interval = setInterval(tick, 4000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <button
      onClick={() => window.location.reload()}
      className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-lg active:scale-95"
    >
      Доступно обновление — нажмите
    </button>
  );
}
