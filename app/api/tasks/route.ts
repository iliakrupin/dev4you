import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db, tasks } from "@/lib/db";
import { runAnalysis, runImplement } from "@/lib/agent/runner";
import { ANON_USER, validateInitData } from "@/lib/telegram";

export const runtime = "nodejs"; // Octokit + Neon работают и в edge, но nodejs стабильнее
export const maxDuration = 60;

const BodySchema = z.object({
  text: z.string().min(5).max(2000),
});

export async function POST(req: NextRequest) {
  let body: { text: string };
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 },
    );
  }

  const initData = req.headers.get("x-telegram-init-data");
  let user = ANON_USER;
  if (initData) {
    const parsed = await validateInitData(initData);
    if (parsed) user = parsed;
  }

  const [task] = await db
    .insert(tasks)
    .values({
      rawText: body.text,
      telegramUserId: user.id,
      telegramUsername: user.username ?? null,
      status: "queued",
    })
    .returning();

  // Запускаем pipeline в фоне после возврата ответа.
  // analysis (1 LLM call) + implement (1 LLM call + Octokit) последовательно.
  after(async () => {
    try {
      await runAnalysis(task.id);
      await runImplement(task.id);
    } catch (err) {
      console.error(`pipeline task #${task.id} failed`, err);
    }
  });

  return NextResponse.json({ id: task.id });
}
