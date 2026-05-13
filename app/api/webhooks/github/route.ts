import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, tasks, taskEvents } from "@/lib/db";
import { mergePullRequest } from "@/lib/github";

export const runtime = "edge";
export const maxDuration = 25;

/**
 * Webhook от GitHub на событие `deployment_status`.
 *
 * Когда Vercel собирает preview deployment для PR, он создаёт в GitHub
 * сначала Deployment, потом обновляет его DeploymentStatus до
 * "in_progress" → "success" / "failure". GitHub присылает webhook
 * на каждое такое изменение — мы используем "success" (для preview, а не
 * production), чтобы автоматически смержить PR задачи.
 *
 * Подключение: GitHub repo → Settings → Webhooks → Add:
 *   Payload URL: https://dev4you-pi.vercel.app/api/webhooks/github
 *   Content type: application/json
 *   Events: "Let me select" → ✅ Deployment statuses
 */
type Payload = {
  action?: string;
  deployment_status?: {
    state?: string;
    environment?: string;
    target_url?: string;
    log_url?: string;
  };
  deployment?: {
    ref?: string; // имя ветки
    environment?: string;
    sha?: string;
  };
};

export async function POST(req: NextRequest) {
  const event = req.headers.get("x-github-event") ?? "";
  if (event !== "deployment_status") {
    return NextResponse.json({ ok: true, ignored: `event=${event}` });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const state = body.deployment_status?.state;
  const env = body.deployment?.environment ?? body.deployment_status?.environment ?? "";

  // Игнорим production и in_progress — нас интересуют только preview success/failure
  if (env.toLowerCase() === "production") {
    return NextResponse.json({ ok: true, ignored: "env=production" });
  }
  if (state !== "success" && state !== "failure" && state !== "error") {
    return NextResponse.json({ ok: true, ignored: `state=${state}` });
  }
  // Идентифицируем task по preview URL (содержит "task-N") — без GitHub API
  // call. Раньше делали findPullRequestForSha — экономим вызов.
  const targetUrl = body.deployment_status?.target_url ?? "";
  const taskFromUrl = targetUrl.match(/dev4you-git-task-(\d+)-/);
  if (!taskFromUrl) {
    return NextResponse.json({ ok: true, ignored: `no task in url: ${targetUrl}` });
  }
  const branch = `task/${taskFromUrl[1]}`;

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.branchName, branch))
    .limit(1);

  if (!task) return NextResponse.json({ ok: true, ignored: "no task" });
  if (task.status === "merged") return NextResponse.json({ ok: true, alreadyMerged: true });
  if (!task.prNumber) return NextResponse.json({ ok: true, ignored: "no pr" });

  // Vercel preview build упал — отмечаем задачу failed
  if (state === "failure" || state === "error") {
    const logUrl = body.deployment_status?.log_url ?? body.deployment_status?.target_url ?? "";
    await db
      .update(tasks)
      .set({
        status: "failed",
        errorMessage: `test: Vercel preview build упал. Лог: ${logUrl}`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    await db.insert(taskEvents).values({
      taskId: task.id,
      stage: "test",
      kind: "error",
      message: `Vercel build failed (${state})`,
      metadata: { logUrl },
    });
    return NextResponse.json({ ok: true, marked: "failed" });
  }

  // Обновляем статус и мержим
  try {
    await db
      .update(tasks)
      .set({
        status: "tested",
        previewUrl: body.deployment_status?.target_url ?? task.previewUrl,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    await db.insert(taskEvents).values({
      taskId: task.id,
      stage: "test",
      kind: "finished",
      message: `Vercel preview готов: ${body.deployment_status?.target_url ?? ""}`,
    });

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

    return NextResponse.json({ ok: true, merged: true, sha: merged.sha });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(tasks)
      .set({
        status: "failed",
        errorMessage: `deploy: ${msg}`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    await db.insert(taskEvents).values({
      taskId: task.id,
      stage: "deploy",
      kind: "error",
      message: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
