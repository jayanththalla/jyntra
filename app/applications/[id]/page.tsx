"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, jsonBody } from "@/components/api";
import { StatusPill } from "@/components/JobCard";
import { Banner } from "@/components/Banner";
import { StartupAvatar } from "@/components/StartupAvatar";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  ArrowLeftIcon,
  CalendarIcon,
  ExternalLinkIcon,
  MailIcon,
  MessageSquareIcon,
  RotateCwIcon,
  Trash2Icon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Outreach {
  id: number;
  channel: string;
  subject: string | null;
  body: string;
  at: string;
  recipient_email?: string | null;
  state: "sent" | "logged_by_you" | "draft" | "failed" | "unknown";
}

interface ApplicationDetail {
  id: number;
  startup_id: number | null;
  startup_name: string;
  website: string | null;
  linkedin_url: string | null;
  job_id: number | null;
  job_title: string | null;
  job_url: string | null;
  careers_url: string | null;
  status: string;
  applied_at: string | null;
  application_url: string | null;
  notes: string | null;
  outreach: Outreach[];
  answer_sets: number;
  reminders: { id: number; title: string; due_at: string }[];
  outcome: string | null;
  outcome_note: string | null;
}

const STATE_LABEL: Record<Outreach["state"], string> = {
  sent: "Sent",
  logged_by_you: "Logged by you",
  draft: "Draft",
  failed: "Failed",
  unknown: "Unknown",
};

/* ------------------------------------------------------------------ */
/*  Auto-save notes                                                    */
/* ------------------------------------------------------------------ */

