import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    deployedAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  });
}
