import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  pgEnum,
  bigint,
} from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", [
  "queued",
  "analyzing",
  "analyzed",
  "implementing",
  "implemented",
  "testing",
  "tested",
  "deploying",
  "ready_for_review",
  "merged",
  "failed",
  "cancelled",
]);

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Telegram user id, кто поставил задачу
  telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
  telegramUsername: text("telegram_username"),
  // Сырая постановка от пользователя
  rawText: text("raw_text").notNull(),
  // Структурированная спецификация (заполняется на этапе analysis)
  spec: jsonb("spec").$type<TaskSpec | null>(),
  status: taskStatusEnum("status").notNull().default("queued"),
  // Какие файлы агент менял
  touchedFiles: jsonb("touched_files").$type<string[]>().default([]),
  // Очередь файлов на обработку (инкрементальный implement, по одному за HTTP)
  pendingFiles: jsonb("pending_files").$type<string[] | null>().default(null),
  // Уже сгенерированное LLM содержимое файлов (path → content)
  producedFiles: jsonb("produced_files")
    .$type<{ path: string; content: string; sha?: string }[] | null>()
    .default(null),
  // Git
  branchName: text("branch_name"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  previewUrl: text("preview_url"),
  mergeCommitSha: text("merge_commit_sha"),
  // Ошибка, если failed
  errorMessage: text("error_message"),
});

export const taskEvents = pgTable("task_events", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // 'analysis' | 'implement' | 'test' | 'deploy' | 'system'
  stage: text("stage").notNull(),
  // 'started' | 'progress' | 'finished' | 'error'
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  // Метаданные шага (LLM tokens, file diff и т.п.)
  metadata: jsonb("metadata"),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;

// Структурированная спецификация, которую возвращает агент-аналитик
export type TaskSpec = {
  goal: string;
  // Какие файлы предположительно нужно изменить (из whitelist)
  targetFiles: string[];
  // Конкретные изменения, которые нужно сделать
  changes: string;
  // Критерии приёмки
  acceptanceCriteria: string[];
  // Предполагаемая операция: 'edit' | 'revert'
  operation: "edit" | "revert";
  // Если revert — sha коммита для отката (опционально)
  revertSha?: string;
};
