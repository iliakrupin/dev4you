import { cn } from "@/lib/utils";

type StageId = "analysis" | "implement" | "test" | "deploy";

const STAGES: { id: StageId; label: string; description: string }[] = [
  { id: "analysis", label: "Анализ", description: "Понимаю задачу" },
  { id: "implement", label: "Разработка", description: "Пишу код" },
  { id: "test", label: "Тесты", description: "Собираю и проверяю" },
  { id: "deploy", label: "Доставка", description: "Готовлю стенд" },
];

// Маппинг статуса задачи → завершённые этапы и текущий
function stageState(
  status: string,
  errorMessage: string | null,
): {
  done: Set<StageId>;
  active: StageId | null;
  failedAt: StageId | null;
} {
  const done = new Set<StageId>();
  let active: StageId | null = null;

  switch (status) {
    case "queued":
    case "analyzing":
      active = "analysis";
      break;
    case "analyzed":
    case "implementing":
      done.add("analysis");
      active = "implement";
      break;
    case "implemented":
    case "ready_for_review":
    case "testing":
      done.add("analysis");
      done.add("implement");
      active = "test";
      break;
    case "tested":
    case "deploying":
      done.add("analysis");
      done.add("implement");
      done.add("test");
      active = "deploy";
      break;
    case "merged":
      done.add("analysis");
      done.add("implement");
      done.add("test");
      done.add("deploy");
      break;
  }

  let failedAt: StageId | null = null;
  if (status === "failed") {
    // errorMessage обычно начинается с "<stage>: ..." — analysis / implement / test / deploy
    const m = errorMessage?.match(/^(analysis|implement|test|deploy)[:\s]/);
    const prefix = m?.[1];
    if (prefix === "analysis") failedAt = "analysis";
    else if (prefix === "implement") failedAt = "implement";
    else if (prefix === "test") failedAt = "test";
    else if (prefix === "deploy") failedAt = "deploy";
    else failedAt = active ?? "analysis";

    // Этапы до failedAt — успешные
    const order: StageId[] = ["analysis", "implement", "test", "deploy"];
    for (const s of order) {
      if (s === failedAt) break;
      done.add(s);
    }
    active = null;
  }

  return { done, active, failedAt };
}

export function Timeline({
  status,
  errorMessage,
}: {
  status: string;
  errorMessage?: string | null;
}) {
  const { done, active, failedAt } = stageState(status, errorMessage ?? null);

  return (
    <ol className="relative space-y-3">
      {STAGES.map((stage, i) => {
        const isDone = done.has(stage.id);
        const isActive = active === stage.id;
        const isFailed = failedAt === stage.id;
        const isLast = i === STAGES.length - 1;

        return (
          <li key={stage.id} className="relative flex gap-3">
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[15px] top-8 h-[calc(100%-8px)] w-px",
                  isDone
                    ? "bg-success/50"
                    : isFailed
                      ? "bg-danger/30"
                      : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition",
                isDone && "border-success bg-success text-white",
                isActive &&
                  "border-accent bg-accent text-accent-foreground animate-pulse",
                isFailed && "border-danger bg-danger text-white",
                !isDone &&
                  !isActive &&
                  !isFailed &&
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
                    isActive || isFailed
                      ? "text-foreground"
                      : "text-foreground/80",
                  )}
                >
                  {stage.label}
                </span>
                {isActive && (
                  <span className="text-xs text-accent">в работе…</span>
                )}
                {isFailed && (
                  <span className="text-xs font-medium text-danger">
                    ошибка
                  </span>
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
