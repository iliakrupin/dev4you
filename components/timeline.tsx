import { cn } from "@/lib/utils";

type StageId = "analysis" | "implement" | "test" | "deploy";

const STAGES: { id: StageId; label: string; description: string }[] = [
  { id: "analysis", label: "Анализ", description: "Понимаю задачу" },
  { id: "implement", label: "Разработка", description: "Пишу код" },
  { id: "test", label: "Тесты", description: "Собираю и проверяю" },
  { id: "deploy", label: "Доставка", description: "Готовлю стенд" },
];

// Маппинг статуса задачи → текущий и завершённые этапы
function stageState(status: string): {
  done: Set<StageId>;
  active: StageId | null;
  failed: boolean;
} {
  const done = new Set<StageId>();
  let active: StageId | null = null;

  switch (status) {
    case "queued":
      active = "analysis";
      break;
    case "analyzing":
      active = "analysis";
      break;
    case "analyzed":
      done.add("analysis");
      active = "implement";
      break;
    case "implementing":
      done.add("analysis");
      active = "implement";
      break;
    case "implemented":
      done.add("analysis");
      done.add("implement");
      active = "test";
      break;
    case "testing":
      done.add("analysis");
      done.add("implement");
      active = "test";
      break;
    case "tested":
      done.add("analysis");
      done.add("implement");
      done.add("test");
      active = "deploy";
      break;
    case "deploying":
      done.add("analysis");
      done.add("implement");
      done.add("test");
      active = "deploy";
      break;
    case "ready_for_review":
    case "merged":
      done.add("analysis");
      done.add("implement");
      done.add("test");
      done.add("deploy");
      break;
  }

  return { done, active, failed: status === "failed" };
}

export function Timeline({ status }: { status: string }) {
  const { done, active, failed } = stageState(status);

  return (
    <ol className="relative space-y-3">
      {STAGES.map((stage, i) => {
        const isDone = done.has(stage.id);
        const isActive = active === stage.id;
        const isFailed = failed && isActive;
        const isLast = i === STAGES.length - 1;

        return (
          <li key={stage.id} className="relative flex gap-3">
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[15px] top-8 h-[calc(100%-8px)] w-px",
                  isDone ? "bg-success/50" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition",
                isDone &&
                  "border-success bg-success text-white",
                isActive &&
                  !isFailed &&
                  "border-accent bg-accent text-accent-foreground animate-pulse",
                isFailed && "border-danger bg-danger text-white",
                !isDone &&
                  !isActive &&
                  "border-border bg-surface text-muted-foreground",
              )}
            >
              {isDone ? "✓" : isFailed ? "!" : i + 1}
            </span>
            <div className="flex-1 pt-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    isActive ? "text-foreground" : "text-foreground/80",
                  )}
                >
                  {stage.label}
                </span>
                {isActive && !isFailed && (
                  <span className="text-xs text-accent">в работе…</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {stage.description}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
