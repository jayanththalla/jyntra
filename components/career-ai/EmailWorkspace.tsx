"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, MailIcon, SaveIcon, SendIcon, SparklesIcon, Trash2Icon } from "@/components/icons";
import { kbErrorMessage } from "./types";
import { cn } from "@/lib/utils";

interface Draft { id: number; kind: string; to_email: string | null; recipient_name: string | null; cc: string[]; subject: string; body: string; status: "draft" | "sending" | "sent" | "failed" | "unknown"; error_code: string | null; via: string | null; from_email: string | null; provider_message_id: string | null; sent_at: string | null; updated_at: string }
interface Accounts { gmail: { configured: boolean; account: { id: number; email: string; status: string } | null }; smtp: { address: string | null; password_set: boolean; available: boolean } }
interface Preview { draft: Draft; from: string | null; via: string | null; content_hash: string; ready: boolean; problems: string[]; already_sent: boolean }
interface App { id: number; startup_name: string; job_title: string | null }

const KINDS: [string, string][] = [["cold_founder", "Cold email to a founder"], ["cold_recruiter", "Cold email to a recruiter"], ["job_application", "Job application email"], ["cover_letter", "Cover letter"], ["recruiter_reply", "Reply to a recruiter"], ["interview_scheduling", "Interview scheduling reply"], ["thank_you", "Thank-you after an interview"], ["follow_up", "Follow-up"], ["linkedin_dm", "LinkedIn message"], ["cold_email", "Other email"]];
const STATUS_LABEL: Record<string, string> = { draft: "Draft", sending: "Sending…", sent: "Sent", failed: "Not sent (failed)", unknown: "Outcome unknown" };
const PROBLEM: Record<string, string> = { recipient_required: "Add a recipient.", subject_required: "Add a subject.", body_required: "Write the message.", invalid_to_email: "That recipient address isn't valid.", not_connected: "Connect Gmail first.", reconnect_required: "Reconnect your Gmail account.", not_configured: "Email sending isn't configured on this server.", linkedin_cannot_be_sent_here: "LinkedIn messages are copied and sent by you on LinkedIn.", cc_repeats_recipient: "The recipient is also in CC.", invalid_cc: "One of the CC addresses isn't valid." };

