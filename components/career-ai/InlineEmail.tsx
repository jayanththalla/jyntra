"use client";
// Email composer rendered INSIDE a chat turn. It only calls the existing server routes:
//   /api/comms/generate (drafts and saves, cannot send) -> PATCH draft -> /preview (exact message + content hash) -> /send (needs confirm + that hash).
// Nothing here can send without the user ticking the review box and pressing Send; the server re-checks the hash, ownership and sending state.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, MailIcon, RotateCwIcon, SaveIcon, SendIcon, CircleXIcon as XIcon } from "@/components/icons";
import { kbErrorMessage } from "./types";

interface Draft { id: number; kind: string; to_email: string | null; recipient_name: string | null; cc: string[]; subject: string; body: string; status: "draft" | "sending" | "sent" | "failed" | "unknown"; error_code: string | null; from_email: string | null; provider_message_id: string | null }
interface Preview { draft: Draft; from: string | null; via: string | null; content_hash: string; ready: boolean; problems: string[] }
interface Accounts { gmail: { configured: boolean; account: { email: string; status: string } | null }; smtp: { address: string | null; password_set: boolean } }
interface App { id: number; startup_name: string; job_title: string | null }
const STATUS: Record<string, string> = { draft: "Draft", sending: "Sending…", sent: "Sent", failed: "Not sent (failed)", unknown: "Outcome unknown" };
const PROBLEM: Record<string, string> = { recipient_required: "Add a recipient.", subject_required: "Add a subject.", body_required: "Write the message.", invalid_to_email: "That recipient address isn't valid." };

