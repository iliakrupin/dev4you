import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, tasks, taskEvents } from "@/lib/db";
import { mergePullRequest } from "@/lib/github";

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
  let body: VercelEvent;
  try {
    body = (await req.json()) as VercelEvent;
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

    await db
      .update(tasks)
      .set({
        status: "tested",
        previewUrl: url,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    await db.insert(taskEvents).values({
      taskId: task.id,
      stage: "test",
      kind: "finished",
      message: `Preview готов: ${url}`,
    });

    // Автоматический мердж — этап deploy
    if (task.prNumber) {
      try {
        await db
          .update(tasks)
          .set({ status: "deploying", updatedAt: new Date() })
          .where(eq(tasks.id, task.id));

        const merged = await mergePullRequest(task.prNumber);
        await db
          .update(tasks)
          .set({
            status: "merged",
            mergeCommitSha: merged.sha,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, task.id));
        await db.insert(taskEvents).values({
          taskId: task.id,
          stage: "deploy",
          kind: "finished",
          message: `Внедрено в main: ${merged.sha.slice(0, 7)}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .update(tasks)
          .set({
            status: "failed",
            errorMessage: `merge: ${msg}`,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, task.id));
        await db.insert(taskEvents).values({
          taskId: task.id,
          stage: "deploy",
          kind: "error",
          message: msg,
        });
      }
    }

    return NextResponse.json({ ok: true });
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
