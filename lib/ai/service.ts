// Server-side orchestration for AI outreach. The browser sends only IDs and a style; the company and the
// candidate's facts are loaded here from the database, so the draft is built from verified records and
// not from whatever a client claims.
import { loadStartups } from "@/lib/discovery/read";
import type { AppUser } from "@/lib/users";
import { AiError, OUTREACH_STYLES, cleanKey, clean, configuredProviders, generateOutreach, type AiDeps, type OutreachContext, type OutreachStyle } from "./outreach";

export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
}

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2_147_483_647;

export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): AiDeps {
  return { groqKey: cleanKey(env.GROQ_API_KEY), geminiKey: cleanKey(env.GEMINI_API_KEY), groqModel: env.GROQ_MODEL?.trim() || undefined, geminiModel: env.GEMINI_MODEL?.trim() || undefined };
}

export async function generateForUser(user: AppUser, raw: unknown, deps: AiDeps = depsFromEnv()): Promise<ServiceResult> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: 400, body: { generated: false, error: "invalid_request" } };
  const b = raw as Record<string, unknown>;
  if (!isId(b.startup_id)) return { status: 400, body: { generated: false, error: "invalid_startup_id" } };
  if (b.job_id !== undefined && b.job_id !== null && !isId(b.job_id)) return { status: 400, body: { generated: false, error: "invalid_job_id" } };
  if (typeof b.style !== "string" || !(OUTREACH_STYLES as readonly string[]).includes(b.style)) return { status: 400, body: { generated: false, error: "invalid_style" } };
  if (b.recipient_name !== undefined && typeof b.recipient_name !== "string") return { status: 400, body: { generated: false, error: "invalid_recipient" } };
  const style = b.style as OutreachStyle;

  // Not configured is a normal state, not an error: the page then offers the template instead.
  if (configuredProviders(deps).length === 0) {
    return { status: 200, body: { generated: false, code: "not_configured", message: "AI drafting isn't set up on this server (no GROQ_API_KEY or GEMINI_API_KEY). Edit the template below instead." } };
  }

  const [startup] = await loadStartups(user, { id: b.startup_id });
  if (!startup) return { status: 404, body: { generated: false, error: "startup_not_found" } };

  let job = null as (typeof startup.jobs)[number] | null;
  if (isId(b.job_id)) {
    job = startup.jobs.find((j) => j.id === b.job_id) ?? null;
    if (!job) return { status: 400, body: { generated: false, error: "job_not_at_this_startup" } }; // a jobId must belong to this startup
  } else {
    job = startup.jobs.find((j) => j.match.relevance === "strong" || j.match.relevance === "potential") ?? startup.jobs[0] ?? null;
  }

  const p = user.profile;
  const ctx: OutreachContext = {
    candidate: {
      name: p.name || "",
      skills: p.skills ?? [],
      years: p.tech_experience_years || 0,
      projects: (p.projects ?? []).slice(0, 2).map((x) => ({ name: x.name, description: x.description })),
      github: p.github_url,
      linkedin: p.linkedin_url,
      portfolio: p.portfolio_url,
    },
    startup: { name: startup.name, description: startup.description, fundingRound: startup.funding_round, fundingAmount: startup.last_funding_amount },
    job: job ? { title: job.job_title, skills: job.skills } : null,
    note: typeof b.note === "string" ? clean(b.note, 300) || null : null,
    recipientName: clean(typeof b.recipient_name === "string" ? b.recipient_name : "", 80) || null,
  };

  try {
    const out = await generateOutreach(style, ctx, deps);
    return { status: 200, body: { generated: true, subject: out.subject, body: out.body, provider: out.provider, job_id: job?.id ?? null } };
  } catch (e) {
    if (e instanceof AiError) {
      console.error(`[ai/generate-outreach] ${e.code}${e.detail ? ` (${e.detail})` : ""}`); // never the key, never the upstream body
      const status = e.code === "rate_limited" ? 429 : e.code === "timeout" ? 504 : e.code === "auth" || e.code === "model_unavailable" ? 503 : 502;
      return { status, body: { generated: false, code: e.code, message: e.message, retryable: e.retryable } };
    }
    console.error("[ai/generate-outreach] unexpected:", (e as Error).name);
    return { status: 500, body: { generated: false, code: "provider_error", message: "Something went wrong. Try again, or edit the template below.", retryable: true } };
  }
}
