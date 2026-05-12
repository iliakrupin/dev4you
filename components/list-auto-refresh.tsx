"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Дёргает router.refresh() раз в N секунд, чтобы Server Component
 * перерендерился с актуальными данными из БД (статусы задач, новые
 * задачи от других пользователей и т.п.). В отличие от location.reload,
 * это soft refresh — без мерцания и без потери клиентского состояния.
 */
export function ListAutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
