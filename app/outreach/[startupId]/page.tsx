"use client";
import { useState, useEffect, use, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowDownIcon, ArrowLeftIcon, CheckIcon, AlertCircleIcon, CircleCheckIcon, CopyIcon,
  ExternalLinkIcon, GithubIcon, GlobeIcon, LinkedinIcon, Loader2Icon, MailIcon,
  MediumIcon, MessageSquareIcon, RocketIcon, RotateCcwIcon, SendIcon, SparklesIcon, WrenchIcon,
} from "@/components/icons";
import type { CandidateProfile, JobView, FoundEmail, StartupView } from "@/lib/types";
import { generateOutreach, type OutreachStyle } from "@/lib/outreach/generator";
import { SelectField } from "@/components/SelectField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { DraftCoach } from "@/components/outreach/DraftCoach";
import { cn } from "@/lib/utils";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { EvidenceHelper } from "@/components/career-ai/EvidenceHelper";

const STYLES: { id: OutreachStyle; label: string; desc: string; icon: typeof RocketIcon }[] = [
  { id: "founder_pitch", label: "Founder pitch", desc: "High ownership, direct", icon: RocketIcon },
  { id: "engineering_application", label: "Engineering application", desc: "Skills & projects", icon: WrenchIcon },
  { id: "linkedin_dm", label: "1-click DM", desc: "Short, for LinkedIn / X", icon: MessageSquareIcon },
  { id: "follow_up", label: "Follow-up", desc: "Polite bump after 5–7 days", icon: RotateCcwIcon },
];

const CUSTOM = "__custom__";

