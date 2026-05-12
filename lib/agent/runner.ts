import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tasks, taskEvents, type Task, type TaskSpec } from "@/lib/db";
import { llm, qwenModel } from "./llm";
import { ANALYSIS_SYSTEM, IMPLEMENT_SYSTEM } from "./prompts";
import { ALLOWED_HINT, isAllowed } from "./sandbox";
import {
  createBranch,
  getBaseBranchSha,
  getCommit,
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
  let text = raw.trim();
  if (!text) {
    throw new Error(
      "LLM вернул пустой ответ (возможно сервер Qwen перегружен или Vercel прервал по timeout). Попробуйте ещё раз.",
    );
  }
  // Иногда модель оборачивает JSON в ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // Иногда добавляет leading prose — берём от первой { до последней }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    text = text.slice(start, end + 1);
  }
  if (!text || text === "{}" || text.startsWith("{") === false) {
    throw new Error(
      `LLM не вернул валидный JSON. Ответ: ${raw.slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(text);
  return schema.parse(parsed);
}

async function callLlmJson(opts: {
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const completion = await llm().chat.completions.create({
    model: qwenModel(),
    temperature: 0.2,
    max_tokens: opts.maxTokens,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: { type: "json_object" },
  });
  return completion.choices[0]?.message?.content ?? "";
}

// ---- analysis ----

// LLM иногда возвращает поля как массив, иногда как строку — нормализуем.
const stringOrJoined = z
  .union([z.string(), z.array(z.union([z.string(), z.unknown()]))])
  .transform((v) =>
    Array.isArray(v)
      ? v
          .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
          .join("\n")
      : v,
  );

const stringArrayLike = z
  .union([z.array(z.string()), z.string()])
  .transform((v) =>
    Array.isArray(v)
      ? v
      : v
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
  );

const TaskSpecSchema = z.object({
  goal: z.string(),
  targetFiles: stringArrayLike,
  changes: stringOrJoined,
  acceptanceCriteria: stringArrayLike,
  operation: z.enum(["edit", "revert"]).default("edit"),
  revertSha: z.string().optional(),
});

export async function runAnalysis(taskId: number): Promise<void> {
  const task = await getTask(taskId);
  if (!task) return;
  if (task.status !== "queued" && task.status !== "analyzing") return;

  await setStatus(taskId, "analyzing");
  await logEvent(taskId, "analysis", "started", "Анализирую задачу…");

  try {
    let raw = "";
    let spec: TaskSpec | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        raw = await callLlmJson({
          system: ANALYSIS_SYSTEM,
          user: task.rawText,
          maxTokens: 800,
        });
        spec = extractJson(raw, TaskSpecSchema);
        break;
      } catch (e) {
        lastErr = e;
        await logEvent(
          taskId,
          "analysis",
          "progress",
          `Попытка ${attempt} провалилась: ${e instanceof Error ? e.message : e}`,
          { rawResponse: raw.slice(0, 500) },
        );
      }
    }
    if (!spec) throw lastErr ?? new Error("analysis failed");

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

/**
 * Один шаг инкрементального implement: либо обрабатываем один файл из
 * pendingFiles, либо (если очередь пуста) собираем PR. Возвращает true,
 * если есть ещё работа — вызывающий код делает self-trigger.
 */
export async function runImplement(taskId: number): Promise<{ more: boolean }> {
  const task = await getTask(taskId);
  if (!task) return { more: false };
  if (task.status !== "analyzed" && task.status !== "implementing") {
    return { more: false };
  }
  if (!task.spec) {
    await setStatus(taskId, "failed", { errorMessage: "implement: нет spec" });
    return { more: false };
  }

  // revert идёт отдельным путём (не использует LLM на каждом файле)
  if (task.spec.operation === "revert") {
    await setStatus(taskId, "implementing");
    await logEvent(taskId, "implement", "started", "Откатываю…");
    try {
      await runRevert(taskId, task);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setStatus(taskId, "failed", { errorMessage: `implement: ${msg}` });
      await logEvent(taskId, "implement", "error", msg);
    }
    return { more: false };
  }

  // Инициализация очереди файлов на первом вызове
  let pending = task.pendingFiles;
  let produced = task.producedFiles ?? [];
  if (pending === null) {
    pending = [...task.spec.targetFiles];
    await setStatus(taskId, "implementing", {
      pendingFiles: pending,
      producedFiles: [],
    });
    await logEvent(
      taskId,
      "implement",
      "started",
      `Буду менять ${pending.length} файл(ов)`,
      { files: pending },
    );
  }

  // Если файлов больше нет — собираем PR
  if (pending.length === 0) {
    try {
      await finalizeImplement(taskId, task, produced);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setStatus(taskId, "failed", { errorMessage: `implement: ${msg}` });
      await logEvent(taskId, "implement", "error", msg);
    }
    return { more: false };
  }

  // Берём один файл и делаем для него LLM-вызов
  const path = pending[0];
  await logEvent(taskId, "implement", "progress", `Меняю ${path}…`);

  try {
    const current = await readFile(path);
    if (!current) {
      await logEvent(
        taskId,
        "implement",
        "progress",
        `Файл ${path} не найден — пропускаю`,
      );
      pending = pending.slice(1);
      await setStatus(taskId, "implementing", { pendingFiles: pending });
      return { more: pending.length > 0 || produced.length > 0 };
    }

    const userPrompt = [
      `Задача: ${task.spec.goal}`,
      `Что изменить: ${task.spec.changes}`,
      ``,
      `Сейчас редактируем ОДИН файл: ${path}`,
      `Текущее содержимое:`,
      `--- BEGIN ${path} ---`,
      current.content,
      `--- END ${path} ---`,
      ``,
      `Верни JSON: { "files": [ { "path": "${path}", "content": "<новое содержимое>" } ] }.`,
      `Никаких других файлов.`,
    ].join("\n");

    let raw = "";
    let parsed: z.infer<typeof FilesSchema> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        raw = await callLlmJson({
          system: IMPLEMENT_SYSTEM,
          user: userPrompt,
          maxTokens: 4000,
        });
        parsed = extractJson(raw, FilesSchema);
        break;
      } catch (e) {
        lastErr = e;
        await logEvent(
          taskId,
          "implement",
          "progress",
          `Попытка ${attempt} для ${path} провалилась: ${e instanceof Error ? e.message : e}`,
          { rawResponse: raw.slice(0, 300) },
        );
      }
    }
    if (!parsed) throw lastErr ?? new Error("implement failed");

    const fileResult =
      parsed.files.find((f) => f.path === path) ??
      parsed.files.find((f) => isAllowed(f.path));
    if (!fileResult || !isAllowed(fileResult.path)) {
      throw new Error(
        `Модель не вернула правильный файл (ожидался ${path}, вернула: ${parsed.files.map((f) => f.path).join(", ")})`,
      );
    }

    produced = [
      ...produced,
      { path, content: fileResult.content, sha: current.sha },
    ];
    pending = pending.slice(1);

    await setStatus(taskId, "implementing", {
      pendingFiles: pending,
      producedFiles: produced,
    });
    await logEvent(taskId, "implement", "progress", `Готов файл ${path}`);

    return { more: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStatus(taskId, "failed", { errorMessage: `implement: ${msg}` });
    await logEvent(taskId, "implement", "error", msg);
    return { more: false };
  }
}

async function finalizeImplement(
  taskId: number,
  task: Task,
  produced: { path: string; content: string; sha?: string }[],
): Promise<void> {
  if (produced.length === 0) {
    throw new Error("Не получилось сгенерировать ни одного файла");
  }
  if (!task.spec) throw new Error("нет spec");

  const baseSha = await getBaseBranchSha();
  const branch = `task/${taskId}`;
  await createBranch(branch, baseSha);

  for (const f of produced) {
    await writeFile({
      path: f.path,
      content: f.content,
      branch,
      message: `task #${taskId}: ${task.spec.goal}`.slice(0, 72),
      prevSha: f.sha,
    });
  }

  const pr = await openPullRequest({
    branch,
    title: `task #${taskId}: ${task.spec.goal}`.slice(0, 72),
    body: [
      `**Задача:** ${task.rawText}`,
      ``,
      `**План:** ${task.spec.changes}`,
      ``,
      `**Файлы:** ${produced.map((f) => `\`${f.path}\``).join(", ")}`,
      ``,
      `_Создано агентом ФичуЗадачу._`,
    ].join("\n"),
  });

  await setStatus(taskId, "ready_for_review", {
    branchName: branch,
    prNumber: pr.number,
    prUrl: pr.url,
    touchedFiles: produced.map((f) => f.path),
  });
  await logEvent(taskId, "implement", "finished", `PR #${pr.number} открыт`, {
    pr,
  });
}

