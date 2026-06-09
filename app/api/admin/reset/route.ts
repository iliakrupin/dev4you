import { NextResponse } from "next/server";
import { db, tasks } from "@/lib/db";
import { env } from "@/lib/env";
import {
  commitMultipleFiles,
  getAllowedFilesAtRef,
  getBaseBranchSha,
} from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Сброс приложения к git tag `demo-baseline`.
 *
 * Демо-концепция «играйте сколько хотите, всегда есть откат» сохраняется:
 * reset ПУБЛИЧНЫЙ по умолчанию — любой зритель может вернуть всё в исходное.
 * Два отличия от прежнего поведения:
 *   - только POST (GET убран: он срабатывал от prefetch/сканеров/антивирусов —
 *     случайное затирание main; reset должен быть осознанным действием);
 *   - если задан ADMIN_RESET_TOKEN — требуем его (можно закрыть доступ в любой
 *     момент без правки кода, напр. для прод-контура). Не задан — публично.
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

  // Токен опционален: enforce только если задан.
  const token = env.ADMIN_RESET_TOKEN;
  if (token) {
    const provided =
      req.headers.get("x-admin-token") ?? url.searchParams.get("token");
    if (provided !== token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

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
