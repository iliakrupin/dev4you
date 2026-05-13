"use client";

import { useEffect, useRef } from "react";

/**
 * Опрашивает /api/version. При смене commit SHA делает reload в момент
 * когда браузер idle (через requestIdleCallback) — это безопаснее чем
 * сразу window.location.reload, потому что не пересекается с активным
 * кликом пользователя (race ломал Telegram WebView).
 */
export function AutoRefresh() {
  const initial = useRef<string | null>(null);

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
          const ric =
            (window as Window & {
              requestIdleCallback?: (cb: () => void) => void;
            }).requestIdleCallback ??
            ((cb: () => void) => setTimeout(cb, 200));
          ric(() => window.location.reload());
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

  return null;
}
