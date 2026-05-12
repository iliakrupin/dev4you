import { after, NextResponse, type NextRequest } from "next/server";
import { runImplement } from "@/lib/agent/runner";

export const runtime = "edge";
export const maxDuration = 25;

/**
 * Внутренний триггер этапа implement. Вызывается из runAnalysis после
 * успешного анализа (fire-and-forget fetch), чтобы каждый шаг получил
 * свои 25s Edge-таймаута, а не делил один общий.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${_req.headers.get("host")}`;

  after(async () => {
    try {
      const result = await runImplement(taskId);
      if (result.more) {
        // Ещё есть файлы / нужен finalize PR — триггерим следующий шаг
        await fetch(`${appUrl}/api/tasks/${taskId}/implement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (err) {
      console.error(`implement task #${taskId}`, err);
    }
  });

  return NextResponse.json({ ok: true, started: taskId });
}
