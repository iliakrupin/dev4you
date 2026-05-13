import { after, NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, tasks } from "@/lib/db";
import { runAnalysis } from "@/lib/agent/runner";
import { ANON_USER, validateInitData } from "@/lib/telegram";

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

const RATE_LIMIT_WINDOW_MS = 60_000; // 60 секунд между задачами от одного юзера

// Edge runtime даёт 25s timeout на Hobby (вместо 10s у nodejs).
// Это критично — analysis + implement делают по LLM-вызову + Octokit.
export const runtime = "edge";
export const maxDuration = 25;

const BodySchema = z.object({
  text: z.string().min(5).max(2000),
});

export async function POST(req: NextRequest) {
  let body: { text: string };
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 },
    );
  }

  const initData = req.headers.get("x-telegram-init-data");
  let user = ANON_USER;
  if (initData) {
    const parsed = await validateInitData(initData);
    if (parsed) user = parsed;
  }

  // 1. Mutex: одна активная задача за раз
  const [active] = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ACTIVE_STATUSES as unknown as string[]))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  if (active) {
    return NextResponse.json(
      {
        error: `Сейчас в работе задача #${active.id} ("${active.rawText.slice(0, 50)}…"). Подождите окончания и попробуйте снова.`,
        activeTaskId: active.id,
      },
      { status: 429 },
    );
  }

  // 2. Rate-limit per telegram_id (для anon — глобально)
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [recent] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.telegramUserId, user.id),
        gt(tasks.createdAt, since),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  if (recent) {
    const waitSec = Math.ceil(
      (recent.createdAt.getTime() + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000,
    );
    return NextResponse.json(
      {
        error: `Слишком часто. Подождите ${waitSec} сек и попробуйте снова.`,
        retryAfter: waitSec,
      },
      { status: 429 },
    );
  }

  const [task] = await db
    .insert(tasks)
    .values({
      rawText: body.text,
      telegramUserId: user.id,
      telegramUsername: user.username ?? null,
      status: "queued",
    })
    .returning();

  // Запускаем analysis в after(). После успеха — fire-and-forget fetch
  // на /api/tasks/[id]/implement, чтобы implement получил свои 25s
  // отдельной Edge-функцией.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;
  after(async () => {
    try {
      await runAnalysis(task.id);
      const [updated] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .limit(1);
      if (updated?.status === "analyzed") {
        // не ждём ответа — нам важно только триггернуть отдельную функцию
        await fetch(`${appUrl}/api/tasks/${task.id}/implement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (err) {
      console.error(`analysis task #${task.id} failed`, err);
    }
  });

  return NextResponse.json({ id: task.id });
}
