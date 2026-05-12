import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tasks, taskEvents, type Task, type TaskSpec } from "@/lib/db";
import { llm, qwenModel } from "./llm";
import { ANALYSIS_SYSTEM, IMPLEMENT_SYSTEM } from "./prompts";
import { isAllowed } from "./sandbox";
import {
  createBranch,
  getBaseBranchSha,
  getLatestMergeCommit,
  openPullRequest,
  readFile,
  writeFile,
} from "@/lib/github";

// ---- helpers ----

async function logEvent(
  taskId: number,
  stage: string,
  kind: string,
  message: string,
  metadata?: unknown,
) {
  await db.insert(taskEvents).values({
    taskId,
    stage,
    kind,
    message,
    metadata: metadata as Record<string, unknown> | undefined,
  });
}

async function setStatus(
  taskId: number,
  status: Task["status"],
  patch: Partial<Task> = {},
) {
  await db
    .update(tasks)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(eq(tasks.id, taskId));
}

async function getTask(taskId: number): Promise<Task | null> {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return t ?? null;
}

function extractJson<T>(raw: string, schema: z.ZodType<T>): T {
  // Иногда модель оборачивает JSON в ```json ... ```
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // Иногда добавляет leading prose — берём от первой { до последней }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }
  const parsed = JSON.parse(text);
  return schema.parse(parsed);
}

// ---- analysis ----

const TaskSpecSchema: z.ZodType<TaskSpec> = z.object({
  goal: z.string(),
  targetFiles: z.array(z.string()),
  changes: z.string(),
  acceptanceCriteria: z.array(z.string()),
  operation: z.enum(["edit", "revert"]),
  revertSha: z.string().optional(),
});

export async function runAnalysis(taskId: number): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;
  if (task.status !== "queued" && task.status !== "analyzing") return;

  await setStatus(taskId, "analyzing");
  await logEvent(taskId, "analysis", "started", "Анализирую задачу…");

  try {
    const completion = await llm().chat.completions.create({
      model: qwenModel(),
      temperature: 0.2,
      max_tokens: 800,
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM },
        { role: "user", content: task.rawText },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const spec = extractJson(raw, TaskSpecSchema);

    // Доп. фильтр sandbox: даже если LLM указала запрещённые файлы — выкинем
    spec.targetFiles = spec.targetFiles.filter(isAllowed);

    await setStatus(taskId, "analyzed", { spec });
    await logEvent(taskId, "analysis", "finished", "План готов", { spec });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStatus(taskId, "failed", { errorMessage: `analysis: ${msg}` });
    await logEvent(taskId, "analysis", "error", msg);
  }
}

// ---- implement ----

const FilesSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});

export async function runImplement(taskId: number): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;
  if (task.status !== "analyzed" && task.status !== "implementing") return;
  if (!task.spec) {
    await setStatus(taskId, "failed", { errorMessage: "implement: нет spec" });
    return;
  }

  await setStatus(taskId, "implementing");
  await logEvent(taskId, "implement", "started", "Пишу код…");

  try {
    if (task.spec.operation === "revert") {
      // revert обрабатываем отдельно — через PR с revert последнего merge
      await runRevert(taskId, task);
      return;
    }

    // Прочитать содержимое целевых файлов из main
    const fileContents: Record<string, { content: string; sha: string }> = {};
    for (const path of task.spec.targetFiles) {
      const f = await readFile(path);
      if (f) fileContents[path] = f;
    }

    const userPrompt = [
      `Задача: ${task.spec.goal}`,
      `Изменения: ${task.spec.changes}`,
      ``,
      `Текущее содержимое разрешённых файлов:`,
      ...Object.entries(fileContents).map(
        ([p, f]) =>
          `--- FILE: ${p} ---\n${f.content}\n--- END FILE: ${p} ---`,
      ),
      ``,
      `Верни новое содержимое тех файлов, которые нужно изменить, в формате JSON.`,
    ].join("\n");

    const completion = await llm().chat.completions.create({
      model: qwenModel(),
      temperature: 0.2,
      max_tokens: 2000,
      messages: [
        { role: "system", content: IMPLEMENT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJson(raw, FilesSchema);

    // Sandbox-фильтр: выкидываем все, что вне whitelist
    const safeFiles = parsed.files.filter((f) => isAllowed(f.path));
    if (safeFiles.length === 0) {
      throw new Error("Модель не вернула изменений в разрешённых файлах");
    }

    // Создаём ветку
    const baseSha = await getBaseBranchSha();
    const branch = `task/${taskId}`;
    await createBranch(branch, baseSha);

    // Записываем файлы
    for (const f of safeFiles) {
      const prev = fileContents[f.path];
      await writeFile({
        path: f.path,
        content: f.content,
        branch,
        message: `task #${taskId}: ${task.spec.goal}`.slice(0, 72),
        prevSha: prev?.sha,
      });
    }

    // Открываем PR
    const pr = await openPullRequest({
      branch,
      title: `task #${taskId}: ${task.spec.goal}`.slice(0, 72),
      body: [
        `**Задача:** ${task.rawText}`,
        ``,
        `**План:** ${task.spec.changes}`,
        ``,
        `**Файлы:** ${safeFiles.map((f) => `\`${f.path}\``).join(", ")}`,
        ``,
        `_Создано агентом ФичуЗадачу._`,
      ].join("\n"),
    });

    await setStatus(taskId, "ready_for_review", {
      branchName: branch,
      prNumber: pr.number,
      prUrl: pr.url,
      touchedFiles: safeFiles.map((f) => f.path),
    });
    await logEvent(taskId, "implement", "finished", `PR #${pr.number} открыт`, {
      pr,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStatus(taskId, "failed", { errorMessage: `implement: ${msg}` });
    await logEvent(taskId, "implement", "error", msg);
  }
}

async function runRevert(taskId: number, task: Task): Promise<void> {
  // Простейший вариант: возвращаем globals.css к стартовому состоянию.
  // (Полный git revert через REST требует больше шагов — оставим на следующую итерацию.)
  await logEvent(
    taskId,
    "implement",
    "progress",
    "Откат: возвращаю globals.css к стартовому состоянию",
  );

  const sha = task.spec?.revertSha ?? (await getLatestMergeCommit());
  if (!sha) throw new Error("Не нашёл коммит для отката");

  // Берём содержимое целевых файлов из коммита sha~1 (родителя)
  // Для простоты MVP: берём текущее содержимое и восстанавливаем дефолтные значения.
  // TODO: правильнее — git revert через GraphQL Mutation createCommitOnBranch.
  throw new Error(
    "Откат пока не реализован полностью — реализуем во второй итерации.",
  );
}
