"use client";
// Interview history: the signed-in user's own sessions, and the stored report of one session. Data comes from /api/interview/sessions,
// which scopes every query to the authenticated user.
import { Skeleton } from "@/components/Skeleton";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, jsonBody } from "@/components/api";
import { cn } from "@/lib/utils";

const tone = (n: number) => (n >= 75 ? "text-success" : n >= 50 ? "text-foreground" : "text-warning");
const when = (s: string) => new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function History() {
  const id = useSearchParams().get("id");
  const [list, setList] = useState<any[] | null>(null);
  const [one, setOne] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    const r = await api<any>(id ? `/api/interview/sessions?id=${encodeURIComponent(id)}` : "/api/interview/sessions");
    if (!r.ok) return setErr(r.status === 404 ? "That session was not found." : r.error);
    if (id) setOne(r.data.session); else setList(r.data.sessions);
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function remove(n: number) { if (confirm("Delete this session and its transcripts?")) { await api(`/api/interview/sessions?id=${n}`, { method: "DELETE" }); void load(); } }

  if (err) return <p className="text-sm text-warning" role="alert">{err}</p>;
  if (id) {
    if (!one) return <Skeleton variant="list" count={4} />;
    const r = one.report;
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild><Link href="/mock-interview/history">← All sessions</Link></Button>
        <Card><CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3"><span className={cn("text-4xl font-semibold tabular-nums", r?.overall != null && tone(r.overall))}>{r?.overall ?? "–"}<span className="text-base text-muted-foreground">/100</span></span><p className="text-sm text-muted-foreground">{one.role ?? one.type} · {one.level} · {one.mode === "timed" ? "Timed" : "Practice"} · {when(one.started_at)}{one.status !== "completed" && " · not completed"}</p></div>
          {!r && <p className="text-sm text-muted-foreground">This session was not finished, so there is no report yet.</p>}
          {r && <>
            <p className="text-sm text-muted-foreground">{r.answered} of {r.planned} questions answered{r.written.score != null && ` · written exercise ${r.written.score}/100`}</p>
            {r.dimensions.length > 0 && <ul className="grid gap-2 sm:grid-cols-3">{r.dimensions.map((d: any) => <li key={d.name} className="rounded-lg border p-2 text-xs"><span className="flex justify-between"><span className="font-medium">{d.name}</span><span className={cn("tabular-nums font-semibold", tone(d.average))}>{d.average}</span></span></li>)}</ul>}
            {r.reviseTopics.length > 0 && <p className="text-sm"><span className="font-medium">Revise:</span> {r.reviseTopics.join(", ")}</p>}
            {r.recurringWeaknesses.length > 0 && <p className="text-sm"><span className="font-medium">Recurring weaknesses:</span> {r.recurringWeaknesses.join("; ")}</p>}
            {r.nextPractice.length > 0 && <div className="text-sm"><p className="font-medium">Next practice plan</p><ul className="list-disc pl-5 text-muted-foreground">{r.nextPractice.map((x: string) => <li key={x}>{x}</li>)}</ul></div>}
          </>}
        </CardContent></Card>
        <ul className="space-y-3">{(r?.perQuestion ?? []).map((q: any) => {
          const a = [...one.answers].filter((x: any) => x.question_id === q.id).sort((x: any, y: any) => y.score - x.score)[0];
          return <li key={q.id}><Card><CardContent className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-3"><p className="font-medium">{q.question}</p><span className={cn("text-lg font-semibold tabular-nums", tone(q.score))}>{q.score}</span></div>
            <div className="flex flex-wrap gap-2">{q.written && <Badge variant="secondary">Written</Badge>}<Badge variant="outline">{q.attempts} attempt{q.attempts === 1 ? "" : "s"}</Badge>{q.passed && <Badge>Passed</Badge>}</div>
            {a && <p className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs">{a.answer}</p>}
            {a?.feedback?.dimensions?.length > 0 && <ul className="grid gap-1 text-xs sm:grid-cols-2">{a.feedback.dimensions.map((d: any) => <li key={d.name}><span className="font-medium">{d.name} {d.score}</span>{d.evidence && <span className="text-muted-foreground"> — {d.evidence}</span>}</li>)}</ul>}
            {q.improvedStructure && <p className="text-xs text-muted-foreground">Better structure: {q.improvedStructure}</p>}
          </CardContent></Card></li>;
        })}</ul>
      </div>
    );
  }
  if (!list) return <Skeleton variant="list" count={5} />;
  if (!list.length) return <p className="text-sm text-muted-foreground">No interviews yet. <Link className="text-primary underline" href="/mock-interview">Start one</Link>; finished sessions appear here with their report.</p>;
  return (
    <ul className="divide-y rounded-lg border">{list.map((s) => (
      <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
        <span className={cn("w-10 text-lg font-semibold tabular-nums", s.overall != null && tone(s.overall))}>{s.overall ?? "–"}</span>
        <Link className="min-w-0 flex-1 hover:underline" href={`/mock-interview/history?id=${s.id}`}><span className="block truncate font-medium">{s.role ?? s.type} · {s.level}</span><span className="text-xs text-muted-foreground">{when(s.started_at)} · {s.mode === "timed" ? "Timed" : "Practice"} · {s.answered} answered{s.status !== "completed" && " · unfinished"}</span></Link>
        <Button variant="ghost" size="sm" onClick={() => remove(s.id)}>Delete</Button>
      </li>))}</ul>
  );
}

export default function Page() {
  return (<div className="space-y-4"><PageHeader title="Interview history" subtitle="Your past sessions, scores and reports. Only transcripts and scores are stored; audio never is." /><Suspense fallback={null}><History /></Suspense></div>);
}
