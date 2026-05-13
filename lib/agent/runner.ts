import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tasks, taskEvents, type Task, type TaskSpec } from "@/lib/db";
import { llm, qwenModel } from "./llm";
import { ANALYSIS_SYSTEM, IMPLEMENT_SYSTEM } from "./prompts";
import { ALLOWED_HINT, isAllowed, isProtectedFromDeletion } from "./sandbox";
import {
  commitMultipleFiles,
  createBranch,
  deleteBranch,
  getBaseBranchSha,
  getCommit,
  getLatestMergeCommit,
  getSandboxFilesPreview,
  mergePullRequest,
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
  stream?: boolean;
}): Promise<string> {
  if (opts.stream) {
    const stream = await llm().chat.completions.create({
      model: qwenModel(),
      temperature: 0.2,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
      stream: true,
    });
    let content = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) content += delta;
    }
    return content;
  }

  // Non-streaming: для больших output Qwen иногда обрывает stream chunks
  // на середине JSON-строки → "Unterminated string". Без stream сервер
  // отдаёт ответ целиком, либо мы получаем понятный timeout.
  const res = await llm().chat.completions.create({
    model: qwenModel(),
    temperature: 0.2,
    max_tokens: opts.maxTokens,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: { type: "json_object" },
  });
  return res.choices[0]?.message?.content ?? "";
}

// ---- analysis ----

// LLM возвращает поля как угодно: строка / массив / объект. Нормализуем в строку.
const stringOrJoined = z.unknown().transform((v) => {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join("\n");
  }
  if (v === null || v === undefined) return "";
  return JSON.stringify(v, null, 2);
});

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
  filesToDelete: stringArrayLike.optional().default([]),
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
    // Подгружаем дерево whitelist-файлов с превью — даём агенту контекст
    // чтобы выбирать реальные файлы, не выдумывать имена.
    const tree = await getSandboxFilesPreview();
    await logEvent(
      taskId,
      "analysis",
      "progress",
      `Загружено дерево из ${tree.length} файлов`,
    );

    const treeBlock = tree
      .map(
        (f) =>
          `--- FILE: ${f.path} ---\n${f.preview}\n--- END: ${f.path} ---`,
      )
      .join("\n\n");

    const userMsg = [
      `Задача от пользователя:`,
      task.rawText,
      ``,
      `Дерево проекта (whitelist):`,
      treeBlock,
    ].join("\n");

    let raw = "";
    let spec: TaskSpec | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        raw = await callLlmJson({
          system: ANALYSIS_SYSTEM,
          user: userMsg,
          maxTokens: 1200,
          stream: true, // analysis output короткий, stream безопасен
        });
        spec = extractJson(raw, TaskSpecSchema);
        break;
      } catch (e) {
        lastErr = e;
        await logEvent(
          taskId,
          "analysis",
          "progress",
          `Попытка ${attempt}/3 провалилась: ${e instanceof Error ? e.message : e}`,
          { rawResponse: raw.slice(0, 500) },
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!spec) throw lastErr ?? new Error("analysis failed");

    // Доп. фильтр sandbox: даже если LLM указала запрещённые файлы — выкинем
    spec.targetFiles = spec.targetFiles.filter(isAllowed);
    // filesToDelete дополнительно фильтруется по PROTECTED_FROM_DELETION:
    // нельзя удалить структурно важные файлы (TaskCard, page.tsx и т.п.)
    spec.filesToDelete = (spec.filesToDelete ?? [])
      .filter(isAllowed)
      .filter((p) => !isProtectedFromDeletion(p));

    await setStatus(taskId, "analyzed", { spec });
    await logEvent(taskId, "analysis", "finished", "План готов", { spec });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStatus(taskId, "failed", { errorMessage: `analysis: ${msg}` });
    await logEvent(taskId, "analysis", "error", msg);
  }
}

// ---- implement ----

// Старый формат (на случай если LLM вернёт полное содержимое файла)
const FilesSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});

// Новый diff-формат: список find/replace для одного файла
const EditsSchema = z.object({
  edits: z.array(
    z.object({
      find: z.string(),
      replace: z.string(),
    }),
  ),
});

/**
 * Применяет список замен к файлу. Каждая find должна найтись в текущем
 * содержимом ровно (может встречаться несколько раз — заменим все вхождения).
 */