export function EmailWorkspace() {
  const sp = useSearchParams();
  const [acc, setAcc] = useState<Accounts | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sent, setSent] = useState<Draft[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [cur, setCur] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // generation inputs
  const [kind, setKind] = useState(sp.get("kind") && KINDS.some(([k]) => k === sp.get("kind")) ? sp.get("kind")! : "cold_recruiter");
  const [tone, setTone] = useState("professional");
  const [length, setLength] = useState("medium");
  const [rName, setRName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [appId, setAppId] = useState("");
  const [thread, setThread] = useState("");
  const [notes, setNotes] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // editing + sending
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checked, setChecked] = useState(false);
  const [ack, setAck] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [a, d, s] = await Promise.all([api<Accounts>("/api/comms/accounts"), api<{ drafts: Draft[] }>("/api/comms/drafts?status=open"), api<{ drafts: Draft[] }>("/api/comms/drafts?status=sent&limit=10")]);
    if (a.ok) setAcc(a.data);
    if (d.ok) setDrafts(d.data.drafts);
    if (s.ok) setSent(s.data.drafts);
  }, []);
  useEffect(() => {
    void refresh();
    api<{ applications: App[] }>("/api/applications").then((r) => r.ok && setApps(r.data.applications ?? []));
    const id = Number(sp.get("draft"));
    if (id) api<{ draft: Draft }>(`/api/comms/drafts/${id}`).then((r) => { if (r.ok) { setCur(r.data.draft); setKind(r.data.draft.kind); } });
    const msgs: Record<string, string> = { gmail_denied: "Google access wasn't granted, so nothing was connected.", gmail_state: "The Google sign-in expired or didn't match. Start again.", gmail_failed: "Connecting Gmail failed. Nothing was connected.", gmail_scope: "Google didn't grant permission to send mail. Connect again and allow sending.", no_profile: "Finish your profile first." };
    if (sp.get("connected") === "gmail") setInfo("Gmail connected. You can now send from the composer after previewing.");
    else if (sp.get("error")) setErr(msgs[sp.get("error")!] ?? "The connection could not be completed.");
    if (sp.get("connected") || sp.get("error")) window.history.replaceState(null, "", window.location.pathname);
  }, [refresh, sp]);

  const edit = (patch: Partial<Draft>) => { setCur((c) => (c ? { ...c, ...patch } : c)); setDirty(true); setResult(null); };
  const locked = cur?.status === "sent" || cur?.status === "sending";

  async function generate() {
    setGenBusy(true); setErr(null); setMissing([]); setWarnings([]);
    const r = await api<any>("/api/comms/generate", { method: "POST", timeoutMs: 70_000, ...jsonBody({ kind, tone, length, recipient_name: rName || undefined, company: company || undefined, role: role || undefined, application_id: appId ? Number(appId) : undefined, thread: thread || undefined, notes: notes || undefined }) });
    setGenBusy(false);
    if (!r.ok) return setErr(kbErrorMessage(r.status, r.data?.error, r.data?.message ?? r.error));
    if (!r.data.draft) return setMissing(r.data.missing ?? []);
    setCur(r.data.draft); setDirty(false); setWarnings(r.data.warnings ?? []); setMissing(r.data.missing ?? []); setResult(null); void refresh();
  }
  async function save(): Promise<Draft | null> {
    if (!cur) return null;
    setSaving(true);
    const r = await api<{ draft: Draft }>(`/api/comms/drafts/${cur.id}`, { method: "PATCH", ...jsonBody({ to_email: cur.to_email ?? "", recipient_name: cur.recipient_name ?? "", cc: cur.cc, subject: cur.subject, body: cur.body, kind: cur.kind }) });
    setSaving(false);
    if (!r.ok) { setErr(friendly((r.data as any)?.error) ?? r.error); return null; }
    setCur(r.data.draft); setDirty(false); setInfo("Draft saved."); void refresh();
    return r.data.draft;
  }
  async function newBlank() {
    const r = await api<{ draft: Draft }>("/api/comms/drafts", { method: "POST", ...jsonBody({ kind }) });
    if (r.ok) { setCur(r.data.draft); setDirty(false); void refresh(); }
  }
  async function del(d: Draft) { const r = await api(`/api/comms/drafts/${d.id}`, { method: "DELETE" }); if (!r.ok) return setErr(r.error); if (cur?.id === d.id) setCur(null); void refresh(); }
  async function openPreview() {
    if (!cur) return;
    const saved = dirty ? await save() : cur;
    if (!saved) return;
    const r = await api<Preview>(`/api/comms/drafts/${saved.id}/preview`, { method: "POST" });
    if (!r.ok) return setErr(r.error);
    setPreview(r.data); setChecked(false); setAck(false); setResult(null);
  }
  async function send() {
    if (!preview) return;
    setSending(true); setResult(null);
    const r = await api<any>(`/api/comms/drafts/${preview.draft.id}/send`, { method: "POST", timeoutMs: 70_000, ...jsonBody({ confirm: true, content_hash: preview.content_hash, acknowledge_unknown: ack || undefined }) });
    setSending(false);
    const d = r.data ?? {};
    if (r.ok && d.sent) { setResult({ ok: true, text: d.duplicate ? "This message had already been sent. It was not sent again." : `Sent. Gmail confirmed it${d.provider_message_id ? ` (message ${String(d.provider_message_id).slice(0, 12)})` : ""}.` }); if (d.draft) setCur(d.draft); void refresh(); return; }
    if (d.draft) { setCur(d.draft); setPreview((p) => (p ? { ...p, draft: d.draft } : p)); }
    setResult({ ok: false, text: d.message ?? r.error ?? "The message could not be sent." });
    if (d.error === "content_changed") setPreview(null);
    void refresh();
  }
  const friendly = (code?: string) => (code ? PROBLEM[code] ?? null : null);
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setInfo("Copied."); } catch { setErr("Couldn't copy. Select the text and copy it manually."); } }
  async function disconnect() {
    if (!acc?.gmail.account) return;
    const r = await api<{ message: string }>(`/api/comms/accounts/${acc.gmail.account.id}`, { method: "DELETE" });
    if (r.ok) setInfo(r.data.message); else setErr(r.error);
    void refresh();
  }

  const isDm = cur?.kind === "linkedin_dm";
  const canSendHere = !!acc && ((acc.gmail.account?.status === "connected") || (acc.smtp.address && acc.smtp.password_set));
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-9rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <section className="space-y-2 rounded-2xl border border-border/70 bg-card/60 p-4" aria-label="Email account">
          <h2 className="text-sm font-semibold">Sending account</h2>
          {!acc ? <p className="text-sm text-muted-foreground" role="status">Checking…</p> : (
            <>
              {acc.gmail.account?.status === "connected" ? (
                <div className="space-y-2 text-sm"><p className="flex items-center gap-1.5"><CheckIcon className="size-4 text-success" /> Gmail connected: <b className="break-all">{acc.gmail.account.email}</b></p><p className="text-xs text-muted-foreground">Permission: send only. Jyntra can't read your inbox.</p><Button variant="outline" size="sm" className="h-9" onClick={disconnect}>Disconnect and revoke</Button></div>
              ) : acc.gmail.account?.status === "revoked" ? (
                <Banner tone="warn" action={<Button size="sm" asChild><a href="/api/comms/gmail/authorize">Reconnect</a></Button>}>Google no longer accepts the saved connection.</Banner>
              ) : acc.gmail.configured ? (
                <Button className="h-10 w-full" asChild><a href="/api/comms/gmail/authorize"><MailIcon /> Connect Gmail</a></Button>
              ) : <p className="text-xs text-muted-foreground">Gmail sign-in isn't configured on this server (needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a credential encryption key).</p>}
              <p className="text-xs text-muted-foreground">{acc.smtp.address && acc.smtp.password_set ? `Fallback: your Gmail App Password for ${acc.smtp.address}.` : "No App Password saved (optional fallback, in Settings)."}</p>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-4" aria-label="Write a draft">
          <h2 className="text-sm font-semibold">Write a draft</h2>
          <label className="block text-xs font-medium text-muted-foreground">What is it?
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-muted-foreground">Tone<select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground">{["professional", "friendly", "direct", "warm"].map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="block text-xs font-medium text-muted-foreground">Length<select value={length} onChange={(e) => setLength(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground">{["short", "medium", "long"].map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <label className="block text-xs font-medium text-muted-foreground">Saved job / application
            <select value={appId} onChange={(e) => setAppId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground"><option value="">None</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.startup_name}{a.job_title ? ` · ${a.job_title}` : ""}</option>)}</select></label>
          {!appId && <div className="grid grid-cols-2 gap-2"><Input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} placeholder="Company" aria-label="Company" className="h-10" /><Input value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} placeholder="Role" aria-label="Role" className="h-10" /></div>}
          <Input value={rName} onChange={(e) => setRName(e.target.value)} maxLength={80} placeholder="Recipient name (optional)" aria-label="Recipient name" className="h-10" />
          <label className="block text-xs font-medium text-muted-foreground">Their message or the thread (optional)
            <textarea value={thread} onChange={(e) => setThread(e.target.value)} rows={3} maxLength={6000} className="mt-1 block w-full resize-y rounded-lg border border-input bg-background p-2 text-sm text-foreground" /></label>
          <label className="block text-xs font-medium text-muted-foreground">Notes: what to mention, your availability
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className="mt-1 block w-full resize-y rounded-lg border border-input bg-background p-2 text-sm text-foreground" /></label>
          {missing.length > 0 && <Banner tone="warn"><ul className="list-disc pl-4">{missing.map((m) => <li key={m}>{m}</li>)}</ul></Banner>}
          <div className="flex gap-2"><Button className="h-10 flex-1" onClick={generate} disabled={genBusy}>{genBusy ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} {genBusy ? "Writing…" : "Write draft"}</Button><Button className="h-10" variant="outline" onClick={newBlank}>Blank</Button></div>
        </section>

        <section className="space-y-2" aria-label="Drafts"><h2 className="text-sm font-semibold">Drafts ({drafts.length})</h2>
          {drafts.length === 0 ? <p className="text-sm text-muted-foreground">No open drafts.</p> : <ul className="space-y-1">{drafts.map((d) => (
            <li key={d.id} className={cn("flex items-center gap-1 rounded-lg p-1 hover:bg-muted/60", cur?.id === d.id && "bg-muted")}>
              <button className="min-h-10 min-w-0 flex-1 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setCur(d); setDirty(false); setResult(null); setKind(d.kind); }}><span className="block truncate text-sm">{d.subject || d.body.slice(0, 40) || "Untitled draft"}</span><span className="block text-[11px] text-muted-foreground">{STATUS_LABEL[d.status]}{d.to_email ? ` · ${d.to_email}` : ""}</span></button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete draft" onClick={() => del(d)}><Trash2Icon /></Button></li>))}</ul>}
        </section>
        <section className="space-y-2" aria-label="Sent"><h2 className="text-sm font-semibold">Sent</h2>
          {sent.length === 0 ? <p className="text-sm text-muted-foreground">Nothing sent from here yet.</p> : <ul className="space-y-1">{sent.map((d) => <li key={d.id}><button className="min-h-10 w-full rounded-md px-2 text-left hover:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setCur(d); setDirty(false); setResult(null); }}><span className="block truncate text-sm">{d.subject}</span><span className="block text-[11px] text-muted-foreground">to {d.to_email} · {d.sent_at ? new Date(d.sent_at).toLocaleString() : ""}</span></button></li>)}</ul>}
        </section>
      </aside>

      <section className="min-w-0 space-y-3" aria-label="Message">
        {info && <Banner tone="info" onDismiss={() => setInfo(null)}>{info}</Banner>}
        {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
        {!cur ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center"><span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-brand-violet/15 text-accent-brand-foreground"><MailIcon className="size-6" /></span><h2 className="text-lg font-semibold">Draft first, send only when you decide</h2><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Writing a draft never sends anything. When you choose Preview, you see the exact message and recipient and confirm before it goes.</p></div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-4">
            <div className="flex flex-wrap items-center gap-2"><Badge variant={cur.status === "sent" ? "secondary" : cur.status === "draft" ? "outline" : "destructive"}>{STATUS_LABEL[cur.status]}</Badge><span className="text-xs text-muted-foreground">{KINDS.find(([k]) => k === cur.kind)?.[1]}</span></div>
            {cur.status === "unknown" && <Banner tone="warn">We lost contact with Gmail during the last attempt and can't tell whether this message left. Check your Sent folder before sending again.</Banner>}
            {cur.status === "failed" && <Banner tone="error">The last attempt failed and nothing was sent{cur.error_code ? ` (${cur.error_code.replace(/_/g, " ")})` : ""}. You can try again.</Banner>}
            {warnings.map((w) => <Banner key={w} tone="warn">{w}</Banner>)}
            {!isDm && <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-muted-foreground">To<Input type="email" value={cur.to_email ?? ""} disabled={locked} onChange={(e) => edit({ to_email: e.target.value })} maxLength={254} autoComplete="off" className="mt-1 h-10" /></label>
                <label className="block text-xs font-medium text-muted-foreground">CC (comma separated)<Input value={cur.cc.join(", ")} disabled={locked} onChange={(e) => edit({ cc: e.target.value.split(/[,;\s]+/).filter(Boolean) })} className="mt-1 h-10" /></label>
              </div>
              <label className="block text-xs font-medium text-muted-foreground">Subject<Input value={cur.subject} disabled={locked} onChange={(e) => edit({ subject: e.target.value })} maxLength={200} className="mt-1 h-10" /></label>
            </>}
            <label className="block text-xs font-medium text-muted-foreground">{isDm ? "Message" : "Body"}
              <textarea value={cur.body} disabled={locked} onChange={(e) => edit({ body: e.target.value })} rows={14} maxLength={10000} className="mt-1 block w-full resize-y rounded-lg border border-input bg-background p-3 text-[15px] leading-6 text-foreground disabled:opacity-70" /></label>
            <p className="text-xs text-muted-foreground" role="status">{cur.body.trim() ? cur.body.trim().split(/\s+/).length : 0} words · {[...cur.body].length} characters{isDm && [...cur.body].length > 300 ? " · long for LinkedIn" : ""}</p>
            <div className="flex flex-wrap gap-2">
              {!locked && <Button className="h-10" variant="outline" onClick={save} disabled={saving || !dirty}>{saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Save draft</Button>}
              <Button className="h-10" variant="outline" onClick={() => copy(isDm ? cur.body : `Subject: ${cur.subject}\n\n${cur.body}`)}><CopyIcon /> Copy</Button>
              {isDm ? <Button className="h-10" variant="outline" asChild><a href="https://www.linkedin.com/messaging/" target="_blank" rel="noopener noreferrer"><ExternalLinkIcon /> Open LinkedIn<span className="sr-only"> (opens in a new tab)</span></a></Button>
                : !locked && <Button className="h-10" onClick={openPreview} disabled={!cur.body.trim() || !canSendHere} title={canSendHere ? undefined : "Connect Gmail first"}><SendIcon /> Preview and send</Button>}
              {!isDm && !canSendHere && !locked && <span className="self-center text-xs text-muted-foreground">Connect Gmail to send.</span>}
            </div>
            {isDm && <p className="text-xs text-muted-foreground">Jyntra doesn't send LinkedIn messages. Copy this and paste it on LinkedIn yourself.</p>}
            {result && cur.status === "sent" && <Banner tone="info">{result.text}</Banner>}
          </div>
        )}
      </section>

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o && !sending) setPreview(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Review before sending</DialogTitle><DialogDescription>This is exactly what will be sent. It is not sent until you press Send.</DialogDescription></DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">From</dt><dd className="break-all">{preview.from ?? "—"}</dd>
                <dt className="text-muted-foreground">To</dt><dd className="break-all font-medium">{preview.draft.to_email}</dd>
                {preview.draft.cc.length > 0 && <><dt className="text-muted-foreground">CC</dt><dd className="break-all">{preview.draft.cc.join(", ")}</dd></>}
                <dt className="text-muted-foreground">Subject</dt><dd className="[overflow-wrap:anywhere]">{preview.draft.subject}</dd>
              </dl>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 font-sans text-sm [overflow-wrap:anywhere]">{preview.draft.body}</pre>
              {preview.problems.length > 0 && <Banner tone="error"><ul className="list-disc pl-4">{preview.problems.map((p) => <li key={p}>{PROBLEM[p] ?? p}</li>)}</ul></Banner>}
              {preview.draft.status === "unknown" && <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 size-4" /> <span>I checked my Sent folder and understand this may create a duplicate.</span></label>}
              <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 size-4" /> <span>I've checked the recipient <b className="break-all">{preview.draft.to_email}</b> and the message above.</span></label>
              {result && !result.ok && <Banner tone="error">{result.text}</Banner>}
              {result?.ok && <Banner tone="info">{result.text}</Banner>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={sending}>{result?.ok ? "Close" : "Cancel"}</Button>
            {!result?.ok && <Button onClick={send} disabled={!preview || !preview.ready && !(preview.draft.status === "unknown" && preview.problems.length === 0) || !checked || sending || (preview.draft.status === "unknown" && !ack)}>{sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {sending ? "Sending…" : result ? "Try again" : "Send"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
