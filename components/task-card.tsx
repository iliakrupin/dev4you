'use client';
import { StatusBadge } from "@/components/status-badge";
import { formatRelative } from "@/lib/utils";
import type { Task } from "@/lib/db/schema";

const ACTIVE_STATUSES = [
  "analyzing",
  "implementing",
  "ready_for_review",
  "testing",
  "deploying",
];

export function TaskCard({ task }: { task: Task }) {
  const getProgressWidth = () => {
    const progressMap: Record<string, string> = {
      queued: "10%",
      analyzing: "20%",
      analyzed: "30%",
      implementing: "45%",
      implemented: "60%",
      ready_for_review: "70%",
      testing: "80%",
      tested: "90%",
      deploying: "95%",
      merged: "100%",
      failed: "0%",
      cancelled: "0%",
    };
    return progressMap[task.status] ?? "0%";
  };

  const handleRetry = async () => {
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: task.rawText }),
    });
    window.location.reload();
  };

  return (
    <div className="group block rounded-2xl border border-border bg-surface p-4 transition hover:border-accent/50 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-foreground">
            {task.rawText}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            #{task.id} · {formatRelative(task.createdAt)}
            {task.telegramUsername ? ` · @${task.telegramUsername}` : ""}
          </p>
        </div>
        <StatusBadge status={task.status} />
      </div>
      
      {/* Timeline прогресса по этапам */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>Создана</span>
          <span>В работе</span>
          <span>Завершена</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-full bg-border h-2">
            <div 
              className={`h-2 rounded-full bg-accent transition-all duration-300 ${ACTIVE_STATUSES.includes(task.status) ? "animate-pulse" : ""}`} 
              style={{ width: getProgressWidth() }}
            />
          </div>
        </div>
      </div>
      
      {task.spec?.goal && <div className='text-xs mt-3'><span className='font-medium'>Как понял агент:</span> <span>{task.spec.goal}</span></div>}
      {task.errorMessage && <div className='text-xs mt-3 text-danger'><span className='font-medium'>Ошибка:</span> <span>{task.errorMessage}</span></div>}
      {task.status === 'failed' && (
        <button 
          onClick={handleRetry}
          className="rounded-lg bg-accent text-accent-foreground px-3 py-1.5 text-xs mt-3"
        >
          Повторить
        </button>
      )}
    </div>
  );
}