export function InlineEmail({ kind, request, onClose }: { kind: string; request: string; onClose: () => void }) {
  const [cur, setCur] = useState<Draft | null>(null);
  const [acc, setAcc] = useState<Accounts | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [appId, setAppId] = useState("");
  const [busy, setBusy] = useState<"gen" | "save" | "prev" | "send" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checked, setChecked] = useState(false);
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(false);
  const locked = cur?.status === "sent" || cur?.status === "sending";

  const generate = useCallback(async (opts: { application?: string } = {}) => {
    setBusy("gen"); setErr(null); setMissing([]); setPreview(null); setResult(null);
    const aid = opts.application ?? appId;
    const r = await api<any>("/api/comms/generate", { method: "POST", timeoutMs: 70_000, ...jsonBody({ kind, tone: "professional", length: "medium", notes: request.slice(0, 2000), application_id: aid ? Number(aid) : undefined }) });
    setBusy(null);
    if (!r.ok) return setErr(kbErrorMessage(r.status, r.data?.error, r.data?.message ?? r.error));
    setMissing(r.data.missing ?? []);
    if (r.data.draft) { setCur(r.data.draft); setDirty(false); }
  }, [kind, request, appId]);

  useEffect(() => {
    if (started.current) return; // opened by an explicit click; generate once
    started.current = true;
    void generate();
    api<Accounts>("/api/comms/accounts").then((r) => r.ok && setAcc(r.data));
    api<{ applications: App[] }>("/api/applications").then((r) => r.ok && setApps(r.data.applications ?? []));
  }, [generate]);

  const edit = (p: Partial<Draft>) => { setCur((c) => (c ? { ...c, ...p } : c)); setDirty(true); setPreview(null); setChecked(false); setResult(null); };
  async function save(): Promise<Draft | null> {
    if (!cur) return null;
    setBusy("save");
    const r = await api<{ draft: Draft }>(`/api/comms/drafts/${cur.id}`, { method: "PATCH", ...jsonBody({ to_email: cur.to_email ?? "", recipient_name: cur.recipient_name ?? "", cc: cur.cc, subject: cur.subject, body: cur.body }) });
    setBusy(null);
    if (!r.ok) { setErr(PROBLEM[(r.data as any)?.error] ?? r.error); return null; }
    setCur(r.data.draft); setDirty(false); setInfo("Draft saved.");
    return r.data.draft;
  }
  async function review() {
    if (!canSend) return setErr("No sending account is connected. Connect Gmail or add an App Password in Settings, or use Open in Gmail.");
    const d = dirty ? await save() : cur;
    if (!d) return;
    setBusy("prev"); setErr(null);
    const r = await api<Preview>(`/api/comms/drafts/${d.id}/preview`, { method: "POST" });
    setBusy(null);
    if (!r.ok) return setErr(r.error);
    setPreview(r.data); setChecked(false); setAck(false); setResult(null);
  }
  async function send() {
    if (!preview) return;
    setBusy("send"); setResult(null);
    const r = await api<any>(`/api/comms/drafts/${preview.draft.id}/send`, { method: "POST", timeoutMs: 70_000, ...jsonBody({ confirm: true, content_hash: preview.content_hash, acknowledge_unknown: ack || undefined }) });
    setBusy(null);
    const d = r.data ?? {};
    if (d.draft) setCur(d.draft);
    if (r.ok && d.sent) {
      setResult({ ok: true, text: d.duplicate ? "This message had already been sent. It was not sent again." : `Gmail accepted this message${d.provider_message_id ? ` (id ${String(d.provider_message_id).slice(0, 12)}…)` : ""}. That confirms it was handed to Gmail, not that it was delivered or read.` });
      return;
    }
    setResult({ ok: false, text: d.message ?? r.error ?? "The message could not be sent." });
    if (d.error === "content_changed") setPreview(null);
  }
  async function copy() { if (cur) try { await navigator.clipboard.writeText(`Subject: ${cur.subject}\n\n${cur.body}`); setInfo("Copied."); } catch { setErr("Couldn't copy. Select the text and copy it manually."); } }

  const gmailOk = acc?.gmail.account?.status === "connected";
  const canSend = !!acc && (gmailOk || (acc.smtp.address && acc.smtp.password_set));
  return (
    <section aria-label="Email composer" className="mt-3 min-w-0 max-w-full space-y-3 rounded-2xl border border-border/70 bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MailIcon className="size-4 text-accent-brand-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">Email draft</h3>
        {cur && <Badge variant={cur.status === "sent" ? "secondary" : cur.status === "draft" ? "outline" : "destructive"}>{STATUS[cur.status]}</Badge>}
        <span className="ml-auto flex gap-1">
          {cur && <Button size="sm" variant="ghost" className="h-8" asChild><a href={`/career-ai/email?draft=${cur.id}`}><ExternalLinkIcon /> Full editor</a></Button>}
          <Button size="icon-sm" variant="ghost" aria-label="Close composer" onClick={onClose}><XIcon /></Button>
        </span>
      </div>
      <div aria-live="polite">
        {info && <Banner tone="info" onDismiss={() => setInfo(null)}>{info}</Banner>}
        {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
      </div>
      {busy === "gen" && !cur && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2Icon className="size-4 animate-spin" /> Writing a draft from your sources…</p>}
      {missing.length > 0 && <Banner tone="warn"><p className="font-medium">Needed before this can be sent:</p><ul className="list-disc pl-4">{missing.map((m) => <li key={m}>{m}</li>)}</ul></Banner>}
      {!cur && busy !== "gen" && <Button size="sm" variant="outline" className="h-9" onClick={() => generate()}><RotateCwIcon /> Try again</Button>}
      {cur && (
        <>
          {cur.status === "unknown" && <Banner tone="warn">We lost contact with Gmail during the last attempt and can't tell whether this left. Check your Sent folder before sending again.</Banner>}
          {cur.status === "failed" && <Banner tone="error">The last attempt failed and nothing was sent{cur.error_code ? ` (${cur.error_code.replace(/_/g, " ")})` : ""}. You can try again.</Banner>}
          <p className="text-xs text-muted-foreground">{gmailOk ? <>Sending account: <b className="break-all">{acc!.gmail.account!.email}</b></> : canSend ? <>Sending account: <b className="break-all">{acc!.smtp.address}</b> (App Password)</> : acc?.gmail.configured ? <>No sending account yet. <a className="underline" href="/api/comms/gmail/authorize">Connect Gmail</a></> : "Gmail sign-in isn't configured on this server, so you can write and copy this but not send it from here."}</p>
          <label className="block text-xs font-medium text-muted-foreground">Related application
            <select value={appId} disabled={locked || busy === "gen"} onChange={(e) => { setAppId(e.target.value); void generate({ application: e.target.value }); }} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground">
              <option value="">None (re-writes the draft when changed)</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.startup_name}{a.job_title ? ` · ${a.job_title}` : ""}</option>)}
            </select></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-muted-foreground">To<Input type="email" value={cur.to_email ?? ""} disabled={locked} onChange={(e) => edit({ to_email: e.target.value })} maxLength={254} placeholder="recruiter@company.com" className="mt-1 h-10" /></label>
            <label className="block text-xs font-medium text-muted-foreground">Cc (comma separated)<Input value={cur.cc.join(", ")} disabled={locked} onChange={(e) => edit({ cc: e.target.value.split(/[,;\s]+/).filter(Boolean) })} className="mt-1 h-10" /></label>
          </div>
          <label className="block text-xs font-medium text-muted-foreground">Subject<Input value={cur.subject} disabled={locked} onChange={(e) => edit({ subject: e.target.value })} maxLength={200} className="mt-1 h-10" /></label>
          <label className="block text-xs font-medium text-muted-foreground">Body
            <textarea value={cur.body} disabled={locked} onChange={(e) => edit({ body: e.target.value })} rows={10} maxLength={10000} className="mt-1 block max-h-[50dvh] w-full resize-y overflow-y-auto rounded-lg border border-input bg-background p-2 text-sm text-foreground" /></label>
          {!locked && acc && !canSend && (
            <Banner tone="warn" action={<div className="flex flex-wrap gap-2">
              {acc.gmail.configured && <Button size="sm" variant="outline" className="h-8" asChild><a href="/api/comms/gmail/authorize">Connect Gmail</a></Button>}
              <Button size="sm" variant="outline" className="h-8" asChild><a href="/settings">Add App Password</a></Button>
              <Button size="sm" variant="outline" className="h-8" asChild><a target="_blank" rel="noopener noreferrer" href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(cur.to_email ?? "")}&su=${encodeURIComponent(cur.subject)}&body=${encodeURIComponent(cur.body.slice(0, 1800))}`}>Open in Gmail</a></Button>
            </div>}>
              No sending account is connected, so Send can&apos;t work yet. Connect Gmail or add a Gmail App Password in Settings. Or use Open in Gmail to send it yourself.
            </Banner>
          )}
          <div className="flex flex-wrap gap-2">
            {!locked && <Button size="sm" variant="outline" className="h-9" onClick={save} disabled={busy !== null || !dirty}>{busy === "save" ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Save draft</Button>}
            {!locked && <Button size="sm" variant="outline" className="h-9" onClick={() => generate()} disabled={busy !== null}>{busy === "gen" ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />} Regenerate</Button>}
            <Button size="sm" variant="outline" className="h-9" onClick={copy}><CopyIcon /> Copy</Button>
            {!locked && <Button size="sm" className="h-9" onClick={review} disabled={busy !== null || !cur.body.trim()}>{busy === "prev" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Review and send</Button>}
          </div>
          {preview && !result?.ok && (
            <div className="space-y-3 rounded-xl border border-brand-violet/40 bg-background p-3 text-sm" role="region" aria-label="Confirm before sending">
              <p className="font-medium">This is exactly what will be sent. Nothing is sent until you press Send.</p>
              <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">From</dt><dd className="break-all">{preview.from ?? "—"}</dd>
                <dt className="text-muted-foreground">To</dt><dd className="break-all font-medium">{preview.draft.to_email}</dd>
                {preview.draft.cc.length > 0 && <><dt className="text-muted-foreground">Cc</dt><dd className="break-all">{preview.draft.cc.join(", ")}</dd></>}
                <dt className="text-muted-foreground">Subject</dt><dd className="[overflow-wrap:anywhere]">{preview.draft.subject}</dd>
                <dt className="text-muted-foreground">Attachments</dt><dd>None</dd>
              </dl>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border p-3 font-sans text-sm [overflow-wrap:anywhere]">{preview.draft.body}</pre>
              {preview.problems.length > 0 && <Banner tone="error"><ul className="list-disc pl-4">{preview.problems.map((p) => <li key={p}>{PROBLEM[p] ?? p}</li>)}</ul></Banner>}
              {preview.draft.status === "unknown" && <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 size-4" /><span>I checked my Sent folder and understand this could be a duplicate.</span></label>}
              <label className="flex items-start gap-2"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 size-4" /><span>I've checked the recipient <b className="break-all">{preview.draft.to_email}</b> and the message.</span></label>
              {result && !result.ok && <Banner tone="error">{result.text}</Banner>}
              <div className="flex gap-2">
                <Button size="sm" className="h-9" onClick={send} disabled={!checked || busy === "send" || (!preview.ready && !(preview.draft.status === "unknown" && preview.problems.length === 0)) || (preview.draft.status === "unknown" && !ack)}>{busy === "send" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {busy === "send" ? "Sending…" : "Send email"}</Button>
                <Button size="sm" variant="ghost" className="h-9" onClick={() => setPreview(null)} disabled={busy === "send"}>Cancel</Button>
              </div>
            </div>
          )}
          {result?.ok && <Banner tone="info"><CheckIcon className="mr-1 inline size-4" />{result.text}</Banner>}
        </>
      )}
    </section>
  );
}
