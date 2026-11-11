// Repository + issue context for the AI contribution guide, fetched server-side from the official GitHub REST API (never scraped).
// `GITHUB_TOKEN` is optional and only raises the rate limit. Everything the guide may cite comes from here.
import { httpRequest } from "@/lib/ingestion/http";
import { IngestError } from "@/lib/ingestion/types";

export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export class GithubError extends Error {
  constructor(public code: "invalid" | "not_found" | "rate_limited" | "is_pull_request" | "issue_closed" | "unavailable", message: string) { super(message); }
}

export interface IssueContext {
  repo: string; number: number; url: string;
  issue: { title: string; body: string; state: "open" | "closed"; labels: string[]; assignees: string[]; comments: number; updatedAt: string; createdAt: string };
  repository: { description: string | null; language: string | null; stars: number; archived: boolean; license: string | null; defaultBranch: string };
  readme: string | null; contributing: string | null;
  /** Names in the repository root. The ONLY paths the guide is allowed to point at. */
  rootEntries: { name: string; type: "file" | "dir" }[];
}
export type GetJson = (url: string) => Promise<unknown>;

export const defaultGetJson: GetJson = async (url) => {
  const token = process.env.GITHUB_TOKEN;
  try {
    const r = await httpRequest(url, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, timeoutMs: 15_000, maxBytes: 3_000_000 });
    return JSON.parse(r.text);
  } catch (e) {
    const ie = e instanceof IngestError ? e : null;
    if (ie?.status === 404) throw new GithubError("not_found", "Not found on GitHub (it may be private, renamed or deleted).");
    if (ie && (ie.category === "rate_limited" || ie.category === "blocked" || ie.status === 403 || ie.status === 429)) throw new GithubError("rate_limited", "GitHub's API limit was reached. Try again later (the server can use a GITHUB_TOKEN for a higher limit).");
    throw new GithubError("unavailable", "GitHub could not be reached right now.");
  }
};

const b64 = (v: unknown) => (typeof v === "string" ? Buffer.from(v.replace(/\n/g, ""), "base64").toString("utf8") : null);
const cut = (s: string | null, n: number) => (s ? s.slice(0, n) : null);

/** Open, non-PR issues only. Throws GithubError for pull requests, closed issues and missing repos. */
export async function loadIssueContext(repo: string, number: number, get: GetJson = defaultGetJson): Promise<IssueContext> {
  if (!REPO_RE.test(repo) || !Number.isInteger(number) || number < 1 || number > 10_000_000) throw new GithubError("invalid", "That is not a valid repository or issue number.");
  const base = `https://api.github.com/repos/${repo}`;
  const i = (await get(`${base}/issues/${number}`)) as Record<string, any>;
  if (i.pull_request) throw new GithubError("is_pull_request", "That number is a pull request, not an issue.");
  if (i.state !== "open") throw new GithubError("issue_closed", "That issue is closed.");
  const [repoInfo, readme, contributing, root] = await Promise.all([
    get(base) as Promise<Record<string, any>>,
    get(`${base}/readme`).then((r) => cut(b64((r as any)?.content), 7000)).catch(() => null),
    get(`${base}/contents/CONTRIBUTING.md`).then((r) => cut(b64((r as any)?.content), 5000)).catch(() => null),
    get(`${base}/contents/`).catch(() => []),
  ]);
  return {
    repo, number, url: String(i.html_url ?? `https://github.com/${repo}/issues/${number}`),
    issue: { title: String(i.title ?? "").slice(0, 300), body: String(i.body ?? "").slice(0, 6000), state: "open", labels: (i.labels ?? []).map((l: any) => String(l?.name ?? l)).slice(0, 12), assignees: (i.assignees ?? []).map((a: any) => String(a?.login)).slice(0, 5), comments: Number(i.comments ?? 0), updatedAt: String(i.updated_at ?? ""), createdAt: String(i.created_at ?? "") },
    repository: { description: repoInfo.description ?? null, language: repoInfo.language ?? null, stars: Number(repoInfo.stargazers_count ?? 0), archived: repoInfo.archived === true, license: repoInfo.license?.spdx_id ?? null, defaultBranch: String(repoInfo.default_branch ?? "main") },
    readme, contributing,
    rootEntries: (Array.isArray(root) ? root : []).slice(0, 80).map((e: any) => ({ name: String(e.name), type: e.type === "dir" ? "dir" as const : "file" as const })),
  };
}
