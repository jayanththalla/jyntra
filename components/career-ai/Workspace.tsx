"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, jsonBody } from "@/components/api";
import { AnswerView } from "./AnswerView";
import { InlineEmail } from "./InlineEmail";
import { Composer } from "./Composer";
import { ExportDialog, turnsToMessages } from "./ExportDialog";
import { SidePanel, type Conv, type Note } from "./SidePanel";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton";
import { FACT_CATEGORIES } from "./FactsPanel";
import { kbErrorMessage, type Answer, type Capabilities, type ChatTurn, type KbSource, type Summary } from "./types";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertCircleIcon, BookmarkIcon, CheckIcon, CopyIcon, DownloadIcon, MailIcon, PencilIcon, PlusIcon, RotateCwIcon, SaveIcon, SlidersHorizontalIcon, SparklesIcon } from "@/components/icons";

const SUGGESTED = [
  ["project_coach", "Project coach", "Explain my strongest project and what interviewers might ask about it."],
  ["jd_analyzer", "Job description", "Here is a job description: [paste it]. What do I match and where are my gaps?"],
  ["coding_progress", "Coding progress", "How is my coding practice going and what should I focus on next?"],
  ["auto", "My applications", "Summarise my applications, emails and answers so far, and what is still waiting on me."],
] as const;
interface App { id: number; startup_name: string; job_title: string | null }

