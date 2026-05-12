import { NewTaskForm } from "./new-task-form";

export const dynamic = "force-dynamic";

export default function NewTaskPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 pb-10 pt-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Новая задача
        </h1>
        <p className="text-sm text-muted-foreground">
          Опишите, что нужно сделать. Агент уточнит детали и выполнит работу.
        </p>
      </header>

      <NewTaskForm />

      <section className="rounded-2xl border border-border bg-surface-muted/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Примеры задач
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-foreground/80">
          <li>· Сделай акцентный цвет красным</li>
          <li>· Поменяй цвета темы на зелёные</li>
          <li>· Откати последнее изменение темы</li>
        </ul>
      </section>
    </main>
  );
}
