"use client";

import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, tasks } from "@/lib/db";
import { TaskCard } from "@/components/task-card";
import { ListAutoRefresh } from "@/components/list-auto-refresh";
import { SearchBar } from "@/components/search-bar";
import { useState } from "react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "#кручуфичу - меняй меня полностью",
};

export default async function HomePage() {
  const list = await db
    .select()
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(5);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredList = list.filter((t) =>
    t.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

      <SearchBar value={searchQuery} onChange={setSearchQuery} />

      <section className="flex flex-col gap-2">
        {filteredList.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {list.length === 0
                ? "Пока нет задач. Поставьте первую — посмотрим, как работает агент."
                : "Нет задач, соответствующих поисковому запросу."}
            </p>
          </div>
        ) : (
          filteredList.map((t) => <TaskCard key={t.id} task={t} />)
        )}
      </section>

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
