"use client";
// Mock Interview: an AI interviewer asks questions tailored to your profile (and optionally a startup you are
// applying to), scores each answer and gives a follow-up. Voice is optional and uses the browser's own speech
// recognition / speech synthesis; nothing is recorded or stored by Jyntra.
import { useCallback, useEffect, useRef, useState } from "react";
import { ScoreRing } from "@/components/kit/ScoreRing";
import { useToast } from "@/components/kit/Toast";
import { downloadText } from "@/lib/client-download";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { SelectField } from "@/components/SelectField";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLinkIcon, Loader2Icon, MicIcon, MicOffIcon, RotateCwIcon, SparklesIcon, VolumeIcon, ArrowRightIcon, DownloadIcon } from "@/components/icons";
import { TOPICS, INTERVIEW_LEVELS, MAX_ATTEMPTS, MIN_ANSWER_CHARS, PASS_SCORE, TIMED_SECONDS, TYPE_LABEL, practiceNext, type Feedback, type InterviewLevel, type InterviewType, type Question, type RoleSuggestion } from "@/lib/interview";
import { cn } from "@/lib/utils";

interface StartupOpt {
  id: number;
  name: string;
  jobs: unknown[];
}
interface Round {
  q: Question;
  answer: string;
  fb: Feedback;
}

type Mode = "practice" | "timed";
const TYPES = Object.keys(TYPE_LABEL) as InterviewType[];
const LEVEL_LABEL: Record<InterviewLevel, string> = { intern: "Intern", junior: "Junior (0-2 yrs)", mid: "Mid (3-5 yrs)", senior: "Senior (6+ yrs)" };

// Minimal typing for the browser Speech API (not in lib.dom for every TS version).
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
const speechCtor = (): (new () => Rec) | null => (typeof window === "undefined" ? null : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

const scoreTone = (n: number) => (n >= 75 ? "text-success" : n >= 50 ? "text-foreground" : "text-warning");


/** Your real interview history beside the setup form (same data as the dashboard). Shows nothing invented. */
function ProgressRail() {
  const [d, setD] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    fetch("/api/dashboard/modules").then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setD).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  const iv = d?.interview;
  return (
    <aside aria-label="Your interview progress" className="space-y-4 lg:border-l lg:border-border lg:pl-6">
      <p className="eyebrow !text-foreground">Your progress</p>
      {/* Skeleton only while the request is actually in flight; then real numbers, an empty state, or a retry. Never a standing "Loading…". */}
      {!iv && !failed ? <Skeleton variant="interview-progress" count={3} /> : failed ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your progress. <button type="button" onClick={load} className="font-medium text-accent-brand-foreground hover:underline">Try again</button></p>
      ) : iv.completed === 0 ? (
        <p className="text-sm text-muted-foreground">No finished sessions yet. Your first report will show your score and what to practise next.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div><p className="eyebrow">Best</p><p className="display text-4xl tabular-nums">{iv.best ?? "–"}</p></div>
            <div><p className="eyebrow">Average</p><p className="display text-4xl tabular-nums">{iv.avg ?? "–"}</p></div>
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {iv.recent.map((s: any) => (
              <li key={s.id}><Link href={`/mock-interview/history?id=${s.id}`} className="flex items-center gap-3 py-2.5 text-sm outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 flex-1 truncate">{s.role ?? s.type}</span><span className="font-mono text-xs tabular-nums">{s.overall ?? "–"}/100</span></Link></li>
            ))}
          </ul>
          <Link href="/mock-interview/history" className="text-xs font-medium text-accent-brand-foreground hover:underline">All sessions and reports</Link>
        </>
      )}
      <div className="rounded-md border border-border bg-secondary/50 p-3 text-xs text-muted-foreground"><p className="mb-1 font-semibold text-foreground">How scoring works</p>Each answer is scored out of 100 and gets one follow-up. Practice mode lets you retry until 75.</div>
    </aside>
  );
}

