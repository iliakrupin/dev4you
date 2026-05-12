"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Timeline } from "@/components/timeline";
import { formatRelative } from "@/lib/utils";
import type { Task } from "@/lib/db/schema";

const ACTIVE_STATUSES = new Set([
  "queued",
  "analyzing",
  "analyzed",
  "implementing",
  "implemented",
  "testing",
  "tested",
  "deploying",
]);

export function TaskDetail({ initialTask }: { initialTask: Task }) {
  const [task, setTask] = useState(initialTask);

  // Polling каждые 2 секунды пока задача активна
  useEffect(() => {
    if (!ACTIVE_STATUSES.has(task.status)) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const next: Task = await res.json();
        if (!cancelled) setTask(next);
      } catch {
        /* swallow */
      }
    };
    const interval = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [task.id, task.status]);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-base font-medium text-foreground">
            {task.rawText}
          </p>
          <StatusBadge status={task.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          Поставлено {formatRelative(task.createdAt)}
          {task.telegramUsername ? ` · @${task.telegramUsername}` : ""}
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Прогресс
        </h2>
        <Timeline status={task.status} />
      </section>

      {task.spec && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            План
          </h2>
          <p className="text-sm text-foreground">{task.spec.goal}</p>
          {task.spec.targetFiles?.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Файлы:{" "}
              <code className="font-mono">
                {task.spec.targetFiles.join(", ")}
              </code>
            </p>
          )}
        </section>
      )}

      {task.errorMessage && (
        <section className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
          <h2 className="mb-2 text-sm font-semibold text-danger">Ошибка</h2>
          <p className="text-sm text-danger/90">{task.errorMessage}</p>
        </section>
      )}

      {task.previewUrl && (
        <a
          href={task.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3.5 text-base font-semibold text-accent-foreground shadow-sm transition hover:opacity-90 active:scale-[0.99]"
        >
          Посмотреть на стенде →
        </a>
      )}

      {task.prUrl && (
        <a
          href={task.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-center text-sm text-accent hover:underline"
        >
          PR #{task.prNumber} на GitHub →
        </a>
      )}
    </div>
  );
}
