import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, tasks } from "@/lib/db";

export const runtime = "edge";
export const maxDuration = 10;

/**
 * Удаление одной задачи. task_events удалятся каскадом
 * (FK ON DELETE CASCADE).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  await db.delete(tasks).where(eq(tasks.id, taskId));
  return NextResponse.json({ ok: true });
}
