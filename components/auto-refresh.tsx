"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Опрашивает /api/version раз в 4 секунды. Когда commit SHA сменился
 * относительно того, с которым страница загрузилась — показываем
 * мягкое уведомление и через 1.5 с делаем hard reload, чтобы зрители
 * увидели новую тему вживую.
 */
export function AutoRefresh() {
  const initial = useRef<string | null>(null);
  const [updating, setUpdating] = useState(false);

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
          setUpdating(true);
          setTimeout(() => window.location.reload(), 1500);
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

  if (!updating) return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground shadow-lg"
    >
      Обновляюсь…
    </div>
  );
}
