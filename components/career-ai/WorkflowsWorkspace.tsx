"use client";
// Atlas workflows: resume vs job description, learning roadmap, resume bullets.
// The first two are rule-based (no AI). Bullets may use AI and say so. Nothing here invents a skill, number or result.
import { useEffect, useState } from "react";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { SelectField } from "@/components/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckIcon, CircleAlertIcon, CopyIcon, Loader2Icon, SparklesIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { JdComparison, Roadmap } from "@/lib/kb/workflows";

type Tab = "resume_vs_jd" | "roadmap" | "bullets";
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "resume_vs_jd", label: "Resume vs job", hint: "See which skills a job asks for that you can show, and which you can't yet." },
  { id: "roadmap", label: "Learning roadmap", hint: "Turn the gaps in a job description into build tasks, most-asked first." },
  { id: "bullets", label: "Resume bullets", hint: "Rephrase one of your projects as resume bullets, using only facts you already have." },
];
const EVIDENCE: Record<string, string> = { demonstrated: "Shown in your work", project: "Used in a project", self_reported: "Only on your list" };

function Chips({ items, tone }: { items: { label: string; title?: string }[]; tone: "ok" | "weak" | "gap" }) {
  const style = { ok: "bg-success/10 text-success", weak: "bg-warning/10 text-warning", gap: "bg-muted text-foreground/80 ring-1 ring-border" }[tone];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((i) => <li key={i.label} title={i.title} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", style)}>{i.label}</li>)}
    </ul>
  );
}

function Comparison({ c }: { c: JdComparison }) {
  return (
    <div className="space-y-4">
      {c.match_pct != null && (
        <div>
          <div className="flex items-baseline justify-between"><span className="text-sm font-medium">Skills you can show for this job</span><span className="text-2xl font-semibold tabular-nums">{c.match_pct}%</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${c.match_pct} percent of the skills named in the job description are on your profile`}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${c.match_pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{c.matched.length} of {c.required.length} skills named in the job description. A count of keywords, not a hiring prediction.</p>
        </div>
      )}
      {c.matched.length > 0 && (
        <section><h3 className="mb-1.5 text-sm font-semibold">You have</h3><Chips tone="ok" items={c.matched.map((m) => ({ label: m.skill, title: `${EVIDENCE[m.evidence]}${m.where ? `: ${m.where}` : ""}` }))} /></section>
      )}
      {c.unproven.length > 0 && (
        <section><h3 className="mb-1.5 text-sm font-semibold">Listed, but not backed by a project</h3><Chips tone="weak" items={c.unproven.map((s) => ({ label: s }))} /></section>
      )}
      {c.missing.length > 0 && (
        <section><h3 className="mb-1.5 text-sm font-semibold">Not on your profile</h3><Chips tone="gap" items={c.missing.map((s) => ({ label: s }))} /></section>
      )}
      <ul className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
        {c.advice.map((a) => <li key={a} className="flex gap-2"><CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{a}</li>)}
      </ul>
    </div>
  );
}

function RoadmapView({ r }: { r: Roadmap }) {
  if (!r.phases.length) return <p className="text-sm text-muted-foreground">Nothing to plan: every skill in this job description is already on your profile.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm"><span className="text-2xl font-semibold tabular-nums">{r.total_weeks}</span> weeks, roughly, at a steady part-time pace.</p>
      <ol className="space-y-4">
        {r.phases.map((p) => (
          <li key={p.title} className="relative border-l-2 border-primary/40 pl-4">
            <h3 className="text-sm font-semibold">{p.title}</h3>
            <ul className="mt-2 space-y-2.5">
              {p.steps.map((s) => (
                <li key={s.skill} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{s.skill}</span><Badge variant="secondary">~{s.weeks} weeks</Badge></div>
                  <p className="mt-1 text-sm text-muted-foreground">{s.practice}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{r.note}</p>
    </div>
  );
}

export function WorkflowsWorkspace() {
  const [tab, setTab] = useState<Tab>("resume_vs_jd");
  const [jd, setJd] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    api<{ projects: string[] }>("/api/kb/workflows").then((r) => { if (r.ok) { setProjects(r.data.projects); setProject((p) => p || r.data.projects[0] || ""); } });
  }, []);
  useEffect(() => { setRes(null); setError(null); }, [tab]);

  const run = async () => {
    setBusy(true); setError(null); setRes(null);
    const r = await api<any>("/api/kb/workflows", { method: "POST", timeoutMs: 60_000, ...jsonBody({ workflow: tab, jd, project, target_role: role }) });
    setBusy(false);
    if (!r.ok) return setError(r.data?.message ?? r.error);
    setRes(r.data);
  };
  const copy = async (text: string, i: number) => {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked: the text is selectable */ }
  };
  const needsJd = tab !== "bullets";
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card className="h-fit gap-4 p-4 sm:p-5">
        <div role="tablist" aria-label="Workflow" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cn("min-h-9 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:text-sm", tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{active.hint}</p>

        {needsJd ? (
          <label className="block space-y-1.5 text-sm font-medium">
            Job description
            <Textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={12} maxLength={12000} placeholder="Paste the full posting, including the requirements section." className="font-normal" />
            <span className="block text-xs font-normal text-muted-foreground">Pasted text is treated as data only, and is not saved.</span>
          </label>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1.5 text-sm font-medium">
              Project
              {projects.length ? <SelectField aria-label="Project" value={project} onValueChange={setProject} options={projects.map((p) => ({ value: p, label: p }))} className="w-full" /> : <Input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project name" />}
              {!projects.length && <span className="block text-xs font-normal text-muted-foreground">No projects found yet. Add some to your profile or sync GitHub in Atlas.</span>}
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Role you are applying for <span className="font-normal text-muted-foreground">(optional)</span>
              <Input value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder="Backend engineer" />
            </label>
          </div>
        )}
        <Button onClick={run} disabled={busy || (needsJd ? jd.trim().length < 40 : !project.trim())} className="h-10">
          {busy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
          {tab === "resume_vs_jd" ? "Compare with my profile" : tab === "roadmap" ? "Build my roadmap" : "Write bullets"}
        </Button>
      </Card>

      <Card className="min-h-64 gap-4 p-4 sm:p-5" aria-live="polite" aria-busy={busy}>
        {error && <Banner tone="error">{error}</Banner>}
        {!res && !error && !busy && <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">Results appear here. Every skill, project and number comes from your profile and documents or from the text you paste.</p>}
        {busy && <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Working…</p>}
        {res?.workflow === "resume_vs_jd" && <><Comparison c={res.comparison} /><p className="text-xs text-muted-foreground">{res.basis}</p></>}
        {res?.workflow === "roadmap" && <RoadmapView r={res.roadmap} />}
        {res?.workflow === "bullets" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{res.project}</h3>
            <ul className="space-y-2">
              {res.bullets.map((b: string, i: number) => (
                <li key={b} className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm">
                  <span className="min-w-0 flex-1">{b}</span>
                  <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => copy(b, i)} aria-label="Copy bullet">{copied === i ? <CheckIcon /> : <CopyIcon />}</Button>
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              {res.method === "ai" && <Badge variant="secondary" className="shrink-0 text-accent-brand-foreground">AI-written</Badge>}
              {res.note}
            </p>
            {res.grounded_in?.length > 0 && <p className="text-xs text-muted-foreground">Based on: {res.grounded_in.map((g: { title: string }) => g.title).join(", ")}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
