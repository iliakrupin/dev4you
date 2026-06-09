import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db, tasks, taskEvents } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 30;

// Активные статусы держат мьютекс «одна задача за раз». Если задача застряла
// в любом из них (потерянный self-trigger, упавшая Edge-функция, не пришедший
// webhook) — она блокирует всю систему навсегда. Watchdog добивает такие до
// failed, освобождая слот.
const ACTIVE_STATUSES = [
  "queued",
  "analyzing",
  "analyzed",
  "implementing",
  "implemented",
  "ready_for_review",
  "testing",
  "tested",
  "deploying",
] as const;

const STUCK_AFTER_MS = 5 * 60_000; // 5 минут без updatedAt = зависла

/**
 * Vercel Cron дёргает этот эндпоинт по расписанию (см. vercel.json) и шлёт
 * заголовок Authorization: Bearer <CRON_SECRET>. Без секрета — fail-closed.
 */
export async function GET(req: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET не задан" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = await db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, [...ACTIVE_STATUSES]), lt(tasks.updatedAt, cutoff)));

  for (const t of stuck) {
    await db
      .update(tasks)
      .set({
        status: "failed",
        errorMessage: `watchdog: задача зависла на этапе "${t.status}" дольше 5 минут`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, t.id));
    await db.insert(taskEvents).values({
      taskId: t.id,
      stage: "system",
      kind: "error",
      message: `Watchdog: помечена failed (зависла на "${t.status}")`,
    });
  }

  return NextResponse.json({ ok: true, failed: stuck.length });
}
