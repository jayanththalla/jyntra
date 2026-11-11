// Orchestration for the contribution workspace. The guide is generated from retrieved GitHub material only, validated and grounded,
// cached per user+issue, and never posts anything to GitHub.
import { AiError, completeText, configuredProviders, type AiDeps } from "@/lib/ai/outreach";
import { depsFromEnv } from "@/lib/ai/service";
import type { AppUser } from "@/lib/users";
import { GithubError, defaultGetJson, loadIssueContext, type GetJson } from "./github";
import { buildAskPrompt, buildGuidePrompt, parseGuide } from "./guide";
import { getContribution, setSaved, setStep, storeGuide } from "./store";

export interface ServiceResult { status: number; body: Record<string, unknown> }
const GUIDE_TTL_MS = 7 * 24 * 3600_000;
const bad = (error: string): ServiceResult => ({ status: 400, body: { ok: false, error } });

function failure(e: unknown): ServiceResult {
  if (e instanceof GithubError) return { status: e.code === "not_found" ? 404 : e.code === "rate_limited" ? 429 : e.code === "unavailable" ? 502 : 422, body: { ok: false, code: e.code, message: e.message } };
  if (e instanceof AiError) { console.error(`[open-source] ${e.code}`); return { status: e.code === "rate_limited" ? 429 : 502, body: { ok: false, code: e.code, message: e.message, retryable: e.retryable } }; }
  console.error("[open-source] unexpected:", (e as Error).name, (e as Error).message);
  return { status: 502, body: { ok: false, code: "bad_output", message: "The AI returned something we couldn't use. Try again.", retryable: true } };
}

export async function contributionForUser(user: AppUser, raw: unknown, deps: AiDeps = depsFromEnv(), get: GetJson = defaultGetJson): Promise<ServiceResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("invalid_request");
  const b = raw as Record<string, unknown>;
  const repo = typeof b.repo === "string" ? b.repo : "", n = typeof b.number === "number" ? b.number : NaN;
  try {
    if (b.action === "progress" || b.action === "save") {
      // No GitHub call needed: these only touch the user's own record. Title/URL come from a prior guide or the client label.
      const title = typeof b.title === "string" ? b.title : "Issue", url = `https://github.com/${repo}/issues/${n}`;
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(repo) || !Number.isInteger(n) || n < 1) return bad("invalid_issue");
      if (b.action === "save") { await setSaved(user.id, { repo, number: n, title, url }, b.saved === true); return { status: 200, body: { ok: true } }; }
      const steps = await setStep(user.id, { repo, number: n, title, url }, String(b.step), b.done === true);
      return steps ? { status: 200, body: { ok: true, done_steps: steps } } : bad("invalid_step");
    }
    if (b.action !== "guide" && b.action !== "ask") return bad("invalid_action");
    if (configuredProviders(deps).length === 0) return { status: 200, body: { ok: false, code: "not_configured", message: "The AI guide isn't set up on this server (no GROQ_API_KEY or GEMINI_API_KEY)." } };
    const cached = await getContribution(user.id, repo, n);
    if (b.action === "guide" && cached?.guide && cached.guide_at && Date.now() - Date.parse(cached.guide_at) < GUIDE_TTL_MS && b.refresh !== true) {
      return { status: 200, body: { ok: true, guide: cached.guide, cached: true, done_steps: cached.done_steps, saved: cached.saved, issue: { title: cached.issue_title, url: cached.issue_url } } };
    }
    const ctx = await loadIssueContext(repo, n, get); // throws for PRs, closed issues, private/missing repos
    if (b.action === "ask") {
      const q = typeof b.question === "string" ? b.question.trim() : "";
      if (q.length < 3 || q.length > 400) return bad("invalid_question");
      const r = await completeText(buildAskPrompt(ctx, q), deps);
      return { status: 200, body: { ok: true, answer: r.text.trim().slice(0, 1500), provider: r.provider } };
    }
    const r = await completeText(buildGuidePrompt(ctx), deps);
    const guide = parseGuide(r.text, ctx);
    await storeGuide(user.id, { repo, number: n, title: ctx.issue.title, url: ctx.url }, guide);
    const fresh = await getContribution(user.id, repo, n);
    return { status: 200, body: { ok: true, guide, cached: false, done_steps: fresh?.done_steps ?? [], saved: fresh?.saved ?? false, issue: { title: ctx.issue.title, url: ctx.url, assigned: ctx.issue.assignees.length > 0, labels: ctx.issue.labels, updatedAt: ctx.issue.updatedAt }, repository: ctx.repository, provider: r.provider } };
  } catch (e) {
    return failure(e);
  }
}