/** Live tracker beside the active question: every question, its status and the score once answered. */
function SessionRail({ questions, rounds, idx }: { questions: Question[]; rounds: Round[]; idx: number }) {
  return (
    <aside aria-label="Session tracker" className="lg:sticky lg:top-20 lg:self-start lg:border-l lg:border-border lg:pl-6">
      <p className="eyebrow mb-3 !text-foreground">Session</p>
      <ol className="space-y-1">
        {questions.map((q, i) => {
          const r = rounds.find((x) => x.q.id === q.id);
          return (
            <li key={q.id} aria-current={i === idx ? "step" : undefined} className={cn("flex items-start gap-3 rounded-md px-2 py-2 text-sm", i === idx && "bg-secondary")}>
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm border font-mono text-[10px]", r ? "border-foreground bg-foreground text-background" : i === idx ? "border-accent-brand text-accent-brand-foreground" : "border-border text-muted-foreground")}>{i + 1}</span>
              <span className="min-w-0 flex-1"><span className={cn("line-clamp-2 leading-snug", i > idx && !r && "text-muted-foreground")}>{q.text}</span></span>
              {r && <span className="font-mono text-xs tabular-nums">{r.fb.score}</span>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export default function MockInterviewPage() {
  const router = useRouter();
  const [startups, setStartups] = useState<StartupOpt[]>([]);
  const [type, setType] = useState<InterviewType>("behavioral");
  const [level, setLevel] = useState<InterviewLevel>("junior");
  const [startupId, setStartupId] = useState("none");
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [context, setContext] = useState<{ startup: string | null; role: string | null }>({ startup: null, role: null });
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState<"start" | "feedback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [listening, setListening] = useState(false);
  const [secs, setSecs] = useState(0);
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("practice");
  const [attempt, setAttempt] = useState(1);
  const [roles, setRoles] = useState<RoleSuggestion[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [rolesBusy, setRolesBusy] = useState(false);
  const [topic, setTopic] = useState("any");
  const [jd, setJd] = useState("");
  const [paused, setPaused] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [report, setReport] = useState<any>(null);
  const rec = useRef<Rec | null>(null);
  const baseText = useRef("");
  // Browser capabilities are read after mount so the server and first client render match (no hydration mismatch).
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => {
    // Opened from Atlas ("Practise interview" on a tracked application): preset the target role. Read from the URL after mount.
    const r = new URLSearchParams(window.location.search).get("role")?.trim().slice(0, 120);
    if (r) setRole(r);
    setCanListen(!!speechCtor());
    setCanSpeak("speechSynthesis" in window);
  }, []);

  useEffect(() => {
    api("/api/startups").then(({ ok, status, data }) => {
      if (status === 401) return router.replace("/onboarding");
      if (ok) setStartups(((data.startups ?? []) as StartupOpt[]).map((s) => ({ id: s.id, name: s.name, jobs: s.jobs ?? [] })).sort((a, b) => b.jobs.length - a.jobs.length || a.name.localeCompare(b.name)).slice(0, 300));
    });
    return () => {
      rec.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, [router]);

  // Answer timer: runs while a question is open and unanswered.
  const open = !!questions && !fb && idx < (questions?.length ?? 0);
  useEffect(() => { if (open) { setSecs(0); setPaused(false); } }, [open, idx]);
  useEffect(() => {
    if (!open || paused) return; // pausing freezes the clock; resuming continues from the same second
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [open, paused]);

  const q0 = questions?.[idx];
  const limit = q0?.written ? TIMED_SECONDS.written : TIMED_SECONDS.spoken;
  const left = Math.max(0, limit - secs);
  // Timed mode: when the clock runs out, submit what was written (if it is a real attempt) or move on.
  const autoFired = useRef(-1);
  useEffect(() => {
    if (mode !== "timed" || !open || busy || secs < limit || autoFired.current === idx) return;
    autoFired.current = idx; // once per question: a failed auto-submit must not retry every second
    if (answer.trim().length >= MIN_ANSWER_CHARS) void submit();
    else next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secs, mode, open, busy]);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.speak(u);
  }, []);

  const stopListening = useCallback(() => {
    rec.current?.stop();
    setListening(false);
  }, []);

  function toggleMic() {
    if (listening) return stopListening();
    const C = speechCtor();
    if (!C) return;
    const r = new C();
    r.lang = navigator.language || "en-IN";
    r.interimResults = true;
    r.continuous = true;
    baseText.current = answer ? answer.trimEnd() + " " : "";
    r.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setAnswer((baseText.current + t).slice(0, 4000));
    };
    r.onerror = (e: any) => {
      setListening(false);
      const code = e?.error as string | undefined;
      if (code === "no-speech" || code === "aborted") return;
      setError(
        code === "not-allowed" || code === "service-not-allowed" ? "Microphone access is blocked. Click the lock icon in the address bar, allow the microphone, then press the mic again."
        : code === "audio-capture" ? "No microphone was found. Connect one and try again."
        : code === "network" ? "This browser's speech service could not be reached (it needs an internet connection and works best in Chrome or Edge). Type your answer, or use the Voice interview page, which transcribes on the server."
        : "Speech input stopped unexpectedly. You can type your answer instead."
      );
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    try {
      // Ask for the microphone explicitly first: it gives a real permission prompt and a clear error when blocked.
      navigator.mediaDevices?.getUserMedia({ audio: true }).then((st) => { st.getTracks().forEach((t) => t.stop()); r.start(); setListening(true); }).catch(() => setError("Microphone access is blocked or unavailable. Allow it in your browser's site settings, or type your answer."));
    } catch {
      setError("Speech input could not start in this browser. Type your answer instead.");
    }
  }

  async function suggestRoles() {
    setError(null);
    setRolesBusy(true);
    const r = await api("/api/interview", { method: "POST", timeoutMs: 60_000, ...jsonBody({ action: "roles", type, level }) });
    setRolesBusy(false);
    if (r.status === 401) return router.replace("/onboarding");
    if (r.data?.code === "not_configured") return setNotConfigured(true);
    if (!r.ok || !r.data?.ok) return setError(r.data?.message ?? r.error);
    setRoles(r.data.roles);
  }

  async function start() {
    setError(null);
    setNotConfigured(false);
    setBusy("start");
    const body = { action: "start", type, level, count: 5, timed: mode === "timed", ...(role ? { role } : {}), ...(topic !== "any" ? { topic } : {}), ...(jd.trim().length >= 40 ? { job_description: jd.trim() } : {}), ...(startupId !== "none" ? { startup_id: Number(startupId) } : {}) };
    const r = await api("/api/interview", { method: "POST", timeoutMs: 60_000, ...jsonBody(body) });
    setBusy(null);
    if (r.status === 401) return router.replace("/onboarding");
    if (r.data?.code === "not_configured") return setNotConfigured(true);
    if (!r.ok || !r.data?.ok) return setError(r.data?.message ?? r.error);
    setQuestions(r.data.questions);
    setSessionId(null);
    setReport(null);
    // Save the session so scores, transcripts and the final report persist. If this fails the interview still works, just unsaved.
    api("/api/interview/sessions", { method: "POST", ...jsonBody({ action: "create", mode, type, level, role: r.data.role ?? role ?? undefined, ...(startupId !== "none" ? { startup_id: Number(startupId) } : {}), questions: r.data.questions }) }).then((s) => { if (s.ok && s.data?.session_id) setSessionId(s.data.session_id); });
    setContext({ startup: r.data.startup ?? null, role: r.data.role ?? null });
    setIdx(0);
    setRounds([]);
    setFb(null);
    setAnswer("");
    setAttempt(1);
    if (canSpeak) speak(r.data.questions[0].text);
  }

  async function submit() {
    if (!questions) return;
    stopListening();
    window.speechSynthesis?.cancel();
    setError(null);
    setBusy("feedback");
    const q = questions[idx];
    const body = { action: "feedback", type, level, question: q.text, answer, attempt, written: q.written === true, ...(sessionId ? { session_id: sessionId, question_id: q.id } : {}), ...(role ? { role } : {}), ...(startupId !== "none" ? { startup_id: Number(startupId) } : {}) };
    const r = await api("/api/interview", { method: "POST", timeoutMs: 60_000, ...jsonBody(body) });
    setBusy(null);
    if (!r.ok || !r.data?.ok) return setError(r.data?.message ?? r.error);
    // A retry replaces the earlier attempt of the same question, so the summary shows the best-effort final answer.
    setRounds((p) => [...p.filter((x) => x.q.id !== q.id), { q, answer, fb: r.data.feedback }]);
    if (mode === "timed") return next(); // timed interviews hold feedback until the end, like a real one
    setFb(r.data.feedback);
  }

  function retry() {
    setFb(null);
    setAttempt((a) => a + 1);
    setSecs(0);
  }

  function next() {
    if (!questions) return;
    const n = idx + 1;
    setIdx(n);
    setFb(null);
    setAnswer("");
    setAttempt(1);
    if (n < questions.length && canSpeak) speak(questions[n].text);
  }

  function reset() {
    setSessionId(null);
    setReport(null);
    stopListening();
    window.speechSynthesis?.cancel();
    setQuestions(null);
    setRounds([]);
    setFb(null);
    setAnswer("");
    setIdx(0);
    setAttempt(1);
    setError(null);
  }

  const done = !!questions && idx >= questions.length;
  // Finish the saved session once, when the last question is passed: the report is built on the server from the stored answers.
  useEffect(() => {
    if (!done || !sessionId || report) return;
    api("/api/interview/sessions", { method: "POST", ...jsonBody({ action: "complete", session_id: sessionId }) }).then((s) => { if (s.ok && s.data?.report) setReport(s.data.report); });
  }, [done, sessionId, report]);
  const avg = rounds.length ? rounds.reduce((n, r) => n + r.fb.score, 0) / rounds.length : 0;
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <PageHeader
        art={questions ? undefined : "/illustrations/3d/mic.png"}
        eyebrow={questions ? (done ? "Results" : "In session") : "Assessment workspace"}
        title="Mock interview"
        subtitle={questions ? undefined : "Practise out loud or in writing. The interviewer uses your profile, scores every answer and asks a follow-up."}
        actions={questions ? <Button variant="outline" onClick={reset}><RotateCwIcon /> New interview</Button> : <Button variant="outline" asChild><Link href="/mock-interview/history">History</Link></Button>}
      />

      {!questions && (
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Other interview formats">
          <Link href="/mock-interview/voice" className="surface surface-hover rounded-lg p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="eyebrow">Spoken</p><p className="mt-1 text-sm font-semibold">Voice interview</p><p className="text-xs text-muted-foreground">Transcript review and a spoken-English report.</p></Link>
          <Link href="/mock-interview/formal" className="surface surface-hover rounded-lg p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="eyebrow">Timed</p><p className="mt-1 text-sm font-semibold">Formal interview</p><p className="text-xs text-muted-foreground">Written and SQL stage with a PDF report.</p></Link>
        </div>
      )}
      {notConfigured && <Banner tone="warn">The AI interviewer needs an AI key on the server (GROQ_API_KEY or GEMINI_API_KEY). Everything else in the app works without it.</Banner>}
      {error && <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner>}

      {!questions && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Interview type
              <SelectField aria-label="Interview type" value={type} onValueChange={(v) => setType(v as InterviewType)} options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} className="w-full" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Level
              <SelectField aria-label="Level" value={level} onValueChange={(v) => setLevel(v as InterviewLevel)} options={INTERVIEW_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} className="w-full" />
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Practise for a startup (optional)
              <SelectField
                aria-label="Practise for a startup"
                value={startupId}
                onValueChange={setStartupId}
                options={[{ value: "none", label: "Any company" }, ...startups.map((s) => ({ value: String(s.id), label: `${s.name}${s.jobs.length ? ` (${s.jobs.length} open)` : ""}` }))]}
                className="w-full"
              />
            </label>
            <div className="space-y-1.5 sm:col-span-2">
              <p className="text-sm font-medium">Mode</p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Interview mode">
                {([["practice", "Practice", `Retry each answer up to ${MAX_ATTEMPTS} times until it scores ${PASS_SCORE}/100 or more, with coaching in between.`], ["timed", "Timed interview", "A countdown per question, one short written exercise, and feedback only at the end."]] as const).map(([v, label, d]) => (
                  <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)} className={cn("rounded-md border border-border p-3 text-left text-sm transition-colors", mode === v ? "border-primary bg-primary/10" : "hover:bg-muted/50")}>
                    <span className="block font-medium">{label}</span><span className="block text-xs text-muted-foreground">{d}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Target role</p>
                <Button size="sm" variant="outline" onClick={suggestRoles} disabled={rolesBusy}>{rolesBusy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Suggest from my profile</Button>
                {role && <Button size="sm" variant="ghost" onClick={() => setRole(null)}>Clear</Button>}
              </div>
              {roles && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {roles.map((r) => (
                    <li key={r.title}><button type="button" aria-pressed={role === r.title} onClick={() => setRole(r.title)} className={cn("w-full rounded-lg border p-2 text-left text-xs", role === r.title ? "border-primary bg-primary/10" : "hover:bg-muted/50")}><span className="block text-sm font-medium">{r.title}</span><span className="text-muted-foreground">{r.why}</span></button></li>
                  ))}
                </ul>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <SelectField aria-label="Topic focus" value={topic} onValueChange={setTopic} options={[{ value: "any", label: "Any topic" }, ...TOPICS.map((x) => ({ value: x, label: x }))]} className="h-9 text-xs" />
                <p className="self-center text-xs text-muted-foreground">Pick “Resume and projects” to be asked about your own projects.</p>
              </div>
              <Textarea aria-label="Job description (optional)" value={jd} onChange={(e) => setJd(e.target.value.slice(0, 3000))} placeholder="Optional: paste a job description to tailor the questions to it (40+ characters)." className="min-h-20 text-xs" />
              {role && <p className="text-xs text-muted-foreground">Questions will be tailored to: <span className="font-medium text-foreground">{role}</span></p>}
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button onClick={start} disabled={busy === "start"}>
                {busy === "start" ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                {busy === "start" ? "Preparing questions…" : "Start interview"}
              </Button>
              <p className="text-xs text-muted-foreground">
                5 questions{mode === "timed" ? `, ${Math.round(TIMED_SECONDS.spoken / 60)} min each (${Math.round(TIMED_SECONDS.written / 60)} min for the written one)` : ""}. Voice input {canListen ? "is available in this browser" : "isn't supported in this browser, so type your answers"}; it uses your browser's speech service and nothing is saved by Jyntra.
              </p>
            </div>
          </CardContent>
        </Card>
        </div>
        <ProgressRail />
        </div>
      )}

      {questions && !done && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={questions.length} aria-valuenow={idx + 1} aria-label={`Question ${idx + 1} of ${questions.length}`}>
              {questions.map((_: any, i: number) => <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i < idx ? "bg-foreground" : i === idx ? "bg-accent-brand" : "bg-border")} />)}
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Badge variant="secondary">Question {idx + 1} of {questions.length}</Badge>
              <span>{TYPE_LABEL[type]} · {LEVEL_LABEL[level]}</span>
              {context.startup && <span>· {context.startup}{context.role ? `, ${context.role}` : ""}</span>}
              {questions[idx].written && <Badge>Written exercise</Badge>}
              {mode === "practice" && attempt > 1 && <Badge variant="outline">Attempt {attempt} of {MAX_ATTEMPTS}</Badge>}
              {!fb && <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</Button>}
              {!fb && (mode === "timed"
                ? <span className={cn("ml-auto tabular-nums", left <= 30 && "font-medium text-warning")} aria-label="Time left on this question">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left</span>
                : <span className="ml-auto tabular-nums" aria-label="Time on this question">{mmss}</span>)}
            </div>
            <div className="flex items-start gap-2">
              <p key={idx} className="rise-in display flex-1 text-balance text-2xl sm:text-[1.75rem]">{questions[idx].text}</p>
              {canSpeak && (
                <Button variant="ghost" size="icon" aria-label="Read the question aloud" onClick={() => speak(questions[idx].text)}>
                  <VolumeIcon />
                </Button>
              )}
            </div>
            {questions[idx].focus && !fb && <p className="text-xs text-muted-foreground">A strong answer shows: {questions[idx].focus}</p>}

            {!fb ? (
              <>
                {paused && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" role="status">Paused. The clock is stopped. Resume when you are ready.</p>}
                <Textarea aria-label="Your answer" disabled={paused} value={answer} onChange={(e) => setAnswer(e.target.value.slice(0, 4000))} placeholder="Type your answer, or press the microphone and speak…" className="min-h-40" />
                <div className="flex flex-wrap items-center gap-2">
                  {canListen && (
                    <Button variant={listening ? "destructive" : "outline"} onClick={toggleMic} aria-pressed={listening}>
                      {listening ? <MicOffIcon /> : <MicIcon />}
                      {listening ? "Stop" : "Speak"}
                    </Button>
                  )}
                  <Button onClick={submit} disabled={busy === "feedback" || answer.trim().length < MIN_ANSWER_CHARS}>
                    {busy === "feedback" ? <Loader2Icon className="animate-spin" /> : null}
                    {busy === "feedback" ? "Scoring…" : "Submit answer"}
                  </Button>
                  <Button variant="ghost" onClick={next} disabled={busy === "feedback"}>Skip</Button>
                  <span className="ml-auto text-xs text-muted-foreground">{answer.length}/4000</span>
                </div>
              </>
            ) : (
              <div className="space-y-3" role="status" aria-live="polite">
                <div className="flex items-center gap-4 rounded-2xl bg-secondary/60 p-3">
                  <ScoreRing value={fb.score} size={76} />
                  <p className="text-sm font-medium">{fb.verdict}</p>
                </div>
                {fb.dimensions.length > 0 && (
                  <ul className="grid gap-2 sm:grid-cols-2" aria-label="Score breakdown">
                    {fb.dimensions.map((d) => (
                      <li key={d.name} className="rounded-lg border p-2 text-xs">
                        <span className="flex items-baseline justify-between"><span className="font-medium">{d.name}</span><span className={cn("tabular-nums font-semibold", scoreTone(d.score))}>{d.score}</span></span>
                        <span className="block h-1 rounded bg-muted"><span className="block h-1 rounded bg-primary" style={{ width: `${d.score}%` }} /></span>
                        {d.evidence && <span className="mt-1 block text-muted-foreground">{d.evidence}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {fb.strengths.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">What worked</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{fb.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {fb.improvements.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">To improve</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{fb.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {fb.structure && <p className="rounded-lg bg-muted/60 p-3 text-sm"><span className="font-medium">Try this structure: </span>{fb.structure}</p>}
                {fb.followUp && <p className="text-sm"><span className="font-medium">Likely follow-up: </span>{fb.followUp}</p>}
                {(() => {
                  const o = mode === "practice" ? practiceNext(fb.score, attempt) : "pass";
                  return (
                    <div className="space-y-2">
                      {mode === "practice" && o === "retry" && <p className="text-sm text-warning">Needs {PASS_SCORE}/100 to move on. Use the feedback above and try this question again ({attempt} of {MAX_ATTEMPTS} used).</p>}
                      {mode === "practice" && o === "move_on" && <p className="text-sm text-muted-foreground">That was your last attempt. Keep the feedback and come back to this one later.</p>}
                      <div className="flex flex-wrap gap-2">
                        {o === "retry" && <Button onClick={retry}><RotateCwIcon /> Try again</Button>}
                        <Button variant={o === "retry" ? "outline" : "default"} onClick={next}>{idx + 1 < questions.length ? (o === "retry" ? "Skip to next" : "Next question") : "See summary"} <ArrowRightIcon /></Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
        <SessionRail questions={questions} rounds={rounds} idx={idx} />
        </div>
      )}

      {done && (
        <Card>
          <CardContent className="space-y-4">
            <div className="hero-zone flex items-center gap-5 rounded-3xl p-5 text-white">
              <ScoreRing value={rounds.length ? avg : null} size={120} onDark />
              <div><p className="text-xs font-semibold uppercase tracking-wider text-white/70">Session result</p><p className="mt-1 text-lg font-semibold">{rounds.length ? "Average score" : "No score yet"}</p><p className="text-sm text-white/80">{rounds.length ? `Across ${rounds.length} answered question${rounds.length === 1 ? "" : "s"}` : "No questions were answered."}</p></div>
            </div>
            {report && (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {report.recurringWeaknesses.length > 0 && <div className="rounded-md border border-border p-3"><p className="font-medium">Recurring weaknesses</p><ul className="mt-1 list-disc pl-4 text-muted-foreground">{report.recurringWeaknesses.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
                {report.nextPractice.length > 0 && <div className="rounded-md border border-border p-3"><p className="font-medium">Next practice</p><ul className="mt-1 list-disc pl-4 text-muted-foreground">{report.nextPractice.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
                <p className="text-xs text-muted-foreground sm:col-span-2">Saved to your history. <a className="text-accent-brand-foreground underline" href={`/mock-interview/history?id=${sessionId}`}>Open the full report</a></p>
              </div>
            )}
            <ul className="divide-y rounded-md border border-border">
              {rounds.map((r) => (
                <li key={r.q.id} className="flex items-start gap-3 p-3 text-sm">
                  <span className={cn("w-8 shrink-0 text-lg font-semibold tabular-nums", scoreTone(r.fb.score))}>{r.fb.score}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{r.q.text}</p>
                    {r.q.written && <Badge variant="secondary">Written exercise</Badge>}
                    {r.fb.improvements[0] && <p className="text-muted-foreground">Next time: {r.fb.improvements[0]}</p>}
                    {mode === "timed" && r.fb.structure && <p className="text-xs text-muted-foreground">Structure to try: {r.fb.structure}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button onClick={reset}><RotateCwIcon /> Practise again</Button>
              <Button variant="outline" onClick={() => {
                const lines = [`Mock interview results`, `${TYPE_LABEL[type]} · ${LEVEL_LABEL[level]} · ${new Date().toLocaleDateString()}`, `Average score: ${rounds.length ? Math.round(avg) : "n/a"}/100`, "", ...rounds.flatMap((r, i) => [`${i + 1}. ${r.q.text}`, `   Score: ${r.fb.score}/100 · ${r.fb.verdict}`, ...(r.fb.improvements[0] ? [`   Next time: ${r.fb.improvements[0]}`] : []), ""])];
                downloadText("mock-interview-results.txt", lines.join("\n"));
                toast("Results downloaded");
              }}><DownloadIcon /> Download results</Button>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
