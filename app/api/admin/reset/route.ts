import { NextResponse, type NextRequest } from "next/server";
import { db, tasks } from "@/lib/db";
import {
  commitMultipleFiles,
  getAllowedFilesAtRef,
  getBaseBranchSha,
} from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Сброс приложения к состоянию, зафиксированному в git tag `demo-baseline`.
 * Нужен после демонстрации, когда зрители сильно изменили UI.
 *
 * Защита: header X-Admin-Token == env ADMIN_TOKEN.
 *
 * Что делает:
 * 1. Читает все whitelist-файлы из tag demo-baseline
 * 2. Одним коммитом перезаписывает их в main через GraphQL
 * 3. (по флагу clearTasks=true) удаляет все задачи из БД
 *
 * После reset Vercel пересоберёт production автоматически.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN не настроен в env" },
      { status: 500 },
    );
  }
  const provided = req.headers.get("x-admin-token");
  if (provided !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const clearTasks = url.searchParams.get("clearTasks") === "true";

  try {
    // 1. Скачиваем все whitelist-файлы из tag demo-baseline
    const files = await getAllowedFilesAtRef("demo-baseline");
    if (files.length === 0) {
      return NextResponse.json(
        { error: "В tag demo-baseline нет whitelist-файлов" },
        { status: 500 },
      );
    }

    // 2. Один коммит на main, перезаписывающий все эти файлы
    const baseSha = await getBaseBranchSha();
    const result = await commitMultipleFiles({
      branch: "main",
      expectedHeadOid: baseSha,
      message: `chore: reset to demo-baseline (${files.length} files)`,
      files,
    });

    // 3. Опционально — чистим БД
    let tasksDeleted = 0;
    if (clearTasks) {
      const deleted = await db.delete(tasks).returning({ id: tasks.id });
      tasksDeleted = deleted.length;
    }

    return NextResponse.json({
      ok: true,
      restoredFiles: files.length,
      newSha: result.oid,
      tasksDeleted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
