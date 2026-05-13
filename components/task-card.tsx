import { StatusBadge } from "@/components/status-badge";
import { formatRelative } from "@/lib/utils";
import type { Task } from "@/lib/db/schema";

export function TaskCard({ task }: { task: Task }) {
  const getProgressWidth = () => {
    switch (task.status) {
      case "completed":
        return "100%";
      case "in_progress":
        return "50%";
      default:
        return "0%";
    }
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
              className="h-2 rounded-full bg-accent transition-all duration-300" 
              style={{ width: getProgressWidth() }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}