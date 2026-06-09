import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, tasks, taskEvents } from "@/lib/db";
import { env as appEnv } from "@/lib/env";
import { verifyGithubSignature } from "@/lib/webhook-verify";

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

  // Эндпоинт публичный → обязательна проверка подписи. Без секрета —
  // fail-closed: иначе любой POST мог бы помечать задачи failed.
  const secret = appEnv.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "GITHUB_WEBHOOK_SECRET не настроен" },
      { status: 503 },
    );
  }
  const raw = await req.text();
  const validSig = await verifyGithubSignature(
    raw,
    req.headers.get("x-hub-signature-256"),
    secret,
  );
  if (!validSig) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = JSON.parse(raw) as Payload;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const state = body.deployment_status?.state;
  const env = body.deployment?.environment ?? body.deployment_status?.environment ?? "";

  if (state !== "success" && state !== "failure" && state !== "error") {
    return NextResponse.json({ ok: true, ignored: `state=${state}` });
  }

  // Production failure: ищем task с этим merge_commit_sha и помечаем failed.
  // Это убирает ложное "Внедрено" когда наш immediate-merge workaround
  // сливает PR, а production build потом падает.
  if (env.toLowerCase() === "production") {
    if (state !== "failure" && state !== "error") {
      return NextResponse.json({ ok: true, ignored: "production success" });
    }
    const sha = body.deployment?.sha ?? body.deployment?.ref ?? "";
    if (!sha) return NextResponse.json({ ok: true, ignored: "no sha" });
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.mergeCommitSha, sha))
      .limit(1);
    if (!task) {
      return NextResponse.json({ ok: true, ignored: "no task with this sha" });
    }
    const logUrl =
      body.deployment_status?.log_url ?? body.deployment_status?.target_url ?? "";
    await db
      .update(tasks)
      .set({
        status: "failed",
        errorMessage: `deploy: production build упал. Лог: ${logUrl}`,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    await db.insert(taskEvents).values({
      taskId: task.id,
      stage: "deploy",
      kind: "error",
      message: `Production build failed: ${logUrl}`,
    });
    return NextResponse.json({ ok: true, marked: "failed (prod build)" });
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

  // Preview собрался. Мерж выполняется единой точкой в finalizeImplement
  // (immediate-merge workaround), поэтому здесь НЕ мержим — только фиксируем
  // preview URL. Это убирает гонку тройного мержа.
  await db
    .update(tasks)
    .set({
      previewUrl: body.deployment_status?.target_url ?? task.previewUrl,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));
  return NextResponse.json({ ok: true, previewRecorded: true });
}
