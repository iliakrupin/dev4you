import { NextResponse } from "next/server";
import { db, tasks } from "@/lib/db";
import {
  commitMultipleFiles,
  getAllowedFilesAtRef,
  getBaseBranchSha,
} from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Сброс приложения к git tag `demo-baseline`. Намеренно ПУБЛИЧНЫЙ —
 * любой зритель демо может тыкнуть и вернуть всё в исходное состояние.
 * Это часть концепции «играйте сколько хотите, всегда есть откат».
 *
 * Что делает:
 * 1. Читает все whitelist-файлы из tag demo-baseline
 * 2. Одним GraphQL-коммитом перезаписывает их в main
 * 3. Удаляет все задачи из БД (?clearTasks=false если не нужно)
 *
 * После reset Vercel пересобирает production автоматически.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const clearTasks = url.searchParams.get("clearTasks") !== "false";

  try {
    const files = await getAllowedFilesAtRef("demo-baseline");
    if (files.length === 0) {
      return NextResponse.json(
        { error: "В tag demo-baseline нет whitelist-файлов" },
        { status: 500 },
      );
    }

    const baseSha = await getBaseBranchSha();
    const result = await commitMultipleFiles({
      branch: "main",
      expectedHeadOid: baseSha,
      message: `chore: reset to demo-baseline (${files.length} files)`,
      files,
    });

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

// GET тоже разрешён — удобно дёрнуть прямо из адресной строки браузера
export const GET = POST;
