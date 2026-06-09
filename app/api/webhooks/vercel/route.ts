import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, tasks, taskEvents } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyVercelSignature } from "@/lib/webhook-verify";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Vercel deployment webhook.
 * Документация: https://vercel.com/docs/observability/webhooks-overview
 *
 * Нас интересуют события:
 *   deployment.succeeded — preview готов, идём мерджить PR
 *   deployment.error / deployment.canceled — preview не собрался, отмечаем failed
 *
 * События для production деплоя (после merge в main) тоже придут — их пропускаем.
 */
type VercelEvent = {
  type: string;
  payload?: {
    deployment?: {
      url?: string;
      meta?: {
        githubCommitRef?: string;
        branchAlias?: string;
      };
    };
    target?: "production" | "preview" | "staging" | string;
  };
};

export async function POST(req: NextRequest) {
  // Публичный эндпоинт → обязательна проверка подписи. Без секрета fail-closed.
  const secret = env.VERCEL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "VERCEL_WEBHOOK_SECRET не настроен" },
      { status: 503 },
    );
  }
  const raw = await req.text();
  const validSig = await verifyVercelSignature(
    raw,
    req.headers.get("x-vercel-signature"),
    secret,
  );
  if (!validSig) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: VercelEvent;
  try {
    body = JSON.parse(raw) as VercelEvent;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const branch =
    body.payload?.deployment?.meta?.githubCommitRef ??
    body.payload?.deployment?.meta?.branchAlias;
  if (!branch || !branch.startsWith("task/")) {
    // не наш PR — игнор
    return NextResponse.json({ ok: true, ignored: true });
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.branchName, branch))
    .limit(1);

  if (!task) return NextResponse.json({ ok: true, ignored: true });

  const url = body.payload?.deployment?.url
    ? `https://${body.payload.deployment.url}`
    : null;

  if (body.type === "deployment.created") {
    if (task.status === "ready_for_review") {
      await db
        .update(tasks)
        .set({ status: "testing", updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
      await db.insert(taskEvents).values({
        taskId: task.id,
        stage: "test",
        kind: "started",
        message: "Vercel собирает preview…",
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.type === "deployment.succeeded" || body.type === "deployment.ready") {
    if (task.status === "merged") return NextResponse.json({ ok: true });

    // Preview готов. Мерж — единой точкой в finalizeImplement, здесь только
    // фиксируем preview URL (убираем гонку тройного мержа).
    await db
      .update(tasks)
      .set({ previewUrl: url, updatedAt: new Date() })
      .where(eq(tasks.id, task.id));
    await db.insert(taskEvents).values({
      taskId: task.id,
      stage: "test",
      kind: "finished",
      message: `Preview готов: ${url}`,
    });
    return NextResponse.json({ ok: true, previewRecorded: true });
  }

  if (body.type === "deployment.error" || body.type === "deployment.canceled") {
    await db
      .update(tasks)
      .set({
        status: "failed",
        errorMessage: `vercel: ${body.type}`,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, task.id)));
    await db.insert(taskEvents).values({
      taskId: task.id,
      stage: "test",
      kind: "error",
      message: body.type,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