async function runRevert(taskId: number, task: Task): Promise<void> {
  await logEvent(taskId, "implement", "progress", "Ищу коммит для отката");

  const mergeSha = task.spec?.revertSha ?? (await getLatestMergeCommit());
  if (!mergeSha) throw new Error("Не нашёл merge-коммит для отката");

  // Получаем merge-коммит вместе со списком изменённых файлов и родителем.
  const merge = await getCommit(mergeSha);
  const parentSha = merge.parents[0]?.sha;
  if (!parentSha) throw new Error(`У коммита ${mergeSha} нет родителя`);

  const changedFiles = merge.files
    .map((f) => f.filename)
    .filter((p) => isAllowed(p));

  if (changedFiles.length === 0) {
    throw new Error("В целевом коммите нет файлов из sandbox для отката");
  }

  await logEvent(
    taskId,
    "implement",
    "progress",
    `Откатываю ${changedFiles.length} файл(ов) до ${parentSha.slice(0, 7)}`,
    { mergeSha, parentSha, files: changedFiles },
  );

  // Для каждого изменённого файла — берём содержимое из родителя merge-коммита
  // (то есть из состояния "до того изменения") и записываем в новую ветку.
  const restored: { path: string; content: string; sha?: string }[] = [];
  for (const path of changedFiles) {
    const parentFile = await readFile(path, parentSha);
    const headFile = await readFile(path);
    if (!parentFile) continue; // файл был создан этим merge — пропускаем (для MVP)
    if (parentFile.content === headFile?.content) continue;
    restored.push({
      path,
      content: parentFile.content,
      sha: headFile?.sha,
    });
  }

  if (restored.length === 0) {
    throw new Error("Откатывать нечего — файлы уже в нужном состоянии");
  }

  const baseSha = await getBaseBranchSha();
  const branch = `task/${taskId}`;
  await createBranch(branch, baseSha);

  for (const f of restored) {
    await writeFile({
      path: f.path,
      content: f.content,
      branch,
      message: `revert #${taskId}: вернуть ${f.path} к ${parentSha.slice(0, 7)}`.slice(
        0,
        72,
      ),
      prevSha: f.sha,
    });
  }

  const pr = await openPullRequest({
    branch,
    title: `revert #${taskId}: ${task.spec?.goal ?? "откат изменений"}`.slice(
      0,
      72,
    ),
    body: [
      `**Задача:** ${task.rawText}`,
      ``,
      `**Откат коммита:** \`${mergeSha.slice(0, 7)}\` → возвращаю к \`${parentSha.slice(0, 7)}\``,
      ``,
      `**Файлы:** ${restored.map((f) => `\`${f.path}\``).join(", ")}`,
      ``,
      `_Создано агентом ФичуЗадачу._`,
    ].join("\n"),
  });

  await setStatus(taskId, "ready_for_review", {
    branchName: branch,
    prNumber: pr.number,
    prUrl: pr.url,
    touchedFiles: restored.map((f) => f.path),
  });
  await logEvent(
    taskId,
    "implement",
    "finished",
    `PR #${pr.number} с откатом открыт`,
    { pr, mergeSha, parentSha },
  );
}
