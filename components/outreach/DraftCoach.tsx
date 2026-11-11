"use client";
import { CheckIcon, MinusSignIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface CoachChecks { words: number; context: boolean; relevance: boolean; proof: boolean; ask: boolean }

/** Pure checks, easy to test. Heuristics only: they look for signals in the text, they do not judge quality. */
export function coachDraft(body: string, company: string, skills: string[]): CoachChecks {
  const text = body.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const words = text ? text.split(" ").length : 0;
  const tail = text.split(/(?<=[.!?])\s+/).slice(-2).join(" ");
  const has = (needle: string) => needle.length > 1 && lower.includes(needle.toLowerCase());
  return {
    words,
    context: !!company.trim() && has(company.trim()),
    relevance: skills.some((s) => s.trim().length > 1 && new RegExp(`(^|[^a-z0-9])${s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text)),
    proof: /https?:\/\/|github\.com|linkedin\.com|www\./i.test(text),
    ask: /\?/.test(tail),
  };
}

const TARGET: [number, number] = [80, 150];

/** Live checklist under the draft: the context + relevance + proof + small-ask structure, and a length guide of about 80-150 words. */
export function DraftCoach({ body, company, skills, short = false }: { body: string; company: string; skills: string[]; short?: boolean }) {
  const c = coachDraft(body, company, skills);
  const [lo, hi] = short ? [20, 70] : TARGET;
  const lenOk = c.words >= lo && c.words <= hi;
  const lenNote = c.words === 0 ? "Start writing" : c.words < lo ? `${lo - c.words} more words would help` : c.words > hi ? `${c.words - hi} words over, consider trimming` : "Good length";
  const rows: [boolean, string, string][] = [
    [c.context, "Context", `Mentions ${company || "the company"} by name`],
    [c.relevance, "Relevance", "Names a skill from your profile"],
    [c.proof, "Proof", "Includes a link to your work"],
    [c.ask, "Small ask", "Ends with one clear question"],
  ];
  return (
    <div className="rounded-2xl border border-border bg-secondary/40 p-3 text-xs" aria-label="Draft checklist">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">Draft check</p>
        <p className={cn("tabular-nums", lenOk ? "text-success" : "text-muted-foreground")} aria-live="polite">{c.words} words · {lenNote} <span className="text-muted-foreground/80">(aim for {lo}-{hi})</span></p>
      </div>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {rows.map(([ok, t, d]) => (
          <li key={t} className="flex items-center gap-2">
            <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-300", ok ? "bg-success text-white" : "bg-border text-muted-foreground")}>{ok ? <CheckIcon className="size-3" /> : <MinusSignIcon className="size-3" />}</span>
            <span><span className="font-medium">{t}</span> <span className="text-muted-foreground">· {d}</span><span className="sr-only">{ok ? " (done)" : " (missing)"}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground">These are signals, not a score. Your own words and a real reason for writing matter most.</p>
    </div>
  );
}
