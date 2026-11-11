"use client";
// Formal mock interview: resume review -> timed spoken/typed questions with weighted 0-100 scoring -> written + SQL stage -> saved report (PDF).
// Everything is server-backed and survives a refresh. Scores are practice estimates; the UI says so.
import { Skeleton } from "@/components/Skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { PageHeader } from "@/components/PageHeader";
import { SelectField } from "@/components/SelectField";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2Icon, RotateCcwIcon } from "@/components/icons";
import { INTERVIEW_LEVELS, TYPE_LABEL, type InterviewLevel, type InterviewType, type Question } from "@/lib/interview";
import type { ResumeProfile, RoleRecommendation } from "@/lib/resume/profile";
import type { ReportV2 } from "@/lib/interview/report-v2";
import { cn } from "@/lib/utils";

type Step = "loading" | "resume" | "setup" | "run" | "paused" | "written" | "finishing" | "report";
interface Sess { id: number; status: string; type: string; level: string; role: string | null; target_minutes: number | null; elapsed_seconds: number; questions: Question[]; stage: string }
interface Comp { label: string; weight: number; score: number; evidence: string }
interface Result { feedback: { score: number; verdict: string; strengths: string[]; improvements: string[]; structure: string; followUp: string }; rubric: { components: Comp[]; communication: { overall: number } | null } }
const tone = (n: number) => (n >= 75 ? "text-success" : n >= 50 ? "text-foreground" : "text-warning");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;
const err = (r: { data: unknown; error: string | null }) => ((r.data ?? {}) as { message?: string }).message ?? r.error ?? "Something went wrong.";

function Bar({ label, value, note }: { label: string; value: number; note?: string }) {
  return (<div className="space-y-0.5"><div className="flex justify-between text-xs"><span>{label}</span><span className={cn("font-medium", tone(value))}>{value}/100</span></div><div className="h-1.5 rounded bg-muted" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}><div className="h-1.5 rounded bg-primary" style={{ width: `${value}%` }} />{null}</div>{note && <p className="text-xs text-muted-foreground">{note}</p>}</div>);
}

