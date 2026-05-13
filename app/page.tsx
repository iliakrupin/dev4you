import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, tasks } from "@/lib/db";
import { ListAutoRefresh } from "@/components/list-auto-refresh";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "#кручуфичу - меняй меня полностью",
};

async function deleteTask(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  await db.delete(tasks).where(tasks.id === parseInt(id));
}

export default async function HomePage() {
  const list = await db
    .select()
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(5);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 pb-28 pt-6">
      <ListAutoRefresh />
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-accent">
          #КручуФичу
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Меняй меня полностью
        </h1>
        <p className="text-sm text-muted-foreground">
          Опишите фичу — AI-агент напишет код, протестирует и выкатит на стенд.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {list.map((task) => (
          <div key={task.id} className="relative rounded-lg border bg-card p-4 shadow-sm">
            <form action={deleteTask} className="absolute right-2 top-2">
              <input type="hidden" name="id" value={task.id.toString()} />
              <button
                type="submit"
                className="rounded bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground transition hover:bg-destructive/90"
              >
                Удалить
              </button>
            </form>
            <p className="text-foreground">{task.title}</p>
            <p className="text-sm text-muted-foreground">{task.description}</p>
          </div>
        ))}
      </div>

      <Link
        href="/new"
        className="fixed inset-x-4 bottom-6 mx-auto flex max-w-2xl items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-4 text-base font-semibold text-accent-foreground shadow-lg shadow-accent/30 transition hover:opacity-90 active:scale-[0.99]"
      >
        <span aria-hidden>＋</span>
        Новая задача
      </Link>
    </main>
  );
}
