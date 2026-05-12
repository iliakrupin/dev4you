import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { formatRelative } from "@/lib/utils";
import type { Task } from "@/lib/db/schema";

export function TaskCard({ task }: { task: Task }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="group block rounded-2xl border border-border bg-surface p-4 transition hover:border-accent/50 hover:shadow-sm"
    >
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
    </Link>
  );
}
