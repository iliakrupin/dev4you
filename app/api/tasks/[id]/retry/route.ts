import { after, NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, tasks } from "@/lib/db";
import { runAnalysis } from "@/lib/agent/runner";

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

export const runtime = "edge";
export const maxDuration = 25;

/**
 * Перезапуск failed-задачи: сбрасываем state до queued и запускаем
 * pipeline заново — без создания новой записи в БД.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Mutex: не запускаем retry если есть другая активная задача
  const [active] = await db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ACTIVE_STATUSES as unknown as string[]),
        ne(tasks.id, taskId),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  if (active) {
    return NextResponse.json(
      {
        error: `Сейчас в работе задача #${active.id}. Дождитесь её завершения.`,
        activeTaskId: active.id,
      },
      { status: 429 },
    );
  }

  await db
    .update(tasks)
    .set({
      status: "queued",
      errorMessage: null,
      spec: null,
      pendingFiles: null,
      producedFiles: null,
      branchName: null,
      prNumber: null,
      prUrl: null,
      previewUrl: null,
      mergeCommitSha: null,
      touchedFiles: [],
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${req.headers.get("host")}`;

  after(async () => {
    try {
      await runAnalysis(taskId);
      const [updated] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      if (updated?.status === "analyzed") {
        await fetch(`${appUrl}/api/tasks/${taskId}/implement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (err) {
      console.error(`retry task #${taskId}`, err);
    }
  });

  return NextResponse.json({ ok: true, restarted: taskId });
}
