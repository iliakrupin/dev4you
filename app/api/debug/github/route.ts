import { NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Диагностический endpoint — показывает что Vercel-side видит про GitHub.
 * Не возвращает значения секретов, только маски и результаты вызовов.
 *
 * TODO: удалить после отладки.
 */
export async function GET() {
  const token = process.env.GITHUB_TOKEN ?? "";
  const owner = process.env.GITHUB_OWNER ?? "";
  const repo = process.env.GITHUB_REPO ?? "";
  const baseBranch = process.env.GITHUB_BASE_BRANCH ?? "main";

  const tokenInfo = {
    set: !!token,
    length: token.length,
    prefix: token.slice(0, 11),
    suffix: token.slice(-4),
  };

  const result: Record<string, unknown> = {
    env: {
      GITHUB_OWNER: owner,
      GITHUB_REPO: repo,
      GITHUB_BASE_BRANCH: baseBranch,
      GITHUB_TOKEN: tokenInfo,
    },
  };

  if (!token || !owner || !repo) {
    result.error = "missing env vars";
    return NextResponse.json(result, { status: 500 });
  }

  const oct = new Octokit({ auth: token });

  try {
    const { data: viewer } = await oct.request("GET /user");
    result.tokenViewer = { login: viewer.login, id: viewer.id };
  } catch (err) {
    result.tokenViewer = { error: errMsg(err) };
  }

  try {
    const { data: r } = await oct.repos.get({ owner, repo });
    result.repoVisible = {
      full_name: r.full_name,
      default_branch: r.default_branch,
      private: r.private,
    };
  } catch (err) {
    result.repoVisible = { error: errMsg(err) };
  }

  try {
    const { data: ref } = await oct.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    result.baseRef = { sha: ref.object.sha };
  } catch (err) {
    result.baseRef = { error: errMsg(err) };
  }

  return NextResponse.json(result, { status: 200 });
}

function errMsg(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const status = "status" in e ? (e as { status: number }).status : "?";
    const msg =
      "message" in e ? (e as { message: string }).message : String(e);
    return `${status}: ${msg}`;
  }
  return String(e);
}
