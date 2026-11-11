"use client";
// First-contribution workspace: AI guide (grounded in the repository's own README/CONTRIBUTING/file list), a 9-step progress
// checklist saved to the user's account, and a Q&A box. Nothing here posts to GitHub; the user does that themselves.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, jsonBody } from "@/components/api";
import { cn } from "@/lib/utils";

const STEPS: [string, string][] = [["explored", "Repository explored"], ["understood", "Issue understood"], ["installed", "Environment installed"], ["reproduced", "Issue reproduced"], ["planned", "Solution planned"], ["implemented", "Code implemented"], ["tested", "Tests passed"], ["pr_prepared", "Pull request prepared"], ["pr_submitted", "Pull request submitted"]];
const List = ({ title, items }: { title: string; items: string[] }) => items.length ? <div><p className="text-sm font-medium">{title}</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{items.map((x) => <li key={x}>{x}</li>)}</ul></div> : null;

function Workspace() {
  const sp = useSearchParams();
  const repo = sp.get("repo") ?? "", number = Number(sp.get("issue"));
  const [g, setG] = useState<any>(null);
  const [err, setErr] = useState<{ message: string; retry?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [q, setQ] = useState("");
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repo) && Number.isInteger(number) && number > 0;

  const load = useCallback(async (refresh = false) => {
    setBusy(true); setErr(null);
    const r = await api("/api/open-source/contribute", { method: "POST", timeoutMs: 90_000, ...jsonBody({ action: "guide", repo, number, refresh }) });
    setBusy(false);
    if (r.status === 401) { window.location.href = "/onboarding"; return; }
    if (!r.ok || !r.data?.ok) return setErr({ message: r.data?.message ?? r.error ?? "Something went wrong.", retry: r.data?.retryable !== false });
    setG(r.data); setSteps(r.data.done_steps ?? []); setSaved(!!r.data.saved);
  }, [repo, number]);
  useEffect(() => { if (valid) void load(); }, [valid, load]);

  const title = g?.issue?.title ?? "Issue";
  async function toggle(step: string) {
    const done = !steps.includes(step);
    setSteps((s) => (done ? [...s, step] : s.filter((x) => x !== step))); // optimistic; the server's list replaces it
    const r = await api("/api/open-source/contribute", { method: "POST", ...jsonBody({ action: "progress", repo, number, title, step, done }) });
    if (r.ok && r.data?.done_steps) setSteps(r.data.done_steps); else setSteps((s) => (done ? s.filter((x) => x !== step) : [...s, step]));
  }
  async function save() { const next = !saved; setSaved(next); const r = await api("/api/open-source/contribute", { method: "POST", ...jsonBody({ action: "save", repo, number, title, saved: next }) }); if (!r.ok) setSaved(!next); }
  async function ask() {
    const question = q.trim(); if (question.length < 3) return;
    setAsking(true);
    const r = await api("/api/open-source/contribute", { method: "POST", timeoutMs: 60_000, ...jsonBody({ action: "ask", repo, number, question }) });
    setAsking(false);
    setAnswers((a) => [{ q: question, a: r.ok && r.data?.ok ? r.data.answer : r.data?.message ?? "Could not answer that right now." }, ...a]); setQ("");
  }

  if (!valid) return <p className="text-sm text-muted-foreground">Open an issue from the <Link className="text-primary underline" href="/open-source">Open source</Link> page and choose “Start contribution”.</p>;
  const guide = g?.guide;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        <Card><CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">{repo} · issue #{number}</p>
          <h2 className="text-lg font-semibold leading-snug">{g?.issue?.title ?? "Loading the issue and repository…"}</h2>
          {g?.issue && <div className="flex flex-wrap gap-2">
            {guide && <Badge>{guide.difficulty.label}</Badge>}
            {g.repository?.language && <Badge variant="secondary">{g.repository.language}</Badge>}
            {g.repository?.stars != null && <Badge variant="outline">{g.repository.stars.toLocaleString("en-IN")} stars</Badge>}
            {g.issue.assigned && <Badge variant="outline" className="text-warning">Already assigned</Badge>}
          </div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" asChild><a href={`https://github.com/${repo}/issues/${number}`} target="_blank" rel="noopener noreferrer">Open on GitHub</a></Button>
            <Button size="sm" variant={saved ? "default" : "outline"} onClick={save} aria-pressed={saved}>{saved ? "Saved" : "Save issue"}</Button>
            {g && <Button size="sm" variant="ghost" onClick={() => load(true)} disabled={busy}>Regenerate guide</Button>}
          </div>
        </CardContent></Card>
        {busy && !guide && <p className="text-sm text-muted-foreground" role="status">Reading the README, contributing guide and issue, then writing your guide…</p>}
        {err && <Card><CardContent className="space-y-2"><p className="text-sm text-warning" role="alert">{err.message}</p>{err.retry && <Button size="sm" onClick={() => load()}>Try again</Button>}</CardContent></Card>}
        {guide && <Card><CardContent className="space-y-4">
          <div><p className="text-sm font-medium">What this project does</p><p className="text-sm text-muted-foreground">{guide.repoSummary}</p></div>
          <div><p className="text-sm font-medium">What the issue asks</p><p className="text-sm text-muted-foreground">{guide.issueSummary} {guide.whyItMatters}</p></div>
          <List title={`Why this is ${guide.difficulty.label.toLowerCase()}`} items={guide.difficulty.reasons} />
          <List title="Before you start" items={guide.prerequisites} />
          <div><p className="text-sm font-medium">Set it up</p><dl className="mt-1 space-y-1 text-sm">{(["clone", "install", "run"] as const).map((k) => <div key={k} className="flex gap-2"><dt className="w-14 shrink-0 text-muted-foreground capitalize">{k}</dt><dd><code className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{guide.setup[k]}</code></dd></div>)}</dl></div>
          {guide.filesToInspect.length > 0 && <div><p className="text-sm font-medium">Where to look <span className="font-normal text-muted-foreground">(from the repository's top-level files)</span></p><ul className="mt-1 space-y-0.5 text-sm">{guide.filesToInspect.map((f: any) => <li key={f.path}><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{f.path}</code> <span className="text-muted-foreground">{f.why}</span></li>)}</ul></div>}
          <List title="Suggested steps" items={guide.steps} />
          <List title="How to test your change" items={guide.testing} />
          <List title="Pull-request checklist" items={guide.prChecklist} />
          {guide.notFound.length > 0 && <div className="rounded-lg border border-dashed p-3"><List title="Not found in the project's own docs" items={guide.notFound} /></div>}
          <p className="text-xs text-muted-foreground">This guide is AI-generated from the issue, README, CONTRIBUTING.md and file list retrieved from GitHub. Verify it against the project's docs, and never assume maintainers will accept a change. Jyntra never comments on or submits anything for you.</p>
        </CardContent></Card>}
      </div>
      <aside className="space-y-4">
        <Card><CardContent className="space-y-2">
          <p className="text-sm font-medium">Your progress <span className="text-muted-foreground">({steps.length}/{STEPS.length})</span></p>
          <div className="h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary transition-all" style={{ width: `${(steps.length / STEPS.length) * 100}%` }} /></div>
          <ul className="space-y-1">{STEPS.map(([id, label]) => <li key={id}><label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={steps.includes(id)} onChange={() => toggle(id)} className="size-4 accent-[var(--primary)]" />{label}</label></li>)}</ul>
        </CardContent></Card>
        <Card><CardContent className="space-y-2">
          <p className="text-sm font-medium">Ask about this issue</p>
          <div className="flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Which files should I inspect?" maxLength={400} aria-label="Question" /><Button size="sm" onClick={ask} disabled={asking || q.trim().length < 3}>Ask</Button></div>
          <div className="flex flex-wrap gap-1.5">{["How do I start?", "What should I learn first?", "How should I test my change?"].map((s) => <button key={s} type="button" className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => setQ(s)}>{s}</button>)}</div>
          <ul className="space-y-2">{answers.map((a) => <li key={a.q + a.a.length} className="rounded-lg bg-muted/40 p-2 text-sm"><p className="text-xs font-medium">{a.q}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{a.a}</p></li>)}</ul>
        </CardContent></Card>
      </aside>
    </div>
  );
}

export default function Page() {
  return (<div className="space-y-4"><PageHeader title="First contribution" subtitle="An AI guide grounded in the project's own docs, with a checklist that saves your progress." actions={<Button variant="outline" asChild><Link href="/open-source">All issues</Link></Button>} /><Suspense fallback={null}><Workspace /></Suspense></div>);
}
