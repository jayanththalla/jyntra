"use client";
// Public, read-only demo: no sign-in, no database, no network. Every company below is FICTIONAL sample data and is
// labelled as such, so a recruiter can see how Jyntra works in ten seconds without anything being presented as real.
import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Banner } from "@/components/Banner";
import { MapPinIcon, SparklesIcon, ArrowRightIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

const PROFILE = { name: "Asha (sample)", skills: ["TypeScript", "React", "Postgres", "Node.js"], years: 1 };

const STARTUPS = [
  { id: "a", name: "Lumen Ledger (sample)", what: "Invoicing and reconciliation for small shops", funding: "Seed, $2.5M, 9 days ago", city: "Hyderabad", job: "Full-stack Engineer", score: 86, why: ["Role: full-stack matches your target (+30)", "Skills: TypeScript, React, Postgres matched 3 of 4 (+36)", "Location: Hyderabad matches (+10)", "Experience: 0-2 years fits (+10)"], missing: ["Payments APIs"] },
  { id: "b", name: "Kestrel Health (sample)", what: "Appointment reminders for clinics", funding: "Pre-Series A, $4M, 3 days ago", city: "Remote (India)", job: "Backend Engineer", score: 71, why: ["Role: backend partly matches (+18)", "Skills: Node.js, Postgres matched 2 of 4 (+24)", "Location: remote in India (+10)"], missing: ["Go", "HL7/FHIR"] },
  { id: "c", name: "Orbit Docs (sample)", what: "AI search across company documents", funding: "Seed, $3M, 12 days ago", city: "Bengaluru", job: "Senior ML Engineer", score: 38, why: ["Role: senior ML is a stretch (+5)", "Skills: 1 of 6 matched (+9)", "Location: Bengaluru differs from your preference (+0)"], missing: ["PyTorch", "Vector databases", "5+ years"] },
];

const DRAFT = `Hi Priya,

Congrats on the Lumen Ledger seed round. I built a job finder (Jyntra) that refreshes data live and matches jobs to a profile, so reconciliation and messy real-world data are problems I've already worked on. I'd like to help with your full-stack role. Could I send you a short demo?

Thanks,
Asha`;

const tone = (n: number) => (n >= 65 ? "text-success" : n >= 40 ? "text-foreground" : "text-warning");

export default function DemoPage() {
  const [open, setOpen] = useState<string | null>("a");
  const [draft, setDraft] = useState(false);
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Badge variant="secondary">Sample demo · fictional data, not a live deployment</Badge>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">See how Jyntra works</h1>
        <p className="text-sm text-muted-foreground">A read-only walkthrough for <b>{PROFILE.name}</b>, skills {PROFILE.skills.join(", ")}. Nothing here is saved.</p>
      </header>
      <Banner tone="info">All companies, funding rounds and people on this page are fictional examples. This page is a static walkthrough with no database and no network calls; nothing on it was fetched from a real source. The real app reads funding news, the YC directory, company job boards and public startup directories, and shows the source and last-check time on each item.</Banner>

      <section aria-labelledby="d1" className="space-y-3">
        <h2 id="d1" className="text-lg font-semibold">1. Recently funded startups, scored against your profile</h2>
        {STARTUPS.map((s) => (
          <Card key={s.id}>
            <CardContent className="space-y-2">
              <button className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span>
                  <span className="block font-semibold">{s.name}</span>
                  <span className="block text-sm text-muted-foreground">{s.what}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"><span>{s.funding}</span><span className="inline-flex items-center gap-1"><MapPinIcon className="size-3.5" />{s.city}</span></span>
                </span>
                <span className="shrink-0 text-right"><span className={cn("text-2xl font-semibold tabular-nums", tone(s.score))}>{s.score}</span><span className="block text-xs text-muted-foreground">{s.job}</span></span>
              </button>
              {open === s.id && (
                <div className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
                  <div><p className="font-medium">Why this score</p><ul className="list-disc pl-5 text-muted-foreground">{s.why.map((w) => <li key={w}>{w}</li>)}</ul></div>
                  <div><p className="font-medium">Missing skills</p><p className="text-muted-foreground">{s.missing.join(", ")}</p></div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-labelledby="d2" className="space-y-3">
        <h2 id="d2" className="text-lg font-semibold">2. A founder message built from real facts</h2>
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">You add one sentence on why this startup; the AI uses only your profile and that note, never invented achievements.</p>
            <button onClick={() => setDraft((d) => !d)} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}><SparklesIcon /> {draft ? "Hide sample draft" : "Show sample draft"}</button>
            {draft && <pre className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-sans text-sm" role="status">{DRAFT}</pre>}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="d3" className="space-y-1">
        <h2 id="d3" className="text-lg font-semibold">3. Honest about dates and evidence</h2>
        <p className="text-sm text-muted-foreground">In the real app, jobs posted in the last 7 days are shown first, older roles that are still listed are one filter away, and a listing with no posting date is labelled as such instead of being called new. A funding round is shown as a funding signal, separate from a verified opening.</p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href="/onboarding" className={cn(buttonVariants())}>Try it with your own profile <ArrowRightIcon /></Link>
        <Link href="/" className={cn(buttonVariants({ variant: "ghost" }))}>Back to home</Link>
      </div>
    </div>
  );
}
