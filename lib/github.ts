import { Octokit } from "@octokit/rest";
import { env } from "@/lib/env";
import { assertAllowed } from "@/lib/agent/sandbox";

export const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

const owner = env.GITHUB_OWNER;
const repo = env.GITHUB_REPO;
const baseBranch = env.GITHUB_BASE_BRANCH;

// Edge-friendly base64 (без Node Buffer)
function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(b64: string): string {
  // GitHub возвращает base64 со переводами строк — atob их не любит
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Кэш base-SHA на 30 секунд: SHA main меняется редко, экономит 1 API call на задачу
let baseShaCache: { sha: string; ts: number } | null = null;
const BASE_SHA_TTL_MS = 30_000;

export async function getBaseBranchSha(): Promise<string> {
  const now = Date.now();
  if (baseShaCache && now - baseShaCache.ts < BASE_SHA_TTL_MS) {
    return baseShaCache.sha;
  }
  const { data } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });
  baseShaCache = { sha: data.object.sha, ts: now };
  return data.object.sha;
}

/**
 * Один GraphQL вызов записывает все файлы коммитом — экономит N-1 REST вызовов
 * по сравнению с writeFile в цикле. GitLab имеет похожий API (commits.create
 * с массивом actions), так что переход не закроет дверь.
 */
export async function commitMultipleFiles(opts: {
  branch: string;
  expectedHeadOid: string;
  message: string;
  files: { path: string; content: string }[];
}): Promise<{ oid: string }> {
  for (const f of opts.files) assertAllowed(f.path);

  const result = await octokit.graphql<{
    createCommitOnBranch: { commit: { oid: string } };
  }>(
    `mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) {
        commit { oid }
      }
    }`,
    {
      input: {
        branch: {
          repositoryNameWithOwner: `${owner}/${repo}`,
          branchName: opts.branch,
        },
        message: { headline: opts.message.slice(0, 72) },
        expectedHeadOid: opts.expectedHeadOid,
        fileChanges: {
          additions: opts.files.map((f) => ({
            path: f.path,
            contents: b64encode(f.content),
          })),
        },
      },
    },
  );
  return { oid: result.createCommitOnBranch.commit.oid };
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
    const content = b64decode(data.content);
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
    content: b64encode(opts.content),
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

export async function findPullRequestForSha(
  sha: string,
): Promise<{ number: number; head: string } | null> {
  const { data } = await octokit.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: sha,
  });
  const pr = data.find((p) => p.head.ref.startsWith("task/"));
  if (!pr) return null;
  return { number: pr.number, head: pr.head.ref };
}

export async function getCommit(sha: string): Promise<{
  parents: { sha: string }[];
  files: { filename: string }[];
}> {
  const { data } = await octokit.repos.getCommit({ owner, repo, ref: sha });
  return {
    parents: data.parents.map((p) => ({ sha: p.sha })),
    files: (data.files ?? []).map((f) => ({ filename: f.filename })),
  };
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