function OutreachContent({ startupId }: { startupId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Query params are untrusted: accept only a known style and a plain positive integer job id.
  const rawStyle = searchParams.get("style");
  const paramStyle = STYLES.find((x) => x.id === rawStyle)?.id ?? null;
  const rawJobId = searchParams.get("jobId");
  const targetJobId = rawJobId && /^[1-9]\d{0,9}$/.test(rawJobId) ? Number(rawJobId) : null;
  const [startup, setStartup] = useState<StartupView | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [style, setStyle] = useState<OutreachStyle>(paramStyle || "founder_pitch");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [customEmail, setCustomEmail] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"email" | "linkedin_dm">("email");
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPass, setGmailPass] = useState(""); // only what the user types; the saved password stays on the server
  const [showGmailConfig, setShowGmailConfig] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false); // email: first click arms, second click sends
  const [composeOpened, setComposeOpened] = useState(false); // the user opened Gmail compose or LinkedIn: we still don't know if they sent
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedDraft, setSavedDraft] = useState<{ id: number; subject: string | null; body: string; created_at: string; channel: string } | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  // Outcome of the last AI attempt, so a failure is never silent.
  const [aiStatus, setAiStatus] = useState<{ kind: "ok" | "error" | "unconfigured"; message: string; retryable?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loadFailure, setLoadFailure] = useState<{ status: number; message: string } | null>(null);

  // Look for a saved draft for this startup (and role), so work isn't lost between visits.
  useEffect(() => {
    let live = true;
    fetch(`/api/comms/drafts?status=open&startup_id=${startupId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.drafts ?? []).filter((m: { status: string }) => m.status !== "sending");
        if (!live || !list.length) return;
        const pick = (targetJobId && list.find((m: { job_id: number | null }) => m.job_id === targetJobId)) || list[0];
        setSavedDraft({ id: pick.id, subject: pick.subject, body: pick.body, created_at: pick.updated_at, channel: pick.kind === "linkedin_dm" ? "linkedin_dm" : "email" });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [startupId, targetJobId]);

  // Editing anything after arming "Send" disarms it: the confirmation always refers to what is on screen.
  useEffect(() => setConfirmSend(false), [subject, body, recipientEmail, channel]);

  // Load startup data
  useEffect(() => {
    async function load() {
      const { ok, data, status, error } = await api(`/api/startups/${startupId}`);
      if (!ok) setLoadFailure({ status, message: error ?? "" });
      if (ok && data.startup) {
        setStartup(data.startup);
        const emails = data.startup.emails ?? [];
        if (emails.length > 0) {
          const pref = emails.find((e: FoundEmail) => e.type === "careers") || emails[0];
          setRecipientEmail(pref.email);
        }
      }
      setLoading(false);
    }
    load();
  }, [startupId]);

  // Load user profile
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.profile) {
          const p = d.user.profile;
          setProfile(p);
          if (p.gmail_user) setGmailUser(p.gmail_user);
          if (!p.gmail_user || !p.gmail_app_password_set) setShowGmailConfig(true);
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoaded(true));
  }, []);

  // Generate template outreach when style/context changes
  useEffect(() => {
    if (!profile || !startup) return;
    const targetJob = targetJobId ? startup.jobs.find((j) => j.id === targetJobId) : null;
    const topJob = targetJob ?? startup.jobs.find(
      (j) => j.match.relevance === "strong" || j.match.relevance === "potential"
    ) ?? startup.jobs[0] ?? null;
    const generated = generateOutreach(
      {
        profile,
        startup,
        job: topJob ? { title: topJob.job_title, skills: topJob.skills } : null,
        recipientName: recipientName.trim() || undefined,
        recipientEmail: recipientEmail.trim() || undefined,
      },
      style
    );
    setSubject(generated.subject);
    setBody(generated.body);
    setChannel(generated.channel === "linkedin_dm" ? "linkedin_dm" : "email");
  }, [profile, style, recipientName, startup]);

  // AI-enhanced generation. The server loads the company and profile facts itself; we send only IDs and the style.
  async function generateWithAI() {
    if (!profile || !startup || aiGenerating) return;
    setAiGenerating(true);
    setAiStatus(null);
    try {
      const targetJob = targetJobId ? startup.jobs.find((j) => j.id === targetJobId) : null;
      const res = await fetch("/api/ai/generate-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startup_id: startup.id,
          ...(targetJob ? { job_id: targetJob.id } : {}),
          style,
          recipient_name: recipientName.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.generated) {
        setSubject(data.subject ?? "");
        setBody(data.body);
        if (style === "linkedin_dm") setChannel("linkedin_dm");
        setAiStatus({ kind: "ok", message: "Draft generated. Read it and edit anything that isn't right before you use it." });
      } else if (data.code === "not_configured") {
        setAiStatus({ kind: "unconfigured", message: data.message });
      } else if (res.status === 401) {
        setAiStatus({ kind: "error", message: "Please finish your profile first, then try again.", retryable: false });
      } else {
        setAiStatus({ kind: "error", message: data.message ?? "Couldn't generate a draft. Edit the template below instead.", retryable: data.retryable !== false });
      }
    } catch {
      setAiStatus({ kind: "error", message: "Couldn't reach the server. Check your connection and try again.", retryable: true });
    }
    setAiGenerating(false);
  }

  // The job this message is about: the validated ?jobId if it belongs to this startup, else the best-matching job.
  const pickJobId = (st: StartupView): number | null =>
    ((targetJobId && st.jobs.find((j) => j.id === targetJobId)) ||
      st.jobs.find((j) => j.match.relevance === "strong" || j.match.relevance === "potential") ||
      st.jobs[0] ||
      null)?.id ?? null;

  const ERRORS: Record<string, string> = {
    invalid_recipient_email: "That recipient email address doesn't look valid.",
    recipient_email_required: "Add a recipient email address first.",
    body_required: "The message is empty.",
    body_too_long: "The message is too long (10,000 characters maximum).",
    subject_too_long: "The subject is too long (200 characters maximum).",
    invalid_subject: "The subject can't contain line breaks.",
    job_not_at_this_startup: "That role doesn't belong to this startup.",
    startup_not_found: "This startup no longer exists.",
    no_profile: "Please finish your profile first.",
  };
  const friendly = (code?: string) => (code && ERRORS[code]) || code || "Something went wrong.";

  async function post(url: string, payload: Record<string, unknown>) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }
  const base = () => ({
    startup_id: startup!.id,
    job_id: pickJobId(startup!),
    recipient_name: recipientName.trim() || undefined,
    subject: subject.trim() || undefined,
    body,
  });

  // ONE draft/send service (/api/comms). Every message is a stored draft first; sending needs the on-screen preview's hash.
  const draftBody = () => ({
    kind: channel === "linkedin_dm" ? "linkedin_dm" : "cold_founder",
    startup_id: startup!.id,
    job_id: pickJobId(startup!),
    to_email: channel === "email" ? recipientEmail.trim() || null : null,
    recipient_name: recipientName.trim() || null,
    subject: subject.trim(),
    body,
  });
  /** Saves what is on screen as the draft (create or update) and returns its id. */
  async function persistDraft(): Promise<{ id: number } | { error: string }> {
    const url = savedDraft ? `/api/comms/drafts/${savedDraft.id}` : "/api/comms/drafts";
    const res = await fetch(url, { method: savedDraft ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftBody()) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.draft) return { error: friendly(data.error) };
    setSavedDraft({ id: data.draft.id, subject: data.draft.subject, body: data.draft.body, created_at: data.draft.updated_at, channel });
    return { id: data.draft.id };
  }

  // Send through the user's connected Gmail (or their own App Password). Arm first, then confirm; the server also requires the
  // hash of exactly the message previewed, so what is sent is what was on screen.
  async function handleSendEmail() {
    if (!startup) return;
    if (!confirmSend) {
      setConfirmSend(true);
      return;
    }
    setConfirmSend(false);
    setSending(true);
    setResult(null);
    if (gmailUser && profile && (gmailPass || gmailUser !== profile.gmail_user)) {
      try {
        await fetch("/api/me", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...profile, gmail_user: gmailUser, gmail_app_password: gmailPass }) });
      } catch {}
    }
    try {
      const saved = await persistDraft();
      if ("error" in saved) return setResult({ ok: false, message: saved.error });
      const pv = await post(`/api/comms/drafts/${saved.id}/preview`, {});
      if (!pv.res.ok || !pv.data.ready) {
        const problem = (pv.data.problems?.[0] as string | undefined) ?? pv.data.error;
        return setResult({ ok: false, message: friendly(problem) });
      }
      const { res, data } = await post(`/api/comms/drafts/${saved.id}/send`, { confirm: true, content_hash: pv.data.content_hash });
      if (!res.ok || !data.ok) {
        setResult({ ok: false, message: data.message || (res.status === 429 ? "Sending is rate limited right now. Nothing was sent." : friendly(data.error)) });
      } else if (data.recorded === false) {
        setResult({ ok: true, message: data.warning ?? "The email was sent, but its status could not be updated. Don't send it again." });
      } else {
        setResult({ ok: true, message: `Gmail accepted your message to ${recipientEmail.trim()} for delivery. It is in Applications. Delivery to their inbox is not confirmed.` });
        setSavedDraft(null);
      }
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server. If this was a send, check your Sent folder before trying again." });
    } finally {
      setSending(false);
    }
  }

  // The user tells us they sent it themselves (Gmail compose window, LinkedIn, …). We can't verify that, and say so.
  async function handleLogManual() {
    if (!startup) return;
    setSending(true);
    setResult(null);
    try {
      const saved = await persistDraft();
      if ("error" in saved) return setResult({ ok: false, message: saved.error });
      const { res, data } = await post(`/api/comms/drafts/${saved.id}/log`, { confirm: true });
      if (!res.ok || !data.ok) setResult({ ok: false, message: data.message || friendly(data.error) });
      else {
        setResult({ ok: true, message: "Logged in Applications as sent by you. Jyntra can't confirm it was delivered." });
        setComposeOpened(false);
        setSavedDraft(null);
      }
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server, so it wasn't logged. Try again." });
    } finally {
      setSending(false);
    }
  }

  async function handleSaveDraft() {
    if (!startup) return;
    setSavingDraft(true);
    setResult(null);
    try {
      const saved = await persistDraft();
      setResult("error" in saved ? { ok: false, message: saved.error } : { ok: true, message: "Draft saved. It has not been sent." });
    } catch {
      setResult({ ok: false, message: "Couldn't save the draft. Check your connection." });
    }
    setSavingDraft(false);
  }

  async function handleDiscardDraft() {
    if (!savedDraft) return;
    const id = savedDraft.id;
    setSavedDraft(null);
    try {
      await fetch(`/api/comms/drafts/${id}`, { method: "DELETE" });
    } catch {}
  }

  function restoreDraft() {
    if (!savedDraft) return;
    setSubject(savedDraft.subject ?? "");
    setBody(savedDraft.body);
    setChannel(savedDraft.channel === "linkedin_dm" ? "linkedin_dm" : "email");
    setResult({ ok: true, message: "Saved draft restored." });
  }

  if (loading || !profileLoaded) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <PageSkeleton variant="form" count={2} />
      </div>
    );
  }

  if (!startup) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.back()} className="gap-2">
          <ArrowLeftIcon /> Back
        </Button>
        {loadFailure?.status === 401 ? (
          <p className="text-muted-foreground">
            You need a profile to use outreach. <Link href="/onboarding" className="text-primary underline">Create one</Link>.
          </p>
        ) : loadFailure && loadFailure.status !== 404 && loadFailure.status !== 400 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">We couldn&apos;t load this startup. {loadFailure.message}</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Try again</Button>
          </div>
        ) : (
          <p className="text-muted-foreground">
            This startup doesn&apos;t exist or is no longer listed. <Link href="/discover?tab=startups" className="text-primary underline">Browse startups</Link>.
          </p>
        )}
      </div>
    );
  }

  const emails = startup.emails ?? [];
  const emailOptions = [...emails.map((e) => ({ value: e.email, label: `${e.email} (${e.type})` })), { value: CUSTOM, label: "Type a different email…" }];
  const gmailReady = !!gmailUser && (!!gmailPass || !!profile?.gmail_app_password_set);
  const topJob = (targetJobId && startup.jobs.find((j) => j.id === targetJobId)) ?? startup.jobs.find((j) => j.match.relevance === "strong" || j.match.relevance === "potential") ?? startup.jobs[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
          <ArrowLeftIcon />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-primary/15 text-primary">
              <SendIcon /> Outreach
            </Badge>
            {topJob && (
              <span className="text-xs text-muted-foreground">
                for <strong className="font-semibold text-foreground">{topJob.job_title}</strong>
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Connect with {startup.name}</h1>
          <p className="text-sm text-muted-foreground">Draft and send your pitch. Edit anything before sending.</p>
        </div>
      </div>

      {!profile && (
        <Banner tone="warn" action={<Link href="/settings" className={buttonVariants({ size: "sm", variant: "outline" })}>Open profile</Link>}>
          Your profile couldn&apos;t be loaded, so the draft can&apos;t be personalised. Add your details in My Profile first.
        </Banner>
      )}
      {rawJobId && !startup.jobs.some((j) => j.id === targetJobId) && (
        <Banner tone="info">The job in this link isn&apos;t listed for {startup.name} (it may have closed), so the draft uses their best-matching open role.</Banner>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main form */}
        <div className="space-y-6">
          {/* Profile links */}
          {profile && (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-2 py-3 text-xs">
                <span className="font-semibold text-muted-foreground">Used in your pitch:</span>
                {profile.github_url ? (
                  <a href={profile.github_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium ring-1 ring-foreground/10 hover:bg-muted/80 transition-colors">
                    <GithubIcon /> GitHub
                  </a>
                ) : (
                  <span className="text-muted-foreground">No GitHub linked</span>
                )}
                {profile.linkedin_url && (
                  <a href={profile.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium ring-1 ring-foreground/10 hover:bg-muted/80 transition-colors">
                    <LinkedinIcon /> LinkedIn
                  </a>
                )}
                {profile.medium_url && (
                  <a href={profile.medium_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium ring-1 ring-foreground/10 hover:bg-muted/80 transition-colors">
                    <MediumIcon /> Writing
                  </a>
                )}
                {profile.portfolio_url && (
                  <a href={profile.portfolio_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium ring-1 ring-foreground/10 hover:bg-muted/80 transition-colors">
                    <GlobeIcon /> Portfolio
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* Style selector */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Outreach style</Label>
            <RadioGroup value={style} onValueChange={(v) => setStyle(v as OutreachStyle)} aria-label="Outreach style" className="grid-cols-1 min-[420px]:grid-cols-2">
              {STYLES.map((s) => (
                <Label
                  key={s.id}
                  htmlFor={`style-${s.id}`}
                  className="items-start gap-2.5 rounded-xl border bg-card p-4 font-normal transition-all hover:bg-muted/50 hover:shadow-sm has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/50 has-data-[state=checked]:shadow-sm"
                >
                  <RadioGroupItem id={`style-${s.id}`} value={s.id} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm leading-tight font-semibold">
                      <s.icon className="size-3.5 shrink-0 text-muted-foreground" /> {s.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{s.desc}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* Recipient */}
          <div className="grid gap-4 sm:grid-cols-2">
            {channel === "email" ? (
              <div className="space-y-2">
                <Label htmlFor="outreach-to">To (email)</Label>
                {emails.length > 0 && (
                  <SelectField
                    id="outreach-to"
                    className="w-full"
                    value={customEmail ? CUSTOM : recipientEmail}
                    onValueChange={(v) => {
                      if (v === CUSTOM) { setCustomEmail(true); setRecipientEmail(""); }
                      else { setCustomEmail(false); setRecipientEmail(v); }
                    }}
                    options={emailOptions}
                    placeholder="Choose an address"
                  />
                )}
                {(emails.length === 0 || customEmail) && (
                  <Input id={emails.length === 0 ? "outreach-to" : undefined} type="email" placeholder="founder@startup.com" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>LinkedIn</Label>
                {startup.linkedin_url ? (
                  <a href={startup.linkedin_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", className: "w-full justify-start" })}>
                    <LinkedinIcon /> Open {startup.name}&apos;s LinkedIn <ExternalLinkIcon className="ml-auto" />
                  </a>
                ) : (
                  <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">No company LinkedIn found.</p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="outreach-name">Recipient name <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="outreach-name" placeholder="e.g. Rahul, Priya, Alex" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outreach-note">Why this startup? <span className="font-normal text-muted-foreground">(optional, makes the AI draft specific)</span></Label>
              <Input id="outreach-note" maxLength={300} placeholder="e.g. I built a similar job finder and want to work on your hiring product" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          {channel === "email" && (
            <div className="space-y-2">
              <Label htmlFor="outreach-subject">Subject</Label>
              <Input id="outreach-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="font-medium" />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="outreach-body">{channel === "email" ? "Email message" : "Direct message"}</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="xs" onClick={generateWithAI} disabled={aiGenerating} className="gap-1.5 text-xs">
                  {aiGenerating ? <Loader2Icon className="size-3 animate-spin" /> : <SparklesIcon className="size-3" />}
                  {aiGenerating ? "Generating…" : "AI Enhance"}
                </Button>
                <span className="text-xs text-muted-foreground">Drafts from your saved profile and this company's recorded details</span>
              </div>
            </div>
            {aiStatus && (
              <div role={aiStatus.kind === "error" ? "alert" : "status"}>
                <Banner
                  tone={aiStatus.kind === "ok" ? "info" : aiStatus.kind === "error" ? "error" : "warn"}
                  action={aiStatus.kind === "error" && aiStatus.retryable ? <Button size="sm" variant="outline" onClick={generateWithAI} disabled={aiGenerating}>Try again</Button> : undefined}
                >
                  {aiStatus.message}
                </Banner>
              </div>
            )}
            <EvidenceHelper startupId={Number(startupId)} onInsert={(t) => setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${t}` : t))} />
            <Textarea id="outreach-body" rows={channel === "email" ? 12 : 6} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-[0.8rem] leading-relaxed" />
            <DraftCoach body={body} company={startup.name} skills={profile?.skills ?? []} short={channel !== "email"} />
          </div>

          {/* Gmail connection */}
          {channel === "email" && (
            <Collapsible open={showGmailConfig} onOpenChange={setShowGmailConfig} className="rounded-xl border bg-muted/30">
              <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
                  <MailIcon className="size-5 text-[#EA4335]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Sending from {gmailUser || "your Gmail"}</span>
                  <span className="block text-xs text-muted-foreground">{gmailReady ? "Connected — lands in your Sent folder" : "Add a Google App Password to send from the app"}</span>
                </span>
                <Badge variant={gmailReady ? "success" : "secondary"}>{gmailReady ? "Connected" : "Needs setup"}</Badge>
                <ArrowDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", showGmailConfig && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 border-t p-4">
                  <p className="text-xs text-muted-foreground">
                    Create one at <em>Google Account → Security → 2-Step Verification → App passwords</em>.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="gmail-user" className="text-xs">Gmail address</Label>
                      <Input id="gmail-user" type="email" value={gmailUser} onChange={(e) => setGmailUser(e.target.value)} placeholder="you@gmail.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="gmail-pass" className="text-xs">16-character app password</Label>
                      <Input id="gmail-pass" type="password" value={gmailPass} onChange={(e) => setGmailPass(e.target.value)} placeholder={profile?.gmail_app_password_set ? "Saved — type to replace" : "abcd efgh ijkl mnop"} autoComplete="off" />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {result && (
            <Alert variant={result.ok ? "success" : "destructive"}>
              {result.ok ? <CircleCheckIcon /> : <AlertCircleIcon />}
              <AlertDescription className="text-foreground">{result.message}</AlertDescription>
            </Alert>
          )}

          {savedDraft && (
            <Banner
              tone="info"
              action={
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={restoreDraft}>Restore</Button>
                  <Button size="sm" variant="ghost" onClick={handleDiscardDraft}>Discard</Button>
                </span>
              }
            >
              You have a saved draft from {new Date(savedDraft.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. It has not been sent.
            </Banner>
          )}

          {/* Actions. Nothing here records a message as sent unless Gmail accepted it or you press "I sent it". */}
          <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setResult({ ok: false, message: "Couldn't copy automatically. Select the message text and copy it manually." }); }
                }}
              >
                {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
                {copied ? "Copied" : "Copy message"}
              </Button>
              <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={savingDraft || !body.trim()}>
                {savingDraft ? <Loader2Icon className="animate-spin" /> : null}
                {savingDraft ? "Saving…" : "Save draft"}
              </Button>
              {channel === "email" && (
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmail.trim())}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setComposeOpened(true)}
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                  title="Opens a Gmail compose window with this draft. Nothing is sent until you press Send there."
                >
                  <MailIcon /> Open in Gmail
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
              {channel !== "email" && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
                    if (startup.linkedin_url) window.open(startup.linkedin_url, "_blank", "noopener,noreferrer");
                    setComposeOpened(true);
                  }}
                  title="Copies the message and opens their LinkedIn page. Nothing is recorded until you say you sent it."
                >
                  <LinkedinIcon /> Copy &amp; open LinkedIn <ExternalLinkIcon />
                </Button>
              )}
            </div>

            {composeOpened && (
              <Banner
                tone="info"
                action={<Button size="sm" onClick={handleLogManual} disabled={sending}>I sent it, log it</Button>}
              >
                Did you send it? Jyntra can&apos;t see that. Only press this once you have, and it will be logged as sent by you.
              </Banner>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
              {channel === "email" && (
                <Button
                  type="button"
                  size="lg"
                  onClick={handleSendEmail}
                  disabled={sending || !recipientEmail.trim() || !body.trim()}
                  className="bg-brand-gradient text-white hover:opacity-90"
                  aria-live="polite"
                >
                  {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                  {sending ? "Sending…" : confirmSend ? `Confirm: send to ${recipientEmail.trim()}` : "Send from my Gmail"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right sidebar: startup info */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">About {startup.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {startup.description && <p className="text-muted-foreground leading-relaxed">{startup.description}</p>}
              {startup.industry && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Industry</span>
                  <Badge variant="secondary">{startup.industry}</Badge>
                </div>
              )}
              {startup.funding_round && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last funding</span>
                  <span className="font-medium">{startup.funding_round}{startup.last_funding_amount ? ` · ${startup.last_funding_amount}` : ""}</span>
                </div>
              )}
              {startup.location && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span>{startup.location}</span>
                </div>
              )}
              {startup.website && (
                <a href={startup.website} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full justify-center")}>
                  Visit website <ExternalLinkIcon />
                </a>
              )}
            </CardContent>
          </Card>

          {topJob && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Target role</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-semibold">{topJob.job_title}</p>
                {topJob.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {topJob.skills.slice(0, 6).map((s) => (
                      <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                )}
                {topJob.job_url && (
                  <a href={topJob.job_url} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full justify-center")}>
                    View job posting <ExternalLinkIcon />
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OutreachPage({ params }: { params: Promise<{ startupId: string }> }) {
  const { startupId } = use(params);
  return (
    <Suspense fallback={<PageSkeleton variant="form" count={2} />}>
      <OutreachContent startupId={startupId} />
    </Suspense>
  );
}