function applyEdits(
  source: string,
  edits: { find: string; replace: string }[],
): { content: string; applied: number; missing: string[] } {
  let result = source;
  let applied = 0;
  const missing: string[] = [];
  for (const e of edits) {
    if (!e.find) continue;
    if (!result.includes(e.find)) {
      missing.push(e.find.slice(0, 60));
      continue;
    }
    result = result.split(e.find).join(e.replace);
    applied++;
  }
  return { content: result, applied, missing };
}

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
      // Даже если skip — продолжаем (либо следующий файл, либо finalize)
      return { more: true };
    }

    const userPrompt = [
      `Задача: ${task.spec.goal}`,
      `Что изменить: ${task.spec.changes}`,
      ``,
      `Файл: ${path}`,
      `Текущее содержимое:`,
      current.content,
      ``,
      `Верни список точечных замен (find/replace) в JSON-формате:`,
      `{ "edits": [{ "find": "...", "replace": "..." }] }`,
      `Каждая find — буквальная подстрока ИЗ файла выше, replace — её новая версия.`,
    ].join("\n");

    let raw = "";
    let parsed: z.infer<typeof EditsSchema> | null = null;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        raw = await callLlmJson({
          system: IMPLEMENT_SYSTEM,
          user: userPrompt,
          maxTokens: 1500, // diff-формат короткий, 1500 токенов хватает на 5-10 замен
          stream: false,
        });
        parsed = extractJson(raw, EditsSchema);
        break;
      } catch (e) {
        lastErr = e;
        await logEvent(
          taskId,
          "implement",
          "progress",
          `Попытка ${attempt}/3 для ${path} провалилась: ${e instanceof Error ? e.message : e}`,
          { rawResponse: raw.slice(0, 300) },
        );
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!parsed) throw lastErr ?? new Error("implement failed");

    if (parsed.edits.length === 0) {
      throw new Error(
        `Модель не вернула ни одной замены для ${path} — возможно, не смогла найти что менять`,
      );
    }

    const result = applyEdits(current.content, parsed.edits);
    if (result.applied === 0) {
      throw new Error(
        `Ни одна замена не применилась — find-строки не найдены в файле. Промахи: ${result.missing.join("; ")}`,
      );
    }
    if (result.missing.length > 0) {
      await logEvent(
        taskId,
        "implement",
        "progress",
        `Применено ${result.applied}/${parsed.edits.length} замен. Промахи: ${result.missing.join("; ")}`,
      );
    }

    produced = [
      ...produced,
      { path, content: result.content, sha: current.sha },
    ];
    pending = pending.slice(1);

    await setStatus(taskId, "implementing", {
      pendingFiles: pending,
      producedFiles: produced,
    });
    await logEvent(taskId, "implement", "progress", `Готов файл ${path}`);

    // Если это был последний файл — finalize прямо здесь, не полагаясь на
    // self-trigger fetch (он иногда не доходит из Edge after()). У нас ещё
    // есть бюджет 25s, finalize — это 3 быстрых API-вызова.
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
  if (!task.spec) throw new Error("нет spec");

  const filesToDelete = task.spec.filesToDelete ?? [];
  if (produced.length === 0 && filesToDelete.length === 0) {
    throw new Error("Не получилось сгенерировать или удалить ни одного файла");
  }

  const baseSha = await getBaseBranchSha();
  const branch = `task/${taskId}`;
  await createBranch(branch, baseSha);

  // Один GraphQL вызов: и additions, и deletions
  await commitMultipleFiles({
    branch,
    expectedHeadOid: baseSha,
    message: `task #${taskId}: ${task.spec.goal}`,
    files: produced.map((f) => ({ path: f.path, content: f.content })),
    deletions: filesToDelete,
  });

  const fileSummary = [
    ...produced.map((f) => `~ \`${f.path}\``),
    ...filesToDelete.map((p) => `× \`${p}\` (удалён)`),
  ].join(", ");

  const pr = await openPullRequest({
    branch,
    title: `task #${taskId}: ${task.spec.goal}`.slice(0, 72),
    body: [
      `**Задача:** ${task.rawText}`,
      ``,
      `**План:** ${task.spec.changes}`,
      ``,
      `**Файлы:** ${fileSummary}`,
      ``,
      `_Создано агентом ФичуЗадачу._`,
    ].join("\n"),
  });

  await setStatus(taskId, "ready_for_review", {
    branchName: branch,
    prNumber: pr.number,
    prUrl: pr.url,
    touchedFiles: [...produced.map((f) => f.path), ...filesToDelete],
  });
  await logEvent(taskId, "implement", "finished", `PR #${pr.number} открыт`, {
    pr,
  });

  // WORKAROUND: Vercel preview provisioning сейчас сломан (Resource provisioning
  // failed). Не ждём preview success — мержим сразу через Octokit, полагаемся
  // на production build как тест. Если main упадёт, предыдущая prod-версия
  // продолжит работать, а задачу можно будет отметить failed позже из
  // production deployment_status webhook.
  try {
    await setStatus(taskId, "deploying");
    await logEvent(
      taskId,
      "deploy",
      "started",
      `Мержу PR #${pr.number} в main (preview build пропущен — Vercel issue)`,
    );
    const merged = await mergePullRequest(pr.number);
    await setStatus(taskId, "merged", { mergeCommitSha: merged.sha });
    await logEvent(
      taskId,
      "deploy",
      "finished",
      `Внедрено в main: ${merged.sha.slice(0, 7)}`,
    );
    // Cleanup task-ветки — освобождает Vercel preview branch slot.
    // Не критично если упало (просто логируем).
    try {
      await deleteBranch(branch);
    } catch (e) {
      await logEvent(
        taskId,
        "deploy",
        "progress",
        `Не смог удалить ветку ${branch}: ${e instanceof Error ? e.message : e}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setStatus(taskId, "failed", { errorMessage: `deploy: ${msg}` });
    await logEvent(taskId, "deploy", "error", msg);
  }
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
