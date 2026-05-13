"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function NewTaskForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = text.trim();
    if (trimmed.length < 5) {
      setError("Опишите задачу подробнее (минимум 5 символов)");
      return;
    }
    if (trimmed.length > 2000) {
      setError("Слишком длинно — уложитесь в 2000 символов");
      return;
    }

    startTransition(async () => {
      try {
        // Telegram initData для валидации (если открыто внутри TG)
        const initData =
          typeof window !== "undefined" &&
          (window as Window & { Telegram?: { WebApp?: { initData?: string } } })
            .Telegram?.WebApp?.initData;

        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(initData ? { "X-Telegram-Init-Data": initData } : {}),
          },
          body: JSON.stringify({ text: trimmed, status: "todo" }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Ошибка сервера (${res.status})`);
        }

        const { id } = (await res.json()) as { id: number };
        router.push(`/tasks/${id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Что-то пошло не так");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Опиши, что поменять в UI - агент напишет код, протестирует и выкатит себя на стенд.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        placeholder="Например: сделай акцентный цвет красным"
        rows={6}
        className="w-full resize-none rounded-2xl border border-border bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
      />
      {error && (
        <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || text.trim().length < 5}
        className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground shadow-sm transition hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:hover:opacity-50"
      >
        {pending ? "Создаю…" : "Поставить задачу"}
      </button>
    </form>
  );
}
