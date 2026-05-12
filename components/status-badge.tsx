import { cn, statusLabel } from "@/lib/utils";

const TONE: Record<string, string> = {
  queued: "bg-surface-muted text-muted-foreground",
  analyzing: "bg-accent-soft text-accent",
  analyzed: "bg-accent-soft text-accent",
  implementing: "bg-accent-soft text-accent",
  implemented: "bg-accent-soft text-accent",
  testing: "bg-accent-soft text-accent",
  tested: "bg-accent-soft text-accent",
  deploying: "bg-accent-soft text-accent",
  ready_for_review: "bg-warning/15 text-warning",
  merged: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-surface-muted text-muted-foreground",
};

const ACTIVE = new Set([
  "analyzing",
  "implementing",
  "testing",
  "deploying",
]);

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? "bg-surface-muted text-muted-foreground";
  const active = ACTIVE.has(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone,
      )}
    >
      {active && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      {statusLabel(status)}
    </span>
  );
}