function Thinking() {
  return (
    <div role="status" className="flex items-center gap-1.5 py-2 text-muted-foreground">
      <span className="sr-only">Searching your knowledge base…</span>
      {[0, 150, 300].map((d) => <span key={d} aria-hidden className="size-2 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d}ms` }} />)}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:size-9 [&_svg]:size-4">
      {children}
    </button>
  );
}

export function Workspace() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [sources, setSources] = useState<KbSource[]>([]);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState("auto");
  const [convId, setConvId] = useState<number | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [saveFor, setSaveFor] = useState<ChatTurn | null>(null);
  const [wipe, setWipe] = useState(false);
  const [wipeText, setWipeText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [exportScope, setExportScope] = useState<null | { turns: ChatTurn[]; scope: "conversation" | "response" }>(null);
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [factFor, setFactFor] = useState<ChatTurn | null>(null);
  const [factsKey, setFactsKey] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stick = useRef(true);
  const ctrls = useRef<Map<string, AbortController>>(new Map());

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([api<Summary>("/api/kb/summary"), api<{ sources: KbSource[]; capabilities: Capabilities }>("/api/kb/sources")]);
    if (s.ok && c.ok) { setSum(s.data); setSources(c.data.sources); setCaps(c.data.capabilities); setLoadErr(null); }
    else setLoadErr(kbErrorMessage(s.status || c.status, undefined, s.error ?? c.error));
    setLoaded(true);
    const [cv, nt] = await Promise.all([api<{ conversations: Conv[] }>("/api/kb/conversations"), api<{ notes: Note[] }>("/api/kb/notes")]);
    if (cv.ok) setConvs(cv.data.conversations);
    if (nt.ok) setNotes(nt.data.notes);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const [oauth, setOauth] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const msgs: Record<string, string> = {
      github_failed: "GitHub connection failed. Nothing was connected. Try again.",
      github_state: "The GitHub sign-in expired or did not match. Start again from Add source.",
      github_denied: "GitHub access was not granted, so nothing was connected.",
      no_profile: "Finish your profile first, then connect GitHub.",
    };
    if (q.get("connected") === "github") setOauth({ tone: "info", text: "GitHub connected. Your first sync is running." });
    else if (q.get("error")) setOauth({ tone: "error", text: msgs[q.get("error")!] ?? "The connection could not be completed." });
    if (q.get("connected") || q.get("error")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => { api<{ applications: App[] }>("/api/applications").then((r) => r.ok && setApps(r.data.applications ?? [])); }, []);

  // While something is syncing, poll just the source list every 2s (live document counts); do a full refresh once it settles.
  const busySync = sources.some((s) => s.status === "syncing" || s.status === "pending");
  useEffect(() => {
    if (!busySync) return;
    let stop = false;
    const t = setInterval(async () => {
      const c = await api<{ sources: KbSource[]; capabilities: Capabilities }>("/api/kb/sources");
      if (stop || !c.ok) return;
      setSources(c.data.sources);
      if (!c.data.sources.some((s) => s.status === "syncing" || s.status === "pending")) void refresh();
    }, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [busySync, refresh]);

  // Follow the conversation only if the reader is already near the bottom of THIS panel (or just sent something). The page itself never scrolls.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 260;
    if (stick.current || near) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    stick.current = false;
  }, [turns]);

  async function ask(question: string, m: string, redo?: string) {
    const id = redo ?? `t${Date.now()}`;
    const turn: ChatTurn = { id, question, mode: m, pending: true };
    const ctrl = new AbortController();
    ctrls.current.set(id, ctrl);
    stick.current = true;
    setTurns((p) => (redo ? p.map((t) => (t.id === redo ? turn : t)) : [...p, turn]));
    const r = await api<Answer & { message?: string; error?: string }>("/api/kb/ask", { method: "POST", timeoutMs: 85_000, signal: ctrl.signal, ...jsonBody({ question, mode: m, conversation_id: convId ?? undefined, fresh: redo ? true : undefined }) });
    ctrls.current.delete(id);
    const stopped = ctrl.signal.aborted;
    setTurns((p) => p.map((t) => (t.id === id ? (r.ok && !stopped ? { ...turn, pending: false, result: r.data } : { ...turn, pending: false, error: { status: stopped ? 0 : r.status, message: stopped ? "Stopped. Nothing was saved from this answer." : kbErrorMessage(r.status, r.data?.error, r.data?.message ?? r.error) } }) : t)));
    if (r.ok && !stopped) { if (r.data.conversationId) setConvId(r.data.conversationId); void api<{ conversations: Conv[] }>("/api/kb/conversations").then((x) => x.ok && setConvs(x.data.conversations)); }
  }
  function send() {
    const q = text.trim();
    if (!q) return;
    setText("");
    void ask(q, mode);
  }
  function stop() { ctrls.current.forEach((c) => c.abort()); }
  function newChat() { stop(); setTurns([]); setConvId(null); setDrawer(false); inputRef.current?.focus(); }
  function editQuestion(t: ChatTurn) { setText(t.question); setMode(t.mode); inputRef.current?.focus(); }
  async function openConv(id: number) {
    const r = await api<{ conversation: { id: number; mode: string; messages: { id: number; role: string; content: string; citations: any[]; meta: any }[] } }>(`/api/kb/conversations/${id}`);
    if (!r.ok) return setMsg(r.error);
    const ms = r.data.conversation.messages;
    const out: ChatTurn[] = [];
    ms.forEach((m) => {
      if (m.role === "user") out.push({ id: `m${m.id}`, question: m.content, mode: r.data.conversation.mode });
      else {
        const last = out[out.length - 1];
        const res: Answer = { answer: m.content, questionType: m.meta?.type ?? "", citations: m.citations ?? [], consulted: (m.citations ?? []).length, grounded: !!m.meta?.grounded, insufficient: !!m.meta?.insufficient, flagged: 0, notices: m.meta?.notices ?? [], messageId: m.id };
        if (last && !last.result) last.result = res; else out.push({ id: `m${m.id}`, question: "", mode: r.data.conversation.mode, result: res });
      }
    });
    stick.current = true;
    setTurns(out); setConvId(id); setDrawer(false);
  }
  async function delConv(id: number) {
    const r = await api(`/api/kb/conversations/${id}`, { method: "DELETE" });
    if (!r.ok) return setMsg(r.error);
    if (convId === id) { setConvId(null); setTurns([]); }
    void refresh();
  }
  function searchConvs(q: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const r = await api<{ conversations: Conv[] }>(`/api/kb/conversations${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      if (r.ok) setConvs(r.data.conversations);
    }, 250);
  }
  async function renameConv(id: number, title: string) {
    const r = await api(`/api/kb/conversations/${id}`, { method: "PATCH", ...jsonBody({ title }) });
    if (!r.ok) return setMsg(r.error);
    setConvs((p) => p.map((c) => (c.id === id ? { ...c, title: title.trim() } : c)));
  }
  const [emailFor, setEmailFor] = useState<Record<string, string>>({}); // turn id -> email kind (composer open inside that turn)
  /** Turns the chat answer into an editable email DRAFT and opens the composer. Nothing is sent from here. */
  async function toEmailDraft(t: ChatTurn, kind: string) {
    if (!t.result) return;
    const r = await api<{ draft: { id: number } }>("/api/comms/drafts", { method: "POST", ...jsonBody({ kind: kind || "cold_email", body: t.result.answer.slice(0, 9000) }) });
    if (!r.ok) return setMsg(r.error);
    router.push(`/career-ai/email?draft=${r.data.draft.id}`);
  }
  async function delNote(id: number) {
    const r = await api(`/api/kb/notes/${id}`, { method: "DELETE" });
    if (!r.ok) return setMsg(r.error);
    void refresh();
  }
  async function wipeAll() {
    const r = await api("/api/kb/data", { method: "DELETE", ...jsonBody({ confirm: "delete" }) });
    if (!r.ok) return setMsg(r.error);
    setWipe(false); setWipeText(""); setTurns([]); setConvId(null); void refresh();
  }

  if (!loaded) return <WorkspaceSkeleton />;
  const noSources = sources.filter((s) => s.status !== "disconnected").length === 0;
  const noAi = caps && !caps.ai;
  const busy = turns.some((t) => t.pending);
  const side = (
    <SidePanel sources={sources} caps={caps} sum={sum} convs={convs} notes={notes} activeConv={convId} onChanged={refresh} onOpenConv={openConv} onDelConv={delConv} onDelNote={delNote} onNewChat={newChat} onWipe={() => { setDrawer(false); setWipe(true); }} onSearch={searchConvs} onRename={renameConv} factsKey={factsKey} />
  );

  return (
    <>
      <div className="grid min-h-[360px] flex-1 gap-5 lg:grid-cols-[304px_minmax(0,1fr)] lg:gap-8">
        <aside aria-label="Sources, chats and facts" className="hidden min-h-0 border-r border-border pr-5 lg:block"><div className="h-full overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">{side}</div></aside>

        <section className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-4xl flex-col" aria-label="Atlas workspace">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <Button variant="outline" className="h-10 min-w-0 lg:hidden" onClick={() => setDrawer(true)}><SlidersHorizontalIcon /> <span className="truncate">Sources &amp; history</span></Button>
            <span className="hidden lg:block" />
            <div className="flex items-center gap-1">
              <Button variant="ghost" aria-label="Copy chat" className="h-10" onClick={() => void navigator.clipboard?.writeText(chatToMarkdown(turns)).catch(() => {})} disabled={!turns.some((t) => t.result)}><CopyIcon /><span className="hidden lg:inline">Copy chat</span></Button>
              <Button variant="ghost" aria-label="Export chat" className="h-10" onClick={() => setExportScope({ turns, scope: "conversation" })} disabled={!turns.some((t) => t.result)}><DownloadIcon /><span className="hidden lg:inline">Export</span></Button>
              <Button variant="ghost" aria-label="New chat" className="h-10" onClick={newChat} disabled={turns.length === 0 && !text}><PlusIcon /><span className="hidden lg:inline">New chat</span></Button>
            </div>
          </div>

          <div className="shrink-0 space-y-2 empty:hidden">
            {oauth && <Banner tone={oauth.tone} onDismiss={() => setOauth(null)}>{oauth.text}</Banner>}
            {loadErr && <Banner tone="error" action={<Button size="sm" variant="outline" onClick={refresh}>Retry</Button>}>{loadErr}</Banner>}
            {msg && <Banner tone="error" onDismiss={() => setMsg(null)}>{msg}</Banner>}
            {noAi && <Banner tone="warn">No AI provider key is configured on the server, so answers can&apos;t be generated. Your knowledge base still works for search.</Banner>}
            {sum && sum.unhealthy.length > 0 && <Banner tone="warn">{sum.unhealthy.map((u) => `${u.label} (${u.status})`).join(", ")} needs attention. Answers may miss recent data from it.</Banner>}
          </div>

          <div ref={scrollRef} tabIndex={-1} className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain py-4 pr-1 [scrollbar-gutter:stable]" aria-live="polite" aria-label="Conversation">
            {turns.length === 0 && (
              <div className="mx-auto max-w-2xl pt-4 sm:pt-10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/illustrations/3d/chat.png" alt="" width={320} height={320} className="mb-2 hidden h-24 w-auto sm:block" />
                <p className="eyebrow mb-3">Ask Atlas</p>
                <h2 className="display text-balance text-4xl sm:text-5xl">What would you like to know?</h2>
                <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
                  {noSources ? "Add a source first (GitHub, a resume, your coding profile). Without evidence from you, I won't guess about your experience." : "I answer from your own projects, code and documents, and show the sources for every claim."}
                </p>
                <ol className="mt-8 border-t border-foreground/80">
                  {SUGGESTED.map(([m, title, q], i) => (
                    <li key={q} className="border-b border-border">
                      <button type="button" onClick={() => { setMode(m); setText(q); inputRef.current?.focus(); }}
                        className="group flex w-full items-start gap-4 py-3.5 text-left outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="w-6 pt-0.5 font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                        <span className="min-w-0 flex-1"><span className="eyebrow !text-accent-brand-foreground">{title}</span><span className="mt-0.5 line-clamp-2 block text-sm">{q}</span></span>
                        <span aria-hidden className="pt-1 text-muted-foreground transition-transform group-hover:translate-x-0.5">→</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {turns.map((t) => (
              <div key={t.id} className="rise-in space-y-4">
                {t.question && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-muted px-4 py-2.5 text-[15px] leading-6 [overflow-wrap:anywhere]">{t.question}</div>
                  </div>
                )}
                <div className="min-w-0">
                  {t.pending && <Thinking />}
                  {t.error && (
                    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                      <AlertCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1"><p className="[overflow-wrap:anywhere]">{t.error.message}</p>
                        {t.question && t.error.status !== 503 && <Button size="sm" variant="outline" className="mt-2 h-9" onClick={() => ask(t.question, t.mode, t.id)}><RotateCwIcon /> Retry</Button>}
                      </div>
                    </div>
                  )}
                  {t.result && (
                    <>
                      <AnswerView a={t.result} chat />
                      <div className="-ml-2 mt-2 flex flex-wrap items-center gap-0.5">
                        <CopyBtn text={answerToMarkdown(t)} />
                        <IconBtn label="Export this response" onClick={() => setExportScope({ turns: [t], scope: "response" })}><DownloadIcon /></IconBtn>
                        <IconBtn label="Regenerate" onClick={() => ask(t.question, t.mode, t.id)} disabled={!t.question || busy}><RotateCwIcon /></IconBtn>
                        <IconBtn label="Edit question" onClick={() => editQuestion(t)} disabled={!t.question}><PencilIcon /></IconBtn>
                        <IconBtn label="Save as note" onClick={() => setSaveFor(t)}><SaveIcon /></IconBtn>
                        <IconBtn label="Keep as a fact about me" onClick={() => setFactFor(t)}><BookmarkIcon /></IconBtn>
                      </div>
                      {!(t.result.actions ?? []).some((a) => a.type === "email_draft" || a.type === "send_email") && !emailFor[t.id] && (
                        <div className="mt-2"><Button size="sm" variant="outline" className="h-9" onClick={() => setEmailFor((m) => ({ ...m, [t.id]: /subject:/i.test(t.result!.answer) ? "job_application" : "cold_email" }))}><MailIcon /> Draft as email, then review and send</Button></div>
                      )}
                      {t.result.actions && t.result.actions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2" aria-label="Suggested next steps">
                          {t.result.actions.map((a) => a.type === "email_draft" || a.type === "send_email" ? (
                            <Button key={a.type} size="sm" variant="outline" className="h-9" onClick={() => setEmailFor((m) => ({ ...m, [t.id]: new URLSearchParams((a.href ?? "").split("?")[1] ?? "").get("kind") ?? "cold_email" }))}><MailIcon /> {a.type === "send_email" ? "Edit as draft, then review and send" : a.label}</Button>
                          ) : a.href ? (
                            <Button key={a.type} size="sm" variant="outline" className="h-9" asChild><Link href={a.href}>{a.label}</Link></Button>
                          ) : null)}
                        </div>
                      )}
                      {emailFor[t.id] && <InlineEmail kind={emailFor[t.id]} request={/subject:/i.test(t.result.answer) ? t.result.answer.slice(0, 1800) : (t.question || t.result.answer).slice(0, 1800)} onClose={() => setEmailFor((m) => { const n = { ...m }; delete n[t.id]; return n; })} />}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="shrink-0 bg-background pt-2">
            <Composer value={text} onChange={setText} onSend={send} onStop={stop} busy={busy} mode={mode} onMode={setMode} inputRef={inputRef} />
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Answers come only from your sources and can still be wrong. Check the cited sources.</p>
          </div>
        </section>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-[88vw] max-w-sm overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden">
          <SheetHeader className="p-0"><SheetTitle>Atlas</SheetTitle><SheetDescription>Sources, chats and notes</SheetDescription></SheetHeader>
          {side}
        </SheetContent>
      </Sheet>

      <ExportDialog open={!!exportScope} onClose={() => setExportScope(null)} messages={exportScope ? turnsToMessages(exportScope.turns) : []} scope={exportScope?.scope ?? "conversation"} defaultTitle={exportScope?.scope === "response" ? (exportScope.turns[0]?.question || "Atlas answer").slice(0, 80) : (convs.find((c) => c.id === convId)?.title || "Atlas conversation")} />
      <SaveFact turn={factFor} convId={convId} onClose={() => setFactFor(null)} onSaved={() => { setFactFor(null); setFactsKey((k) => k + 1); setMsg(null); }} />
      <SaveNote turn={saveFor} apps={apps} onClose={() => setSaveFor(null)} onSaved={() => { setSaveFor(null); void refresh(); }} />
      <Dialog open={wipe} onOpenChange={setWipe}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete all your knowledge?</DialogTitle><DialogDescription>This removes every source, document, passage, conversation and note, and the stored credentials. It can&apos;t be undone. Type <b>delete</b> to confirm.</DialogDescription></DialogHeader>
          <Input value={wipeText} onChange={(e) => setWipeText(e.target.value)} aria-label="Type delete to confirm" autoComplete="off" />
          <DialogFooter><Button variant="ghost" onClick={() => setWipe(false)}>Cancel</Button><Button variant="destructive" disabled={wipeText.trim().toLowerCase() !== "delete"} onClick={wipeAll}>Delete everything</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function answerToMarkdown(t: ChatTurn): string {
  const r = t.result;
  if (!r) return "";
  const body = r.answer.replace(/\[((?:S|P)\d+)\]/g, "[$1]");
  const src = (r.citations ?? []).map((c) => `- [${c.id}] ${c.url ? `[${c.title}](${c.url})` : c.title}`).join("\n");
  return `${t.question ? `## ${t.question}\n\n` : ""}${body}${src ? `\n\n**Sources**\n${src}` : ""}\n`;
}
function chatToMarkdown(turns: ChatTurn[]): string {
  return `# Atlas conversation\n\n` + turns.filter((t) => t.result).map(answerToMarkdown).join("\n---\n\n");
}
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <IconBtn label={ok ? "Copied" : "Copy"} onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked */ } }}>{ok ? <CheckIcon /> : <CopyIcon />}</IconBtn>;
}

