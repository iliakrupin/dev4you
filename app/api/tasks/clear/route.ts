import { NextResponse } from "next/server";
import { db, tasks } from "@/lib/db";

export const runtime = "edge";
export const maxDuration = 10;

/**
 * Удаляет все задачи. Используется кнопкой "Очистить" в шапке.
 * task_events удалятся каскадом.
 */
export async function POST() {
  await db.delete(tasks);
  return NextResponse.json({ ok: true });
}