export function FormalInterview() {
  const [step, setStep] = useState<Step>("loading");
  const [notice, setNotice] = useState<{ tone: "error" | "warn" | "info"; text: string } | null>(null);
  const [sess, setSess] = useState<Sess | null>(null);
  const [profile, setProfile] = useState<ResumeProfile | null>(null);
  const [roles, setRoles] = useState<RoleRecommendation[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [role, setRole] = useState(""); const [type, setType] = useState<InterviewType>("technical"); const [level, setLevel] = useState<InterviewLevel>("junior"); const [minutes, setMinutes] = useState<10 | 20 | 30>(10);
  const [report, setReport] = useState<ReportV2 | null>(null); const [reportId, setReportId] = useState<number | null>(null);
  const loadedAt = useRef(Date.now()); const [, tick] = useState(0);

  const loadOpen = useCallback(async () => {
    const r = await api<{ session: Sess | null }>("/api/interview/sessions/v2");
    if (r.ok && r.data.session) { setSess(r.data.session); loadedAt.current = Date.now(); setStep(r.data.session.status === "paused" ? "paused" : r.data.session.stage === "written" ? "written" : "run"); return true; }
    return false;
  }, []);
  useEffect(() => { (async () => {
    if (await loadOpen()) return;
    const r = await api<{ profile: ResumeProfile | null; roles: RoleRecommendation[]; id: number | null }>("/api/interview/resume");
    if (r.ok && r.data.profile) { setProfile(r.data.profile); setRoles(r.data.roles); setProfileId(r.data.id); }
    setStep("resume");
  })(); }, [loadOpen]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const elapsed = sess ? sess.elapsed_seconds + (sess.status === "active" ? (Date.now() - loadedAt.current) / 1000 : 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Formal interview" subtitle="A timed session with weighted 0-100 scoring, a written and SQL stage, and a saved report you can export as PDF. Practice estimates, not a hiring prediction." actions={<Link href="/mock-interview" className={buttonVariants({ variant: "outline", size: "sm" })}>Practice mode</Link>} />
      {notice && <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Banner>}
      {step === "loading" && <Skeleton variant="form" count={1} />}
      {step === "resume" && <ResumeStep profile={profile} roles={roles} profileId={profileId} onSaved={(p, r, id) => { setProfile(p); setRoles(r); setProfileId(id); }} onNotice={setNotice} onNext={(r, l) => { if (r) setRole(r); if (l) setLevel(l); setStep("setup"); }} />}
      {step === "setup" && <Setup {...{ role, setRole, type, setType, level, setLevel, minutes, setMinutes, profileId }} onNotice={setNotice} onStarted={(s) => { setSess(s); loadedAt.current = Date.now(); setStep("run"); }} onBack={() => setStep("resume")} />}
      {step === "paused" && sess && (<Card><CardContent className="space-y-3"><p className="font-medium">Your interview is paused.</p><p className="text-sm text-muted-foreground">The timer is stopped at {mmss(sess.elapsed_seconds)}. Paused sessions are not included in reports.</p><div className="flex gap-2"><Button onClick={async () => { const r = await api<{ session: Sess }>("/api/interview/sessions/v2", { method: "POST", ...jsonBody({ action: "resume", session_id: sess.id }) }); if (r.ok) { setSess(r.data.session); loadedAt.current = Date.now(); setStep(r.data.session.stage === "written" ? "written" : "run"); } else setNotice({ tone: "error", text: err(r) }); }}>Resume</Button><Button variant="outline" onClick={async () => { if (confirm("End this interview without a report?")) { await api("/api/interview/sessions/v2", { method: "POST", ...jsonBody({ action: "abandon", session_id: sess.id }) }); setSess(null); setStep("resume"); } }}>Discard</Button></div></CardContent></Card>)}
      {step === "run" && sess && <Run sess={sess} elapsed={elapsed} onNotice={setNotice} onPaused={(s) => { setSess(s); setStep("paused"); }} onDone={() => setStep("written")} onEndNow={() => setStep("finishing")} />}
      {step === "written" && sess && <Written sess={sess} elapsed={elapsed} onNotice={setNotice} onDone={() => setStep("finishing")} />}
      {step === "finishing" && sess && <Finish sess={sess} onNotice={setNotice} onReport={(r) => { setReport(r); setReportId(sess.id); setSess(null); setStep("report"); }} />}
      {step === "report" && report && reportId && <ReportView r={report} id={reportId} onAgain={() => { setReport(null); setStep("setup"); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ resume
function ResumeStep({ profile, roles, profileId, onSaved, onNotice, onNext }: { profile: ResumeProfile | null; roles: RoleRecommendation[]; profileId: number | null; onSaved: (p: ResumeProfile, r: RoleRecommendation[], id: number) => void; onNotice: (n: { tone: "error" | "warn" | "info"; text: string } | null) => void; onNext: (role?: string, level?: InterviewLevel) => void }) {
  const [busy, setBusy] = useState(false); const [skills, setSkills] = useState(profile?.skills.join(", ") ?? ""); const [name, setName] = useState(profile?.name ?? "");
  const [draft, setDraft] = useState<ResumeProfile | null>(profile); const [rr, setRr] = useState(roles); const [saved, setSaved] = useState(!!profileId);
  useEffect(() => { setDraft(profile); setRr(roles); setSkills(profile?.skills.join(", ") ?? ""); setName(profile?.name ?? ""); setSaved(!!profileId); }, [profile, roles, profileId]);
  async function upload(f: File) {
    setBusy(true); onNotice(null); const fd = new FormData(); fd.append("file", f);
    const r = await api<{ profile: ResumeProfile; roles: RoleRecommendation[] }>("/api/interview/resume", { method: "POST", body: fd, timeoutMs: 45_000 }); setBusy(false);
    if (!r.ok) return onNotice({ tone: "error", text: err(r) });
    setDraft(r.data.profile); setRr(r.data.roles); setSkills(r.data.profile.skills.join(", ")); setName(r.data.profile.name ?? ""); setSaved(false);
    if (r.data.profile.warnings.length) onNotice({ tone: "warn", text: r.data.profile.warnings.join(" ") });
  }
  async function save() {
    if (!draft) return; setBusy(true);
    const p = { ...draft, name: name || null, skills: skills.split(",").map((s) => s.trim()).filter(Boolean) };
    const r = await api<{ id: number; profile: ResumeProfile; roles: RoleRecommendation[] }>("/api/interview/resume", { method: "PUT", ...jsonBody({ profile: p, id: profileId }) }); setBusy(false);
    if (!r.ok) return onNotice({ tone: "error", text: err(r) });
    onSaved(r.data.profile, r.data.roles, r.data.id); setSaved(true); onNotice({ tone: "info", text: "Profile saved. Interview questions will use only what is in it." });
  }
  return (
    <Card><CardContent className="space-y-4">
      <div><p className="font-medium">1. Your resume</p><p className="text-sm text-muted-foreground">Upload a PDF or DOCX (up to 5 MB). It is read once to build the profile below and then discarded; only the profile you confirm is saved. If you already gave Atlas your resume, it appears here automatically.</p></div>
      <div className="flex flex-wrap items-center gap-2"><Input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="Resume file" disabled={busy} className="max-w-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />{busy && <Loader2Icon className="animate-spin" />}</div>
      {draft && (
        <div className="space-y-3 rounded-lg border border-border/70 p-3">
          <p className="text-sm font-medium">Check what was found, and fix anything wrong</p>
          <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="rn">Name</Label><Input id="rn" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} /></div><div><Label htmlFor="rs">Skills (comma separated)</Label><Textarea id="rs" rows={2} value={skills} onChange={(e) => { setSkills(e.target.value); setSaved(false); }} /></div></div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {([["Education", draft.education], ["Internships", draft.internships.map((e) => e.heading)], ["Experience", draft.experience.map((e) => e.heading)], ["Projects", draft.projects.map((e) => e.heading)], ["Certifications", draft.certifications], ["Achievements", draft.achievements]] as [string, string[]][]).map(([k, v]) => (<div key={k}><dt className="text-xs font-semibold uppercase text-muted-foreground">{k}</dt><dd>{v.length ? v.slice(0, 5).join(" · ") : <span className="text-muted-foreground">Nothing found</span>}</dd></div>))}
          </dl>
          <div className="flex items-center gap-2"><Button onClick={save} disabled={busy || saved}>{saved ? "Saved" : "Save profile"}</Button><span className="text-xs text-muted-foreground">Nothing is invented: missing parts stay empty.</span></div>
        </div>
      )}
      {rr.length > 0 && (<div className="space-y-2"><p className="text-sm font-medium">Roles that fit what is in your profile</p>
        {rr.map((x) => (<div key={x.role} className="rounded-lg border border-border/70 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{x.role}</span><span className="flex gap-1.5"><Badge variant="secondary">fit {x.fit}</Badge><Badge variant="outline">{x.level} · {x.difficulty}</Badge></span></div>
          <p className="mt-1 text-muted-foreground">Matching skills: {x.matchingSkills.join(", ")}</p>
          {x.relevantProjects.length > 0 && <p className="text-muted-foreground">Projects: {x.relevantProjects.map((p) => `${p.name} (${p.because})`).join("; ")}</p>}
          {x.relevantInternships.length > 0 && <p className="text-muted-foreground">Internships/experience: {x.relevantInternships.map((p) => `${p.name} (${p.because})`).join("; ")}</p>}
          {x.missingSkills.length > 0 && <p className="text-muted-foreground">Not in your resume yet: {x.missingSkills.join(", ")}</p>}
          <p className="text-xs text-muted-foreground">Difficulty: {x.difficultyReason}</p>
          <Button size="sm" className="mt-2" variant="outline" onClick={() => onNext(x.role, x.level)}>Interview for this role</Button></div>))}</div>)}
      <Button variant="ghost" onClick={() => onNext()}>{draft ? "Continue with a role I type" : "Skip, continue without a resume"}</Button>
    </CardContent></Card>
  );
}

// ------------------------------------------------------------------ setup
function Setup(p: { role: string; setRole: (v: string) => void; type: InterviewType; setType: (v: InterviewType) => void; level: InterviewLevel; setLevel: (v: InterviewLevel) => void; minutes: 10 | 20 | 30; setMinutes: (v: 10 | 20 | 30) => void; profileId: number | null; onNotice: (n: { tone: "error" | "warn" | "info"; text: string } | null) => void; onStarted: (s: Sess) => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false); const plan = { 10: 3, 20: 5, 30: 8 } as const;
  async function start() {
    setBusy(true); p.onNotice(null);
    const q = await api<{ questions: Question[] }>("/api/interview", { method: "POST", timeoutMs: 60_000, ...jsonBody({ action: "start", type: p.type, level: p.level, count: plan[p.minutes] }) });
    if (!q.ok || !q.data.questions?.length) { setBusy(false); return p.onNotice({ tone: "error", text: err(q) }); }
    const c = await api<{ session_id: number }>("/api/interview/sessions/v2", { method: "POST", ...jsonBody({ action: "create_formal", minutes: p.minutes, type: p.type, level: p.level, role: p.role || undefined, questions: q.data.questions.slice(0, plan[p.minutes]), resume_profile_id: p.profileId ?? undefined }) });
    if (!c.ok) { setBusy(false); return p.onNotice({ tone: "error", text: err(c) }); }
    const o = await api<{ session: Sess }>("/api/interview/sessions/v2"); setBusy(false);
    if (o.ok && o.data.session) p.onStarted(o.data.session);
  }
  return (
    <Card><CardContent className="space-y-4">
      <p className="font-medium">2. Set up the session</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="role">Role</Label><Input id="role" value={p.role} maxLength={120} placeholder="e.g. Backend Developer" onChange={(e) => p.setRole(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Interview type</Label><SelectField aria-label="Interview type" value={p.type} onValueChange={(v) => p.setType(v as InterviewType)} options={(Object.keys(TYPE_LABEL) as InterviewType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} /></div>
        <div className="space-y-1.5"><Label>Level</Label><SelectField aria-label="Level" value={p.level} onValueChange={(v) => p.setLevel(v as InterviewLevel)} options={INTERVIEW_LEVELS.map((l) => ({ value: l, label: l }))} /></div>
        <div className="space-y-1.5"><Label>Length</Label><SelectField aria-label="Length" value={String(p.minutes)} onValueChange={(v) => p.setMinutes(Number(v) as 10 | 20 | 30)} options={[{ value: "10", label: "10 minutes (3 questions)" }, { value: "20", label: "20 minutes (5 questions)" }, { value: "30", label: "30 minutes (8 questions)" }]} /></div>
      </div>
      <p className="text-xs text-muted-foreground">After the spoken questions there is a short written stage (multiple choice, short explanation and one SQL task). You can pause at any time; paused sessions are not reported.</p>
      <div className="flex gap-2"><Button onClick={start} disabled={busy}>{busy && <Loader2Icon className="animate-spin" />} Start interview</Button><Button variant="ghost" onClick={p.onBack}>Back</Button></div>
    </CardContent></Card>
  );
}

// ------------------------------------------------------------------ run
function Run({ sess, elapsed, onNotice, onPaused, onDone, onEndNow }: { sess: Sess; elapsed: number; onNotice: (n: { tone: "error" | "warn" | "info"; text: string } | null) => void; onPaused: (s: Sess) => void; onDone: () => void; onEndNow: () => void }) {
  const [idx, setIdx] = useState(0); const [answer, setAnswer] = useState(""); const [busy, setBusy] = useState(false); const [res, setRes] = useState<Result | null>(null);
  const total = sess.questions.length; const q = sess.questions[idx]; const limit = (sess.target_minutes ?? 10) * 60;
  async function submit() {
    setBusy(true); onNotice(null);
    const r = await api<Result & { ok: boolean }>("/api/interview/evaluate", { method: "POST", timeoutMs: 60_000, ...jsonBody({ session_id: sess.id, question_id: q!.id, answer, input_mode: "text" }) }); setBusy(false);
    if (!r.ok) return onNotice({ tone: "error", text: `${err(r)} Your answer is still in the box, so nothing is lost.` });
    setRes(r.data);
  }
  async function pause() { const r = await api<{ session: Sess }>("/api/interview/sessions/v2", { method: "POST", ...jsonBody({ action: "pause", session_id: sess.id }) }); if (r.ok) onPaused(r.data.session); else onNotice({ tone: "error", text: err(r) }); }
  if (!q) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>Question {idx + 1} of {total}</span><span className={cn("tabular-nums", elapsed > limit && "text-warning")} aria-label="Elapsed time">{mmss(elapsed)} / {mmss(limit)}{elapsed > limit && " · over the planned time"}</span></div>
      <div className="h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${(idx / total) * 100}%` }} /></div>
      <Card><CardContent className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interviewer</p>
        <p className="text-base leading-relaxed" data-testid="question">{q.text}</p>
        {!res ? (<>
          <Label htmlFor="ans" className="sr-only">Your answer</Label>
          <Textarea id="ans" rows={6} value={answer} maxLength={4000} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer in your own words. Only what you say here is scored, not what is on your resume." />
          <p className="text-xs text-muted-foreground">Prefer to speak? Use the <Link href="/mock-interview/voice" className="text-primary hover:underline">voice interview</Link> (live conversation, transcript review).</p>
          <div className="flex flex-wrap gap-2"><Button onClick={submit} disabled={busy || answer.trim().length < 20}>{busy && <Loader2Icon className="animate-spin" />} Submit answer</Button><Button variant="ghost" onClick={pause}>Pause</Button><Button variant="ghost" className="text-destructive" onClick={onEndNow}>End interview</Button></div>
        </>) : (
          <div className="space-y-3">
            <p className={cn("text-2xl font-semibold", tone(res.feedback.score))}>{res.feedback.score}<span className="text-sm text-muted-foreground">/100</span></p>
            <p className="text-sm">{res.feedback.verdict}</p>
            <div className="space-y-2">{res.rubric.components.map((c) => <Bar key={c.label} label={`${c.label} (${c.weight}%)`} value={c.score} note={c.evidence} />)}</div>
            {res.rubric.communication && <Bar label="Communication (from your words, not your voice)" value={res.rubric.communication.overall} />}
            {res.feedback.improvements.length > 0 && <ul className="list-disc pl-5 text-sm">{res.feedback.improvements.map((x) => <li key={x}>{x}</li>)}</ul>}
            <Button onClick={() => { setRes(null); setAnswer(""); if (idx + 1 >= total) onDone(); else setIdx(idx + 1); }}>{idx + 1 >= total ? "Continue to written stage" : "Next question"}</Button>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}

// ------------------------------------------------------------------ written + SQL
interface PQ { id: string; category: string; kind: "single" | "multi" | "true_false" | "short"; prompt: string; options?: { id: string; text: string }[]; multiple: boolean }
interface SqlCase { name: string; visible: boolean; passed: boolean; expected?: { columns: string[]; rows: unknown[][] }; actual?: { columns: string[]; rows: unknown[][] } | null; problem?: string }
function Written({ sess, elapsed, onNotice, onDone }: { sess: Sess; elapsed: number; onNotice: (n: { tone: "error" | "warn" | "info"; text: string } | null) => void; onDone: () => void }) {
  const [qs, setQs] = useState<PQ[] | null>(null); const [i, setI] = useState(0); const [choice, setChoice] = useState<string[]>([]); const [text, setText] = useState(""); const [out, setOut] = useState<{ correct: boolean; score: number; correctAnswer?: string[]; explanation: string; note?: string } | null>(null);
  const [sqlP, setSqlP] = useState<{ id: string; title: string; description: string; schema: string; exampleSetup: string; engineNote: string; hiddenCases: number } | null>(null); const [sql, setSql] = useState("SELECT "); const [grade, setGrade] = useState<{ correct: boolean; passed: number; total: number; cases: SqlCase[]; suggestions: string[]; explanation: string; referenceSolution: string; topicFeedback: string } | null>(null); const [phase, setPhase] = useState<"mcq" | "sql">("mcq"); const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => {
    const plan = sess.target_minutes === 30 ? 5 : sess.target_minutes === 20 ? 4 : 3;
    const r = await api<{ questions: PQ[]; notes: string[] }>("/api/interview/written", { method: "POST", ...jsonBody({ action: "start", count: plan }) });
    if (r.ok) setQs(r.data.questions); else { onNotice({ tone: "error", text: err(r) }); setQs([]); }
    const s = await api<{ problem: NonNullable<typeof sqlP> }>("/api/interview/sql", { method: "POST", ...jsonBody({ action: "problem", problem_id: "sql-second-highest" }) }); if (s.ok) setSqlP(s.data.problem);
  })(); }, [sess.target_minutes, onNotice]);
  async function submitQ() { const q = qs![i]!; setBusy(true); const r = await api<{ result: NonNullable<typeof out> }>("/api/interview/written", { method: "POST", ...jsonBody({ action: "submit", session_id: sess.id, question_id: q.id, choice: q.kind === "short" ? undefined : choice, text: q.kind === "short" ? text : undefined }) }); setBusy(false); if (r.ok) setOut(r.data.result); else onNotice({ tone: "error", text: err(r) }); }
  async function runSql(g: boolean) { setBusy(true); const r = await api<any>("/api/interview/sql", { method: "POST", ...jsonBody({ action: g ? "grade" : "run", session_id: sess.id, problem_id: sqlP!.id, sql }) }); setBusy(false); if (!r.ok) return onNotice({ tone: "error", text: err(r) }); if (g) setGrade(r.data.grade); else onNotice({ tone: r.data.run.ok ? "info" : "warn", text: r.data.run.ok ? `Ran on the example data: ${r.data.run.rows.length} row(s). ${JSON.stringify(r.data.run.rows.slice(0, 5))}` : r.data.run.message }); }
  async function finish() { await api("/api/interview/written", { method: "POST", ...jsonBody({ action: "finish", session_id: sess.id }) }); onDone(); }
  if (!qs) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" /> Preparing the written stage…</p>;
  if (phase === "mcq" && qs.length) {
    const q = qs[i]!;
    return (<Card><CardContent className="space-y-3">
      <div className="flex justify-between text-sm"><span>Written question {i + 1} of {qs.length} · <Badge variant="outline">{q.category}</Badge></span><span className="tabular-nums">{mmss(elapsed)}</span></div>
      <p className="text-base">{q.prompt}</p>
      {q.kind === "short" ? <Textarea rows={4} value={text} disabled={!!out} onChange={(e) => setText(e.target.value)} aria-label="Your explanation" /> : (
        <div className="space-y-1.5" role={q.multiple ? "group" : "radiogroup"} aria-label="Options">{q.options!.map((o) => (<label key={o.id} className="flex cursor-pointer items-center gap-2 rounded border border-border/70 p-2 text-sm"><input type={q.multiple ? "checkbox" : "radio"} name="opt" disabled={!!out} checked={choice.includes(o.id)} onChange={(e) => setChoice(q.multiple ? (e.target.checked ? [...choice, o.id] : choice.filter((c) => c !== o.id)) : [o.id])} />{o.text}</label>))}</div>)}
      {!out ? <Button onClick={submitQ} disabled={busy || (q.kind === "short" ? text.trim().length < 3 : choice.length === 0)}>{busy && <Loader2Icon className="animate-spin" />} Submit</Button> : (
        <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm"><p className={cn("font-medium", out.correct ? "text-success" : "text-warning")}>{out.correct ? "Correct" : "Not quite"} · {out.score}/100</p>{out.correctAnswer && <p>Correct answer: {out.correctAnswer.map((id) => q.options?.find((o) => o.id === id)?.text ?? id).join(", ")}</p>}<p>{out.explanation}</p>{out.note && <p className="text-xs text-muted-foreground">{out.note}</p>}
          <Button onClick={() => { setOut(null); setChoice([]); setText(""); if (i + 1 >= qs.length) setPhase("sql"); else setI(i + 1); }}>{i + 1 >= qs.length ? "Continue to SQL task" : "Next"}</Button></div>)}
    </CardContent></Card>);
  }
  return (<Card><CardContent className="space-y-3">
    <p className="font-medium">SQL task{sqlP ? `: ${sqlP.title}` : ""}</p>
    {sqlP ? (<>
      <p className="text-sm">{sqlP.description}</p>
      <details className="text-sm"><summary className="cursor-pointer font-medium">Table schema and example data</summary><pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-xs">{sqlP.schema}{"\n\n"}{sqlP.exampleSetup}</pre></details>
      <p className="text-xs text-muted-foreground">{sqlP.engineNote} {sqlP.hiddenCases} hidden test datasets also check NULLs, ties and empty groups.</p>
      <Label htmlFor="sqlq" className="sr-only">SQL query</Label>
      <Textarea id="sqlq" rows={6} className="font-mono text-sm" spellCheck={false} value={sql} onChange={(e) => setSql(e.target.value)} />
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => runSql(false)} disabled={busy}>Run on example data</Button><Button onClick={() => runSql(true)} disabled={busy}>{busy && <Loader2Icon className="animate-spin" />} Check my answer</Button><Button variant="ghost" onClick={finish}>{grade ? "Finish written stage" : "Skip SQL"}</Button></div>
      {grade && (<div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm"><p className={cn("font-medium", grade.correct ? "text-success" : "text-warning")}>{grade.passed} of {grade.total} test cases passed</p>
        {grade.cases.map((c) => (<div key={c.name}><p>{c.passed ? "✓" : "✗"} {c.name}{c.problem ? `: ${c.problem}` : ""}</p>{c.visible && !c.passed && c.expected && <pre className="overflow-x-auto text-xs">Expected: {JSON.stringify(c.expected.rows)}{"\n"}Got: {JSON.stringify(c.actual?.rows ?? null)}</pre>}</div>))}
        {grade.suggestions.map((s) => <p key={s} className="text-warning">{s}</p>)}<p>{grade.explanation}</p><p className="text-xs text-muted-foreground">{grade.topicFeedback}</p>
        <details><summary className="cursor-pointer">Reference solution</summary><pre className="overflow-x-auto text-xs">{grade.referenceSolution}</pre></details></div>)}
    </>) : <Button onClick={finish}>Finish</Button>}
    {!qs.length && <Button variant="ghost" onClick={finish}>Skip the written stage</Button>}
  </CardContent></Card>);
}

// ------------------------------------------------------------------ finish + report
function Finish({ sess, onNotice, onReport }: { sess: Sess; onNotice: (n: { tone: "error" | "warn" | "info"; text: string } | null) => void; onReport: (r: ReportV2) => void }) {
  const [busy, setBusy] = useState(true); const [failed, setFailed] = useState<string | null>(null);
  const run = useCallback(async () => {
    setBusy(true); setFailed(null);
    await api("/api/interview/english", { method: "POST", timeoutMs: 60_000, ...jsonBody({ session_id: sess.id }) });   // best effort: the report says so when no assessment exists
    const r = await api<{ report: ReportV2 }>("/api/interview/sessions/v2", { method: "POST", ...jsonBody({ action: "complete", session_id: sess.id }) }); setBusy(false);
    if (r.ok) onReport(r.data.report); else { setFailed(err(r)); onNotice({ tone: "error", text: err(r) }); }
  }, [sess.id, onReport, onNotice]);
  useEffect(() => { void run(); }, [run]);
  return busy ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" /> Building your report…</p> : <Button onClick={run}><RotateCcwIcon /> {failed ? "Try again" : "Build report"}</Button>;
}

function ReportView({ r, id, onAgain }: { r: ReportV2; id: number; onAgain: () => void }) {
  const s = r.scores; const e = r.english;
  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{r.title}</p><p className="text-sm text-muted-foreground">{r.role} · {new Date(r.date).toLocaleDateString("en-IN")} · {r.durationMinutes ?? "?"} min · {r.questionsAnswered}/{r.questionsPlanned} questions</p></div><a className={buttonVariants({ size: "sm" })} href={`/api/interview/sessions/pdf?id=${id}`}>Download PDF</a></div>
        <p className="text-xs text-muted-foreground">{r.confidence} {r.limitations[0]}</p>
        <div className="grid gap-3 sm:grid-cols-2">{([["Overall", s.overall], ["Technical", s.technical], ["Communication", s.communication], ["Problem-solving", s.problemSolving], ["Behavioural", s.behavioural], ["Written test", r.written?.score ?? null]] as [string, number | null][]).map(([k, v]) => v === null ? <p key={k} className="text-xs text-muted-foreground">{k}: not assessed</p> : <Bar key={k} label={k} value={v} />)}</div>
      </CardContent></Card>
      {e && (<Card><CardContent className="space-y-2"><p className="font-medium">Spoken English</p><p className="text-xs text-warning">{e.label}</p><p className="text-sm">Estimated level: <strong>{e.level === "insufficient" ? "not enough evidence yet" : e.level}</strong> ({e.confidence} confidence). {e.eligibilityNote}</p><p className="text-xs text-muted-foreground">{e.limitations[0]}</p>{e.exercises.length > 0 && <ul className="list-disc pl-5 text-sm">{e.exercises.map((x) => <li key={x}>{x}</li>)}</ul>}</CardContent></Card>)}
      {r.recommendations.length > 0 && (<Card><CardContent className="space-y-2"><p className="font-medium">What to work on</p><ul className="list-disc pl-5 text-sm">{r.recommendations.map((x) => <li key={x}>{x}</li>)}</ul></CardContent></Card>)}
      <Card><CardContent className="space-y-3"><p className="font-medium">Question by question</p>{r.questions.map((q, n) => (<details key={q.id} className="rounded-lg border border-border/70 p-3 text-sm"><summary className="cursor-pointer"><span className={cn("font-medium", tone(q.score))}>{q.score}/100</span> · Q{n + 1}. {q.question}{q.basis === "legacy_unweighted" && <Badge variant="outline" className="ml-2">legacy score</Badge>}</summary><div className="mt-2 space-y-1">{q.components.map((c) => <Bar key={c.label} label={`${c.label} (${c.weight}%)`} value={c.score} note={c.evidence} />)}<p>{q.verdict}</p></div></details>))}</CardContent></Card>
      <Button variant="outline" onClick={onAgain}>Start another interview</Button>
    </div>
  );
}
