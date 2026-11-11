"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListSkeleton } from "@/components/skeletons";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircleIcon, BookmarkIcon, CheckIcon, ChevronDownIcon, CopyIcon, Loader2Icon, PlusIcon, RotateCwIcon, SparklesIcon, Trash2Icon } from "@/components/icons";
import { FACT_CATEGORIES } from "./FactsPanel";
import { kbErrorMessage, type Citation, type KbSource } from "./types";
import { cn } from "@/lib/utils";

interface Ans { id: number; set_id: number; position: number; question: string; word_limit: number | null; char_limit: number | null; intent: string; answer: string; status: "pending" | "complete" | "needs_input"; missing: { key: string; ask: string }[]; warnings: string[]; citations: Citation[]; edited: boolean }
interface SetFull { id: number; title: string; application_id: number | null; jd_text: string; resume_document_id: number | null; source_ids: number[]; answers: Ans[] }
interface SetRow { id: number; title: string; total: number; complete: number; needs_input: number; updated_at: string }
interface App { id: number; startup_name: string; job_title: string | null }
interface Resume { id: number; title: string }

const wc = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const cc = (s: string) => [...s].length;
const TONES: [string, string][] = [["simpler", "Simpler"], ["more_direct", "More direct"], ["warmer", "Warmer"], ["more_formal", "More formal"]];
const STATUS = { pending: ["Pending", "outline"], complete: ["Complete", "secondary"], needs_input: ["Needs your input", "destructive"] } as const;