function NotesEditor({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "failed">("idle");

  useEffect(() => setText(value), [value]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="notes" className="justify-between text-xs text-muted-foreground">
        Notes
        {state !== "idle" && (
          <span className={cn("font-normal", state === "failed" && "text-destructive")}>
            {state === "saving" ? "Saving…" : state === "failed" ? "Save failed — click outside to retry" : "Unsaved"}
          </span>
        )}
      </Label>
      <Textarea
        id="notes"
        rows={4}
        value={text}
        onChange={(e) => { setText(e.target.value); setState("dirty"); }}
        onBlur={async () => {
          if (state !== "dirty" && state !== "failed") return;
          setState("saving");
          setState((await onSave(text)) ? "idle" : "failed");
        }}
        placeholder="Add private notes about this application…"
        className="resize-y"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail view                                                        */
/* ------------------------------------------------------------------ */

function ApplicationDetailView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [viewMessage, setViewMessage] = useState<Outreach | null>(null);

  const load = useCallback(async () => {
    const { ok, status, data, error } = await api(`/api/applications/${id}`);
    if (status === 401) return router.replace("/onboarding");
    if (status === 404) return router.replace("/applications");
    if (!ok) return setError(error);
    setError(null);
    setApp(data.application);
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  async function patch(p: Record<string, unknown>): Promise<boolean> {
    const { ok, error } = await api(`/api/applications/${id}`, { method: "PATCH", ...jsonBody(p) });
    if (!ok) { setError(error); return false; }
    load();
    return true;
  }

  async function remove() {
    setRemoving(false);
    const { ok, error } = await api(`/api/applications/${id}`, { method: "DELETE" });
    if (!ok) return setError(error);
    router.replace("/applications");
  }

  if (!app && !error) return <PageSkeleton variant="list" count={3} />;

  const link = app?.application_url ?? app?.job_url ?? app?.careers_url;
  const appliedDays = app?.applied_at
    ? Math.floor((Date.now() - new Date(app.applied_at).getTime()) / 86_400_000)
    : null;

  return (
    <div className="space-y-6">
      {error && (
        <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>} onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {app && (
        <>
          {/* ── Back + header ── */}
          <div className="space-y-4">
            <Link href="/applications" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeftIcon className="size-4" /> Back to board
            </Link>

            <div className="flex flex-wrap items-start gap-4">
              <StartupAvatar name={app.startup_name} size="lg" />
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  {app.startup_id ? (
                    <Link href={`/startups/${app.startup_id}`} className="hover:underline">{app.startup_name}</Link>
                  ) : app.startup_name}
                </h1>
                {app.job_title && <p className="mt-0.5 text-sm text-muted-foreground">{app.job_title}</p>}
              </div>
              <StatusPill status={app.status} onChange={(s) => patch({ status: s })} />
            </div>
          </div>

          <Separator />

          {/* ── Main content: 2-col on desktop ── */}
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Left column — details */}
            <div className="space-y-6">
              {/* Quick facts */}
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold">Details</h2>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Applied date */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Label htmlFor="applied-date" className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarIcon className="size-4" /> Applied on
                    </Label>
                    <Input
                      id="applied-date"
                      type="date"
                      value={app.applied_at?.slice(0, 10) ?? ""}
                      onChange={(e) => patch({ applied_at: e.target.value || null })}
                      className="h-8 w-auto text-sm"
                    />
                    {appliedDays !== null && appliedDays >= 7 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        {appliedDays} days ago
                      </span>
                    )}
                  </div>

                  {/* Links */}
                  <div className="flex flex-wrap gap-3">
                    {link && (
                      <a href={link} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                        <ExternalLinkIcon className="size-3.5" /> Open posting
                      </a>
                    )}
                    {app.startup_id && (
                      <Link
                        href={`/outreach/${app.startup_id}?style=follow_up${app.job_id ? `&jobId=${app.job_id}` : ""}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        <RotateCwIcon className="size-3.5" /> Follow up
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              <Card>
                <CardContent className="pt-6">
                  <NotesEditor value={app.notes ?? ""} onSave={async (v) => patch({ notes: v })} />
                </CardContent>
              </Card>

              {/* Outreach history */}
              {app.outreach.length > 0 && (
                <Card>
                  <CardHeader>
                    <h2 className="text-sm font-semibold">Outreach history</h2>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {app.outreach.map((m) => (
                        <li key={`${m.channel}-${m.id}-${m.at}`} className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant={m.state === "sent" || m.state === "logged_by_you" ? "secondary" : "outline"}>
                            {m.channel === "linkedin_dm" ? <MessageSquareIcon className="size-3" /> : <MailIcon className="size-3" />}
                            {STATE_LABEL[m.state]}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(m.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          {m.subject && <span className="truncate text-xs text-muted-foreground">— {m.subject}</span>}
                          <Button variant="link" size="sm" className="ml-auto h-auto px-1 py-0 text-xs" onClick={() => setViewMessage(m)}>
                            View
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right column — sidebar info */}
            <div className="space-y-4">
              {/* Reminders */}
              {app.reminders.length > 0 && (
                <Card>
                  <CardHeader><h2 className="text-sm font-semibold">Reminders</h2></CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {app.reminders.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 text-sm">
                          <CalendarIcon className="size-3.5 text-muted-foreground" />
                          <span className="flex-1 truncate">{r.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(r.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Quick links */}
              <Card>
                <CardHeader><h2 className="text-sm font-semibold">Links</h2></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {app.website && (
                    <a href={app.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                      <ExternalLinkIcon className="size-3.5" /> Company website
                    </a>
                  )}
                  {app.linkedin_url && (
                    <a href={app.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                      <ExternalLinkIcon className="size-3.5" /> LinkedIn
                    </a>
                  )}
                  {app.startup_id && (
                    <Link href={`/startups/${app.startup_id}`} className="flex items-center gap-2 text-primary hover:underline">
                      <ExternalLinkIcon className="size-3.5" /> View on Jyntra
                    </Link>
                  )}
                </CardContent>
              </Card>

              {/* Danger zone */}
              <Card className="border-destructive/20">
                <CardContent className="pt-6">
                  <Button variant="outline" size="sm" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setRemoving(true)}>
                    <Trash2Icon className="size-3.5" /> Remove application
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── View message dialog ── */}
          <Dialog open={!!viewMessage} onOpenChange={(o) => !o && setViewMessage(null)}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{viewMessage ? STATE_LABEL[viewMessage.state] : "Message"}</DialogTitle>
                <DialogDescription>The message as stored.</DialogDescription>
              </DialogHeader>
              {viewMessage && (
                <div className="space-y-3 text-sm">
                  {viewMessage.recipient_email && (
                    <p className="text-muted-foreground">To: <strong className="font-semibold text-foreground">{viewMessage.recipient_email}</strong></p>
                  )}
                  {viewMessage.subject && (
                    <p className="text-muted-foreground">Subject: <strong className="font-semibold text-foreground">{viewMessage.subject}</strong></p>
                  )}
                  <div className="scroll-thin max-h-72 overflow-y-auto rounded-lg border bg-muted/40 p-3.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                    {viewMessage.body}
                  </div>
                </div>
              )}
              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>

          {/* ── Confirm remove dialog ── */}
          <Dialog open={removing} onOpenChange={(o) => !o && setRemoving(false)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove from your list?</DialogTitle>
                <DialogDescription>
                  {app.job_title ?? app.startup_name} will be taken off your board. Messages you already sent aren&apos;t unsent.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton>
                <Button variant="destructive" onClick={remove}><Trash2Icon /> Remove</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ApplicationDetailPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="list" count={3} />}>
      <ApplicationDetailView />
    </Suspense>
  );
}
