// Per-user contribution records. Every statement filters on user_id.
import { query } from "@/lib/database";
import { STEP_IDS, type Guide } from "./guide";

export interface Contribution { repo: string; issue_number: number; issue_title: string; issue_url: string; saved: boolean; done_steps: string[]; guide: Guide | null; guide_at: string | null }
const COLS = "repo, issue_number, issue_title, issue_url, saved, done_steps, guide, guide_at";

export async function getContribution(userId: number, repo: string, n: number): Promise<Contribution | null> {
  return (await query<Contribution>(`SELECT ${COLS} FROM oss_contributions WHERE user_id=$1 AND repo=$2 AND issue_number=$3`, [userId, repo, n]))[0] ?? null;
}

export async function storeGuide(userId: number, i: { repo: string; number: number; title: string; url: string }, guide: Guide): Promise<void> {
  await query(
    `INSERT INTO oss_contributions (user_id, repo, issue_number, issue_title, issue_url, guide, guide_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb, now())
     ON CONFLICT (user_id, repo, issue_number) DO UPDATE SET guide=EXCLUDED.guide, guide_at=now(), issue_title=EXCLUDED.issue_title, issue_url=EXCLUDED.issue_url, updated_at=now()`,
    [userId, i.repo, i.number, i.title.slice(0, 300), i.url, JSON.stringify(guide)]);
}

/** Idempotent: ticking a step twice leaves it ticked once. Unknown step ids are rejected. */
export async function setStep(userId: number, i: { repo: string; number: number; title: string; url: string }, step: string, done: boolean): Promise<string[] | null> {
  if (!STEP_IDS.includes(step)) return null;
  const r = await query<{ done_steps: string[] }>(
    `INSERT INTO oss_contributions (user_id, repo, issue_number, issue_title, issue_url, done_steps) VALUES ($1,$2,$3,$4,$5, CASE WHEN $7 THEN ARRAY[$6]::text[] ELSE '{}'::text[] END)
     ON CONFLICT (user_id, repo, issue_number) DO UPDATE SET done_steps = CASE WHEN $7 THEN (SELECT array_agg(DISTINCT s) FROM unnest(oss_contributions.done_steps || ARRAY[$6]::text[]) s) ELSE array_remove(oss_contributions.done_steps, $6) END, updated_at=now()
     RETURNING done_steps`, [userId, i.repo, i.number, i.title.slice(0, 300), i.url, step, done]);
  return r[0]!.done_steps;
}

export async function setSaved(userId: number, i: { repo: string; number: number; title: string; url: string }, saved: boolean): Promise<void> {
  await query(
    `INSERT INTO oss_contributions (user_id, repo, issue_number, issue_title, issue_url, saved) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, repo, issue_number) DO UPDATE SET saved=$6, updated_at=now()`, [userId, i.repo, i.number, i.title.slice(0, 300), i.url, saved]);
}

export async function listContributions(userId: number): Promise<Omit<Contribution, "guide">[]> {
  return query(`SELECT repo, issue_number, issue_title, issue_url, saved, done_steps, guide_at FROM oss_contributions WHERE user_id=$1 AND (saved OR cardinality(done_steps) > 0) ORDER BY updated_at DESC LIMIT 100`, [userId]);
}