function SaveNote({ turn, apps, onClose, onSaved }: { turn: ChatTurn | null; apps: App[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [appId, setAppId] = useState("");
  const [kind, setKind] = useState("interview_note");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (turn) { setTitle((turn.question || "Atlas note").slice(0, 80)); setErr(null); } }, [turn]);
  async function save() {
    if (!turn?.result) return;
    setBusy(true);
    const r = await api<any>("/api/kb/notes", { method: "POST", ...jsonBody({ title, content: turn.result.answer, kind, application_id: appId ? Number(appId) : undefined, citations: turn.result.citations }) });
    setBusy(false);
    if (r.ok) onSaved(); else setErr(r.data?.message ?? r.error);
  }
  return (
    <Dialog open={!!turn} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save as note</DialogTitle><DialogDescription>Optionally attach it to one of your applications.</DialogDescription></DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Note title" maxLength={160} />
        <select aria-label="Application" value={appId} onChange={(e) => setAppId(e.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
          <option value="">Not attached to an application</option>
          {apps.map((a) => <option key={a.id} value={a.id}>{a.startup_name}{a.job_title ? ` · ${a.job_title}` : ""}</option>)}
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">
          <option value="interview_note">Interview note</option><option value="prep">Prep</option><option value="job_description">Job description</option><option value="question">Question</option><option value="answer">Answer</option>
        </select>
        {err && <Banner tone="error">{err}</Banner>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !title.trim()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaveFact({ turn, convId, onClose, onSaved }: { turn: ChatTurn | null; convId: number | null; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState("general");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (turn?.result) { setText(turn.result.answer.slice(0, 600)); setCat("general"); setErr(null); } }, [turn]);
  async function save(confirmed: boolean) {
    const r = await api("/api/career/facts", { method: "POST", ...jsonBody({ text, category: cat, from_answer: !confirmed, conversation_id: convId ?? undefined }) });
    if (r.ok) onSaved(); else setErr(r.error);
  }
  return (
    <Dialog open={!!turn} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Keep as a fact about you</DialogTitle><DialogDescription>Edit it to say exactly what is true. Confirmed facts are used in future answers and emails. An AI answer is not proof, so by default it is kept as an unused suggestion until you confirm it.</DialogDescription></DialogHeader>
        <textarea aria-label="Fact text" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={5} className="w-full resize-y rounded-lg border border-input bg-background p-2 text-sm" />
        <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
          {FACT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {err && <Banner tone="error">{err}</Banner>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="outline" disabled={!text.trim()} onClick={() => save(false)}>Keep as suggestion</Button><Button disabled={!text.trim()} onClick={() => save(true)}>I confirm this is true</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
