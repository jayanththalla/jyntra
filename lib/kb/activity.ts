// "Summarise my applications / what have I been working on": answered from the user's OWN records (tracker, saved answer sets,
// email drafts and history, recent chats), grouped and rendered without a model. Nothing is claimed that no record shows:
// an email counts as sent only when its status is "sent" (the provider confirmed it).
import { query } from "@/lib/database";

export interface ActivityData {
  apps: { id: number; company: string; role: string | null; status: string; applied_at: string | null; updated_at: string }[];
  drafts: { id: number; kind: string; to_email: string | null; subject: string; status: string; sent_at: string | null; application_id: number | null; updated_at: string }[];
  sets: { id: number; title: string; application_id: number | null; total: number; complete: number; needs: number; updated_at: string }[];
  chats: { title: string; updated_at: string }[];
}

export const activityIntent = (q: string): boolean => {
  const t = q.toLowerCase();
  if (t.length > 220) return false;
  return /\b(summar(y|ise|ize)|recap|overview|status|history|list|show|what)\b.*\b(my )?(job )?(applications?|applied|emails?|drafts?|outreach|follow[- ]?ups?)\b|\bwhat (have|did) i (apply|applied|send|sent|draft|work)|\bwhere (did|have) i appl|\b(my|all) (job )?applications?\b|\bapplication (history|status|tracker)\b|\bwhat have i been (doing|working on)\b/.test(t);
};

export async function loadActivity(userId: number): Promise<ActivityData> {
  const [apps, drafts, sets, chats] = await Promise.all([
    query<any>(`SELECT a.id, COALESCE(s.name, a.company_name) AS company, COALESCE(j.job_title, a.role_title) AS role, a.status, a.applied_at, a.updated_at FROM applications a LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id WHERE a.user_id = $1 ORDER BY a.updated_at DESC LIMIT 100`, [userId]),
    query<any>(`SELECT id, kind, to_email, subject, status, sent_at, application_id, updated_at FROM email_drafts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`, [userId]),
    query<any>(`SELECT s.id, s.title, s.application_id, s.updated_at, count(a.id)::int AS total, (count(a.id) FILTER (WHERE a.status = 'complete'))::int AS complete, (count(a.id) FILTER (WHERE a.status = 'needs_input'))::int AS needs FROM app_answer_sets s LEFT JOIN app_answers a ON a.set_id = s.id AND a.user_id = s.user_id WHERE s.user_id = $1 GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 50`, [userId]),
    query<any>(`SELECT title, updated_at FROM kb_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 8`, [userId]),
  ]);
  const iso = (v: any) => (v ? new Date(v).toISOString() : null);
  return {
    apps: apps.map((a: any) => ({ ...a, applied_at: iso(a.applied_at), updated_at: iso(a.updated_at)! })),
    drafts: drafts.map((d: any) => ({ ...d, sent_at: iso(d.sent_at), updated_at: iso(d.updated_at)! })),
    sets: sets.map((s: any) => ({ ...s, updated_at: iso(s.updated_at)! })),
    chats: chats.map((c: any) => ({ title: c.title, updated_at: iso(c.updated_at)! })),
  };
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const DRAFT_LABEL: Record<string, string> = { draft: "Draft, not sent", sending: "Sending", sent: "Sent (provider confirmed)", failed: "Failed, not sent", unknown: "Unknown, check your mailbox" };

export function renderActivity(d: ActivityData): string | null {
  if (!d.apps.length && !d.drafts.length && !d.sets.length) return null;
  const out: string[] = [];
  const sent = d.drafts.filter((x) => x.status === "sent");
  const pending = d.drafts.filter((x) => x.status === "draft" || x.status === "failed" || x.status === "unknown");
  out.push(`From your Jyntra records: **${d.apps.length}** tracked application${d.apps.length === 1 ? "" : "s"}, **${d.sets.length}** application answer set${d.sets.length === 1 ? "" : "s"}, **${d.drafts.length}** email draft${d.drafts.length === 1 ? "" : "s"} (**${sent.length}** confirmed sent).`);
  if (d.apps.length) {
    const mails = (id: number) => d.drafts.filter((x) => x.application_id === id);
    const sets = (id: number) => d.sets.filter((x) => x.application_id === id);
    const rows = d.apps.map((a) => {
      const m = mails(a.id), st = sets(a.id);
      const email = m.length ? m.map((x) => DRAFT_LABEL[x.status] ?? x.status).filter((v, i, arr) => arr.indexOf(v) === i).join("; ") : "none";
      const ans = st.length ? st.map((x) => `${x.complete}/${x.total} answered${x.needs ? `, ${x.needs} need your input` : ""}`).join("; ") : "none";
      return `| ${cell(a.company)} | ${cell(a.role ?? "not recorded")} | ${cell(a.status)}${a.applied_at ? ` (${day(a.applied_at)})` : ""} | ${cell(email)} | ${cell(ans)} |`;
    });
    out.push(`## Applications\n\n| Company | Role | Status | Email | Answers |\n|---|---|---|---|---|\n${rows.join("\n")}`);
  }
  const unlinkedSets = d.sets.filter((x) => !x.application_id);
  if (unlinkedSets.length) out.push(`## Answer sets not linked to an application\n\n${unlinkedSets.map((x) => `- **${cell(x.title)}**: ${x.complete}/${x.total} answered${x.needs ? `, ${x.needs} need your input` : ""} (${day(x.updated_at)})`).join("\n")}`);
  const unlinkedMail = d.drafts.filter((x) => !x.application_id);
  if (unlinkedMail.length) out.push(`## Emails not linked to an application\n\n${unlinkedMail.slice(0, 30).map((x) => `- **${cell(x.subject || "(no subject)")}** to ${x.to_email ? cell(x.to_email) : "no recipient yet"}: ${DRAFT_LABEL[x.status] ?? x.status}${x.sent_at ? ` (${day(x.sent_at)})` : ""}`).join("\n")}`);
  if (d.chats.length) out.push(`## Recent Atlas chats\n\n${d.chats.slice(0, 6).map((c) => `- ${cell(c.title)} (${day(c.updated_at)})`).join("\n")}`);
  const next: string[] = [];
  if (pending.length) next.push(`${pending.length} email${pending.length > 1 ? "s are" : " is"} drafted but not confirmed sent. Review them in Email, then send.`);
  const needs = d.sets.reduce((n, s) => n + s.needs, 0);
  if (needs) next.push(`${needs} application answer${needs > 1 ? "s need" : " needs"} a fact only you can give (for example salary or notice period).`);
  const noMail = d.apps.filter((a) => !d.drafts.some((x) => x.application_id === a.id) && /saved|interested|to apply/i.test(a.status));
  if (noMail.length) next.push(`${noMail.length} saved application${noMail.length > 1 ? "s have" : " has"} no email or answers yet: ${noMail.slice(0, 4).map((a) => a.company).join(", ")}.`);
  out.push(`## Next steps\n\n${next.length ? next.map((n) => `- ${n}`).join("\n") : "- Nothing is waiting on you in these records."}`);
  out.push(`_Only what is recorded in Jyntra is shown. Applications or emails made elsewhere are not included, and an email counts as sent only when the provider confirmed it._`);
  return out.join("\n\n");
}