export function ApplicationsWorkspace() {
  const [sets, setSets] = useState<SetRow[]>([]);
  const [cur, setCur] = useState<SetFull | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [sources, setSources] = useState<KbSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [raw, setRaw] = useState("");
  const [jd, setJd] = useState("");
  const [title, setTitle] = useState("");
  const [appId, setAppId] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [srcIds, setSrcIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [allProgress, setAllProgress] = useState<string | null>(null);
  const [newQ, setNewQ] = useState("");

  const loadSets = useCallback(async () => { const r = await api<{ sets: SetRow[] }>("/api/career/applications/sets"); if (r.ok) setSets(r.data.sets); }, []);
  useEffect(() => {
    (async () => {
      const [a, rs, so] = await Promise.all([api<{ applications: App[] }>("/api/applications"), api<{ resumes: Resume[] }>("/api/career/applications/resumes"), api<{ sources: KbSource[] }>("/api/kb/sources")]);
      if (a.ok) setApps(a.data.applications ?? []);
      if (rs.ok) setResumes(rs.data.resumes);
      if (so.ok) setSources(so.data.sources.filter((s) => s.status !== "disconnected"));
      await loadSets();
      setLoaded(true);
    })();
  }, [loadSets]);

  const patchAnswer = (a: Ans) => setCur((c) => (c ? { ...c, answers: c.answers.map((x) => (x.id === a.id ? a : x)) } : c));

  async function create() {
    setCreating(true); setErr(null);
    const r = await api<{ set: SetFull }>("/api/career/applications/sets", { method: "POST", ...jsonBody({ raw, jd_text: jd || undefined, title: title || undefined, application_id: appId ? Number(appId) : undefined, resume_document_id: resumeId ? Number(resumeId) : undefined, source_ids: srcIds }) });
    setCreating(false);
    if (!r.ok) return setErr((r.data as any)?.message ?? r.error);
    setCur(r.data.set); setRaw(""); void loadSets();
  }
  async function open(id: number) { const r = await api<{ set: SetFull }>(`/api/career/applications/sets/${id}`); if (r.ok) { setCur(r.data.set); setErr(null); } else setErr(r.error); }
  async function delSet(id: number) { const r = await api(`/api/career/applications/sets/${id}`, { method: "DELETE" }); if (!r.ok) return setErr(r.error); if (cur?.id === id) setCur(null); void loadSets(); }
  async function linkApp(v: string) {
    if (!cur) return;
    const r = await api<{ set: SetFull }>(`/api/career/applications/sets/${cur.id}`, { method: "PATCH", ...jsonBody({ application_id: v ? Number(v) : null }) });
    if (r.ok) { setCur(r.data.set); setInfo(v ? "Saved against that application." : "Unlinked from the application."); } else setErr((r.data as any)?.error ?? r.error);
  }
  async function generate(a: Ans, adjust: string = "generate", tone?: string) {
    setBusy((b) => new Set(b).add(a.id));
    const r = await api<{ answer: Ans; message?: string }>(`/api/career/applications/answers/${a.id}/generate`, { method: "POST", timeoutMs: 70_000, ...jsonBody({ adjust, tone }) });
    setBusy((b) => { const n = new Set(b); n.delete(a.id); return n; });
    if (r.ok) { patchAnswer(r.data.answer); void loadSets(); return true; }
    setErr(kbErrorMessage(r.status, (r.data as any)?.error, (r.data as any)?.message ?? r.error));
    return false;
  }
  async function generateAll() {
    if (!cur) return;
    const todo = cur.answers.filter((a) => !a.answer.trim());
    if (!todo.length) return setInfo("Every question already has an answer. Use Regenerate on a card to redo one.");
    let done = 0, i = 0;
    setAllProgress(`Writing 0 of ${todo.length}…`);
    const worker = async () => { while (i < todo.length) { const a = todo[i++]; await generate(a); done++; setAllProgress(`Writing ${done} of ${todo.length}…`); } };
    await Promise.all([worker(), worker()]); // two at a time: quick, but kind to the AI provider's rate limit
    setAllProgress(null);
  }
  async function addQuestion() {
    if (!cur || !newQ.trim()) return;
    const r = await api<{ answer: Ans }>(`/api/career/applications/sets/${cur.id}/questions`, { method: "POST", ...jsonBody({ question: newQ }) });
    if (!r.ok) return setErr((r.data as any)?.message ?? r.error);
    setCur({ ...cur, answers: [...cur.answers, r.data.answer] }); setNewQ(""); void loadSets();
  }
  async function removeAnswer(a: Ans) {
    const r = await api(`/api/career/applications/answers/${a.id}`, { method: "DELETE" });
    if (r.ok) { setCur((c) => (c ? { ...c, answers: c.answers.filter((x) => x.id !== a.id) } : c)); void loadSets(); } else setErr(r.error);
  }
  const allText = () => cur?.answers.map((a, i) => `${i + 1}. ${a.question}\n\n${a.answer.trim() || "(not answered yet)"}`).join("\n\n---\n\n") ?? "";
  async function copyAll() { try { await navigator.clipboard.writeText(allText()); setInfo("All answers copied."); } catch { setErr("Couldn't copy. Select the text and copy it manually."); } }
  function exportAll() {
    const blob = new Blob([`# ${cur?.title ?? "Application answers"}\n\n${allText().replace(/^(\d+\. )/gm, "## $1")}\n`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `${(cur?.title ?? "answers").replace(/[^\w-]+/g, "-").slice(0, 40)}.md`; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!loaded) return <ListSkeleton rows={4} />;
  const done = cur?.answers.filter((a) => a.status === "complete" && a.answer.trim()).length ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-9rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <section className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-4" aria-label="New set of questions">
          <h2 className="text-sm font-semibold">Paste the questions</h2>
          <label className="block text-xs font-medium text-muted-foreground">Application questions
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={7} maxLength={40000} placeholder={"1. Tell us about yourself (max 150 words)\n2. Why do you want to work here?\n3. Describe a challenging project you built."}
              className="mt-1 block w-full resize-y rounded-lg border border-input bg-background p-2 text-sm text-foreground" />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">Job description (optional)
            <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={4} maxLength={12000} placeholder="Paste it here, or pick a saved job below" className="mt-1 block w-full resize-y rounded-lg border border-input bg-background p-2 text-sm text-foreground" />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">Saved job / application
            <select value={appId} onChange={(e) => setAppId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground">
              <option value="">None</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.startup_name}{a.job_title ? ` · ${a.job_title}` : ""}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-muted-foreground">Resume version
            <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground">
              <option value="">Latest resume</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </label>
          <fieldset className="text-xs">
            <legend className="font-medium text-muted-foreground">Sources to use</legend>
            <p className="mb-1 text-muted-foreground">{srcIds.length ? "Only the ticked sources." : "All your sources (default)."}</p>
            <div className="max-h-28 space-y-1 overflow-y-auto">{sources.map((s) => (
              <label key={s.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={srcIds.includes(s.id)} onChange={(e) => setSrcIds((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} className="size-4" />{s.label}</label>))}</div>
          </fieldset>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Name this set (optional)" aria-label="Set name" className="h-10" />
          {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
          <Button className="h-10 w-full" onClick={create} disabled={creating || !raw.trim()}>{creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} Find the questions</Button>
        </section>

        <section className="space-y-2" aria-label="Saved sets">
          <h2 className="text-sm font-semibold">Saved sets</h2>
          {sets.length === 0 ? <p className="text-sm text-muted-foreground">Nothing saved yet.</p> : (
            <ul className="space-y-1">{sets.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-1 rounded-lg p-1 hover:bg-muted/60", cur?.id === s.id && "bg-muted")}>
                <button className="min-h-10 min-w-0 flex-1 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => open(s.id)}>
                  <span className="block truncate text-sm">{s.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{s.complete}/{s.total} answered{s.needs_input ? ` · ${s.needs_input} need input` : ""}</span>
                </button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete set ${s.title}`} onClick={() => delSet(s.id)}><Trash2Icon /></Button>
              </li>))}</ul>
          )}
        </section>
      </aside>

      <section className="min-w-0 space-y-4" aria-label="Answers">
        {!cur ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand-violet/15 text-accent-brand-foreground"><SparklesIcon className="size-6" /></span>
            <h2 className="text-lg font-semibold">Answers from your real experience</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Paste one question or a whole form. Each question gets its own editable answer in the first person, with the sources shown. When something only you know is missing (salary, notice period), I ask instead of guessing.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-3">
              <div className="min-w-0"><h2 className="truncate text-base font-semibold">{cur.title}</h2><p className="text-xs text-muted-foreground" role="status">{done} of {cur.answers.length} answered{allProgress ? ` · ${allProgress}` : ""}</p></div>
              <div className="flex flex-wrap gap-2">
                <Button className="h-10" onClick={generateAll} disabled={!!allProgress}>{allProgress ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Generate all</Button>
                <Button className="h-10" variant="outline" onClick={copyAll}><CopyIcon /> Copy all</Button>
                <Button className="h-10" variant="outline" onClick={exportAll}>Export .md</Button>
              </div>
              <label className="flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">Save against application
                <select value={cur.application_id ?? ""} onChange={(e) => linkApp(e.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm text-foreground">
                  <option value="">Not linked</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.startup_name}{a.job_title ? ` · ${a.job_title}` : ""}</option>)}
                </select>
              </label>
            </div>
            {info && <Banner tone="info" onDismiss={() => setInfo(null)}>{info}</Banner>}
            {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
            <ol className="space-y-4">{cur.answers.map((a) => <QuestionCard key={a.id} a={a} setApplicationId={cur.application_id} busy={busy.has(a.id)} onGenerate={generate} onChange={patchAnswer} onDelete={() => removeAnswer(a)} onError={setErr} onInfo={setInfo} />)}</ol>
            <div className="flex gap-2"><Input value={newQ} onChange={(e) => setNewQ(e.target.value)} maxLength={2000} placeholder="Add another question" aria-label="Add another question" className="h-10" onKeyDown={(e) => { if (e.key === "Enter") void addQuestion(); }} /><Button className="h-10" variant="outline" onClick={addQuestion} disabled={!newQ.trim()}><PlusIcon /> Add</Button></div>
          </>
        )}
      </section>
    </div>
  );
}

function QuestionCard({ a, setApplicationId, busy, onGenerate, onChange, onDelete, onError, onInfo }: { a: Ans; setApplicationId: number | null; busy: boolean; onGenerate: (a: Ans, adjust?: string, tone?: string) => Promise<boolean | undefined>; onChange: (a: Ans) => void; onDelete: () => void; onError: (m: string) => void; onInfo: (m: string) => void }) {
  const [text, setText] = useState(a.answer);
  const [src, setSrc] = useState(false);
  const [extra, setExtra] = useState("");
  const [saved, setSaved] = useState(false);
  const last = useRef(a.answer);
  useEffect(() => { setText(a.answer); last.current = a.answer; }, [a.answer, a.id]);
  const over = (a.word_limit !== null && wc(text) > a.word_limit) || (a.char_limit !== null && cc(text) > a.char_limit);

  async function commit() {
    if (text === last.current) return;
    const r = await api<{ answer: Ans }>(`/api/career/applications/answers/${a.id}`, { method: "PATCH", ...jsonBody({ answer: text }) });
    if (r.ok) { last.current = text; onChange(r.data.answer); } else onError(r.error ?? "Couldn't save your edit.");
  }
  async function copy() { try { await navigator.clipboard.writeText(text); onInfo("Answer copied."); } catch { onError("Couldn't copy. Select the text and copy it manually."); } }
  async function toNotes() {
    const r = await api("/api/kb/notes", { method: "POST", ...jsonBody({ title: a.question.slice(0, 120), content: text, kind: "answer", application_id: setApplicationId ?? undefined, citations: a.citations }) });
    if (r.ok) { setSaved(true); onInfo("Saved to your notes."); } else onError(r.error ?? "Couldn't save the note.");
  }
  /** The candidate supplies a fact the answer needs: keep it as a CONFIRMED fact (it is theirs), then write the answer. */
  async function supply(m: { key: string }) {
    if (!extra.trim()) return;
    const category = FACT_CATEGORIES.some(([v]) => v === m.key) ? m.key : "general";
    const r = await api("/api/career/facts", { method: "POST", ...jsonBody({ text: extra, category }) });
    if (!r.ok) return onError(r.error ?? "Couldn't save that.");
    setExtra("");
    await onGenerate(a);
  }
  const [label, variant] = STATUS[a.status];
  return (
    <li className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-4" aria-label={`Question ${a.position}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]"><span className="mr-1.5 text-muted-foreground">{a.position}.</span>{a.question}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {a.word_limit && <Badge variant="outline">≤ {a.word_limit} words</Badge>}
          {a.char_limit && <Badge variant="outline">≤ {a.char_limit} chars</Badge>}
          <Badge variant={variant as any}>{label}</Badge>
        </div>
      </div>

      {busy ? <div role="status" className="flex items-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground"><Loader2Icon className="animate-spin" /> Reading your sources and writing…</div> : (
        <>
          {a.missing.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="group" aria-label="Missing information">
              <p className="flex items-center gap-1.5 font-medium"><AlertCircleIcon className="size-4" /> I need something from you</p>
              {a.missing.map((m) => (
                <div key={m.key + m.ask} className="space-y-1.5"><p>{m.ask}</p>
                  {["salary", "notice_period", "work_authorization", "relocation", "detail"].includes(m.key) && (
                    <div className="flex gap-2"><Input value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={1000} aria-label="Your answer to this" placeholder="Type it here. It is saved as a confirmed fact." className="h-10" onKeyDown={(e) => { if (e.key === "Enter") void supply(m); }} /><Button className="h-10" disabled={!extra.trim()} onClick={() => supply(m)}>Save and write</Button></div>)}
                </div>))}
            </div>
          )}
          <label className="block text-xs font-medium text-muted-foreground">Your answer (edit freely)
            <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} rows={Math.min(14, Math.max(5, Math.ceil(text.length / 80)))} placeholder="Generate an answer, or write your own."
              className={cn("mt-1 block w-full resize-y rounded-lg border bg-background p-3 text-[15px] leading-6 text-foreground", over ? "border-destructive" : "border-input")} />
          </label>
          <p className={cn("text-xs", over ? "font-medium text-destructive" : "text-muted-foreground")} role="status">{wc(text)} words · {cc(text)} characters{a.word_limit ? ` (limit ${a.word_limit} words)` : ""}{a.char_limit ? ` (limit ${a.char_limit} chars)` : ""}{over ? " · over the limit" : ""}</p>
        </>
      )}

      {a.warnings.map((w) => <Banner key={w} tone="warn">{w}</Banner>)}

      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-10" onClick={async () => { await commit(); void onGenerate(a, "generate"); }} disabled={busy}>{text.trim() ? <RotateCwIcon /> : <SparklesIcon />} {text.trim() ? "Regenerate" : "Generate"}</Button>
        {text.trim() && <>
          <Button className="h-10" variant="outline" disabled={busy} onClick={async () => { await commit(); void onGenerate(a, "shorten"); }}>Shorten</Button>
          <Button className="h-10" variant="outline" disabled={busy} onClick={async () => { await commit(); void onGenerate(a, "expand"); }}>Expand</Button>
          <select aria-label="Adjust tone" defaultValue="" disabled={busy} onChange={async (e) => { const v = e.target.value; e.target.value = ""; if (v) { await commit(); void onGenerate(a, "tone", v); } }} className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">Adjust tone…</option>{TONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <Button className="h-10" variant="outline" onClick={copy}><CopyIcon /> Copy</Button>
          <Button className="h-10" variant="outline" onClick={toNotes} disabled={saved}>{saved ? <CheckIcon /> : <BookmarkIcon />} {saved ? "Saved" : "Save to notes"}</Button>
        </>}
        <Button className="ml-auto h-10" variant="ghost" aria-label={`Remove question ${a.position}`} onClick={onDelete}><Trash2Icon /></Button>
      </div>

      {a.citations.length > 0 && (
        <div>
          <button type="button" onClick={() => setSrc((v) => !v)} aria-expanded={src} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border/70 px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Evidence ({a.citations.length}) <ChevronDownIcon className={cn("size-3.5 transition-transform", src && "rotate-180")} /></button>
          {src && <ul className="mt-2 grid gap-2 sm:grid-cols-2">{a.citations.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card/60 p-2.5 text-xs"><p className="font-medium">{c.url && /^https?:\/\//.test(c.url) ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{c.title}<span className="sr-only"> (opens in a new tab)</span></a> : c.title}</p><p className="text-muted-foreground">{c.provider} · {c.docType}</p><p className="mt-1 line-clamp-4 whitespace-pre-wrap text-muted-foreground">{c.snippet}</p></li>))}</ul>}
        </div>
      )}
    </li>
  );
}
