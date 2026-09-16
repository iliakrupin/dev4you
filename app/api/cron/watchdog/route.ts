import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db, tasks, taskEvents } from "@/lib/db";
import { isWatchdogAuthorized } from "@/lib/watchdog-auth";

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
 * GitLab CI schedule дёргает этот эндпоинт каждые 5 минут и шлёт masked
 * WATCHDOG_TOKEN в заголовке Authorization. Любой другой запрос отклоняется.
 */
export async function GET(req: NextRequest) {
  if (!isWatchdogAuthorized(req.headers.get("authorization"))) {
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
