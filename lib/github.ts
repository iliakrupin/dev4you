import { Octokit } from "@octokit/rest";
import { env } from "@/lib/env";
import { assertAllowed } from "@/lib/agent/sandbox";

export const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

const owner = env.GITHUB_OWNER;
const repo = env.GITHUB_REPO;
const baseBranch = env.GITHUB_BASE_BRANCH;

export async function getBaseBranchSha(): Promise<string> {
  const { data } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });
  return data.object.sha;
}

export async function createBranch(
  branchName: string,
  fromSha: string,
): Promise<void> {
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: fromSha,
  });
}

export async function readFile(
  path: string,
  ref?: string,
): Promise<{ content: string; sha: string } | null> {
  assertAllowed(path);
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    if (Array.isArray(data) || data.type !== "file") return null;
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { content, sha: data.sha };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "status" in e &&
      (e as { status: number }).status === 404
    ) {
      return null;
    }
    throw e;
  }
}

export async function writeFile(opts: {
  path: string;
  content: string;
  branch: string;
  message: string;
  prevSha?: string;
}): Promise<void> {
  assertAllowed(opts.path);
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: opts.path,
    branch: opts.branch,
    message: opts.message,
    content: Buffer.from(opts.content, "utf-8").toString("base64"),
    sha: opts.prevSha,
  });
}

export async function openPullRequest(opts: {
  branch: string;
  title: string;
  body: string;
}): Promise<{ number: number; url: string }> {
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    head: opts.branch,
    base: baseBranch,
    title: opts.title,
    body: opts.body,
  });
  return { number: data.number, url: data.html_url };
}

export async function mergePullRequest(
  prNumber: number,
): Promise<{ sha: string }> {
  const { data } = await octokit.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    merge_method: "squash",
  });
  return { sha: data.sha };
}

export async function getLatestMergeCommit(): Promise<string | null> {
  const { data } = await octokit.repos.listCommits({
    owner,
    repo,
    sha: baseBranch,
    per_page: 20,
  });
  // Берём последний squash-merge коммит (у него message обычно начинается с "feat" / содержит "(#N)")
  const merge = data.find((c) => /\(#\d+\)/.test(c.commit.message));
  return merge?.sha ?? null;
}
