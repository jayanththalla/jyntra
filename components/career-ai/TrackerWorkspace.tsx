"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Tracker {
  pipeline: Record<string, number>;
  emails: Record<string, number>;
  recent_emails: { id: number; subject: string; to_email: string | null; status: string; sent_at: string | null; updated_at: string; company: string | null }[];
  answers: { sets: number; total: number; complete: number; needs_input: number };
  reminders: { overdue: number; today: number; upcoming: number; done: number };
  needs_follow_up: { id: number; company: string | null; role: string | null; applied_at: string }[];
  saved_notes: number;
}
const STAGES = ["Saved", "Applied", "Interview", "Offer", "Rejected", "To Verify"] as const;
const EMAIL_LABEL: Record<string, string> = { draft: "Draft", sending: "Sending", sent: "Sent", failed: "Failed", unknown: "Delivery unknown" };

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-3">
      <p className={tone === "bad" && value > 0 ? "text-2xl font-semibold text-destructive" : tone === "warn" && value > 0 ? "text-2xl font-semibold text-warning" : "text-2xl font-semibold"}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Read-only roll-up. Every number is a count of the signed-in user's own rows. */
export function TrackerWorkspace() {
  const [d, setD] = useState<Tracker | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function load() {
    const r = await api<Tracker>("/api/career/tracker");
    if (r.ok) { setD(r.data); setErr(null); } else setErr(r.error ?? "Could not load the tracker.");
  }
  useEffect(() => { void load(); }, []);

  if (err) return <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}>{err}</Banner>;
  if (!d) return <div className="grid gap-3 sm:grid-cols-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>;
  const total = Object.values(d.pipeline).reduce((a, b) => a + b, 0);
  const emailTotal = Object.values(d.emails).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Application pipeline</CardTitle></CardHeader>
        <CardContent>
          {total === 0 ? <p className="text-sm text-muted-foreground">No applications tracked yet. Save a role from Startups or Jobs and it appears here.</p> : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{STAGES.map((s) => <Stat key={s} label={s === "To Verify" ? "To verify" : s} value={d.pipeline[s] ?? 0} />)}</div>
          )}
          <Button variant="ghost" size="sm" className="mt-3 h-9" asChild><Link href="/applications">Open full application tracker</Link></Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Follow-ups</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3"><Stat label="Overdue" value={d.reminders.overdue} tone="bad" /><Stat label="Next 24 hours" value={d.reminders.today} tone="warn" /><Stat label="Later" value={d.reminders.upcoming} /></div>
            {d.needs_follow_up.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">Applied 7+ days ago with no reminder</p>
                <ul className="space-y-1 text-sm">
                  {d.needs_follow_up.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
                      <span className="min-w-0 truncate">{a.company ?? "Unknown company"}{a.role ? ` · ${a.role}` : ""} <span className="text-muted-foreground">({a.applied_at})</span></span>
                      <Button size="sm" variant="outline" className="h-8 shrink-0" asChild><Link href={`/career-ai/reminders?application=${a.id}`}>Remind me</Link></Button>
                      {a.role && <Button size="sm" variant="ghost" className="h-8 shrink-0" asChild><Link href={`/mock-interview?role=${encodeURIComponent(a.role.slice(0, 120))}`}>Practise interview</Link></Button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="ghost" size="sm" className="h-9" asChild><Link href="/career-ai/reminders">Manage reminders</Link></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Emails</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {emailTotal === 0 ? <p className="text-sm text-muted-foreground">No email drafts yet. Ask Atlas in Chat to draft one.</p> : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">{Object.entries(d.emails).map(([k, v]) => <span key={k} className="rounded-full bg-muted px-2.5 py-1">{EMAIL_LABEL[k] ?? k}: {v}</span>)}</div>
                <ul className="space-y-1 text-sm">
                  {d.recent_emails.map((e) => (
                    <li key={e.id} className="rounded-lg bg-muted/50 px-3 py-2">
                      <Link href={`/career-ai/email?draft=${e.id}`} className="block min-w-0 truncate font-medium hover:underline">{e.subject || "(no subject)"}</Link>
                      <span className="text-xs text-muted-foreground">{EMAIL_LABEL[e.status] ?? e.status}{e.to_email ? ` · ${e.to_email}` : ""}{e.company ? ` · ${e.company}` : ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">&ldquo;Sent&rdquo; means the provider accepted it. It does not guarantee inbox delivery.</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Application answers and notes</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Question sets" value={d.answers.sets} /><Stat label="Answers complete" value={d.answers.complete} /><Stat label="Need your input" value={d.answers.needs_input} tone="warn" /><Stat label="Total answers" value={d.answers.total} /><Stat label="Saved notes" value={d.saved_notes} />
        </CardContent>
      </Card>
    </div>
  );
}
