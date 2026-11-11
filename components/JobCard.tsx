"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ApplicationView, JobView } from "@/lib/types";
import { APPLICATION_STATUSES } from "@/lib/types";
import { AlertCircleIcon, BanknoteIcon, BookmarkIcon, BriefcaseBusinessIcon, CheckIcon, ExternalLinkIcon, GraduationCapIcon, MapPinIcon, SendIcon, type IconComponent } from "@/components/icons";
import { MatchBadge, matchSummary } from "./MatchScore";
import { checkedAgo, fitReasons, jobEvidence, missingInfo } from "@/lib/jobs/evidence";
import { Badge } from "@/components/ui/badge";
import { SelectField } from "./SelectField";
import { StartupAvatar } from "./StartupAvatar";
import { api, jsonBody } from "./api";
import { AskButton } from "./career-ai/AskButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface OutreachStartup {
  id: number;
  name: string;
  website?: string | null;
  linkedin_url?: string | null;
  emails?: any[];
}

/** Friendlier names for the stored statuses. */
export const STATUS_LABEL: Record<string, string> = {
  "Not Applied": "Not applied",
  Saved: "Saved",
  Applied: "Applied",
  Interview: "Interviewing",
  Rejected: "Rejected",
  Offer: "Offer",
  "Not Interested": "Not interested",
  "To Verify": "To verify",
};

const STATUS_OPTIONS = APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }));

/** Status shown as a small pill-shaped select (shadcn Select). Used once a job is being tracked. */
export function StatusPill({ status, onChange, disabled }: { status: string; onChange: (s: string) => void; disabled?: boolean }) {
  const tone =
    status === "Offer"
      ? "border-success/30 bg-success/10 text-success"
      : status === "Rejected" || status === "Not Interested"
        ? "text-muted-foreground"
        : status === "Not Applied"
          ? ""
          : "border-foreground/20 bg-secondary";
  return <SelectField aria-label="Application status" size="sm" value={status} disabled={disabled} onValueChange={onChange} options={STATUS_OPTIONS} className={cn("rounded-full text-xs font-medium", tone)} />;
}

function postStatus(startupId: number, jobId: number | null, status: string) {
  return api("/api/applications", { method: "POST", ...jsonBody({ startup_id: startupId, job_id: jobId, status }) });
}

function Fact({ icon: Icon, children }: { icon: IconComponent; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3.5 text-muted-foreground/70" />
      {children}
    </span>
  );
}

export type FundingInfo = { last_funding_date: string | null; last_funding_amount: string | null; funding_round: string | null };

const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** "9 Oct 2026 ($30M, Series A)" / "Jun 2026 (Y Combinator Spring 2026)" / null when unknown. */
function fundedLabel(f?: FundingInfo) {
  if (!f || (!f.last_funding_date && !f.funding_round)) return null;
  const yc = /Y Combinator/i.test(f.funding_round ?? "");
  // YC dates are approximate (Demo Day month), so show only the month.
  const when = f.last_funding_date ? (yc && !f.last_funding_amount ? new Date(f.last_funding_date + "T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : fmtDate(f.last_funding_date)) : null;
  const what = [f.last_funding_amount, f.funding_round].filter(Boolean).join(", ");
  return when ? `${when}${what ? ` (${what})` : ""}` : what;
}

export const SOURCE_NAMES: Record<string, string> = {
  yc: "Y Combinator",
  remotive: "Remotive",
  himalayas: "Himalayas",
  funding_rss: "funding news",
  company_careers: "company careers page",
  search: "web search",
  startupmaps: "Startup directory",
};

const EVIDENCE_VARIANT = { verified_opening: "success", listed_opening: "secondary", unverified_opening: "warning" } as const;

export function JobCard({
  job,
  application,
  onChanged,
  showCompany,
  showScore = true,
  funding,
  startup,
}: {
  job: JobView;
  application?: ApplicationView;
  onChanged?: () => void;
  showCompany?: string;
  showScore?: boolean;
  /** The startup's latest funding, shown in the job's source line. */
  funding?: FundingInfo;
  /** Full startup (for the outreach draft: name, emails, LinkedIn). */
  startup?: OutreachStartup;
}) {
  const funded = fundedLabel(funding);
  const evidence = jobEvidence(job);
  const fit = fitReasons(job.match);
  const gaps = missingInfo(job);
  const [status, setStatus] = useState(application?.status ?? "Not Applied");
  const [busy, setBusy] = useState(false);
  const [askApplied, setAskApplied] = useState(false);
  const [failed, setFailed] = useState(false);

  // Follow the saved status when the list reloads (e.g. it was changed on another page).
  useEffect(() => setStatus(application?.status ?? "Not Applied"), [application?.status]);

  async function change(next: string) {
    const prev = status;
    setBusy(true);
    setFailed(false);
    setStatus(next); // optimistic
    setAskApplied(false);
    const { ok } = await postStatus(job.startup_id, job.id, next);
    setBusy(false);
    if (!ok) {
      setStatus(prev);
      setFailed(true);
      return;
    }
    onChanged?.();
  }

  const where = job.remote === "yes" ? `Remote${job.remote_scope ? ` (${job.remote_scope})` : ""}` : (job.location ?? "Location not listed");
  const tracked = status !== "Not Applied";
  const listingUrl = job.job_url;
  const applyUrl = job.apply_url && job.apply_url !== job.job_url ? job.apply_url : null;

  return (
    <div className="flex h-full min-h-[12rem] flex-col rounded-xl border bg-card p-4 transition-colors hover:border-brand-violet/50">
      {showCompany && (
        <Link href={`/startups/${job.startup_id}`} className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <StartupAvatar name={showCompany} size="sm" />
          {showCompany}
        </Link>
      )}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <h4 className="min-w-0 flex-1 basis-40 text-[0.95rem] leading-snug font-semibold [overflow-wrap:anywhere]">{job.job_title}</h4>
        <MatchBadge match={job.match} showScore={showScore} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <Fact icon={MapPinIcon}>{where}</Fact>
        {job.employment_type && <Fact icon={BriefcaseBusinessIcon}>{job.employment_type}</Fact>}
        {job.min_experience && <Fact icon={GraduationCapIcon}>{job.min_experience}</Fact>}
        {job.salary && <Fact icon={BanknoteIcon}>{job.salary}</Fact>}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={EVIDENCE_VARIANT[evidence.kind]} title={evidence.detail}>
          {evidence.label}
        </Badge>
        {job.recency.bucket === "new" && <Badge variant="outline">New this week</Badge>}
        {job.recency.bucket === "newly_found" && <Badge variant="outline">Newly found · no posting date</Badge>}
        {job.recency.bucket === "older" && <Badge variant="secondary">Older listing, still listed</Badge>}
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">{job.recency.label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Source:{" "}
        <a className="underline hover:text-foreground" href={job.source_url ?? job.job_url} target="_blank" rel="noopener noreferrer">
          {SOURCE_NAMES[job.source] ?? job.source}
        </a>{" "}
        · Last checked {checkedAgo(job.last_checked_at)}
        {job.recency.recheck_overdue && (
          <span className="ml-1 inline-flex items-center gap-1 text-warning">
            <AlertCircleIcon className="size-3 shrink-0" />
            not re-confirmed recently; it may have been taken down
          </span>
        )}
      </p>
      {funded && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Funding signal (separate from this opening): funded {funded}
        </p>
      )}

      <details className="group mt-2 text-xs">
        <summary className="w-fit cursor-pointer list-none rounded text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          Why this fits, and what is missing
        </summary>
        <div className="mt-1.5 space-y-2 text-muted-foreground">
          {fit.reasons.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Fits you</p>
              <ul className="list-disc pl-4">{fit.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
          {fit.concerns.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Weaker points</p>
              <ul className="list-disc pl-4">{fit.concerns.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
          {gaps.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Not known</p>
              <ul className="list-disc pl-4">{gaps.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
          <p>{evidence.detail} This score shows relevance to your profile, not your chance of being hired.</p>
        </div>
      </details>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <a
          href={applyUrl ?? listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (status === "Not Applied" || status === "Saved") setAskApplied(true);
          }}
          className={buttonVariants({ size: "sm" })}
        >
          {applyUrl ? "Apply" : "Open original listing"}
          <ExternalLinkIcon />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        {applyUrl && (
          <a href={listingUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Original listing
            <ExternalLinkIcon />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        <Link
          href={`/outreach/${job.startup_id}?jobId=${job.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          title="Open the outreach editor for this startup"
        >
          <SendIcon /> Reach out
        </Link>
        <AskButton mode="job_match" jobId={job.id} label="My fit" title={`My fit: ${job.job_title}`} description="Compared against your own projects and documents. Skills with no evidence are flagged, not assumed." />
        {tracked ? (
          <StatusPill status={status} onChange={change} disabled={busy} />
        ) : (
          <Button variant="outline" size="sm" onClick={() => change("Saved")} disabled={busy}>
            <BookmarkIcon /> Save
          </Button>
        )}
      </div>

      {failed && (
        <Alert variant="destructive" className="mt-2.5">
          <AlertCircleIcon />
          <AlertDescription>Couldn&apos;t save that. Please try again.</AlertDescription>
        </Alert>
      )}

      {askApplied && (
        <Alert role="status" className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="mr-auto text-[13px]">Did you apply? Track it so you remember to follow up.</span>
          <Button size="xs" onClick={() => change("Applied")}>
            <CheckIcon /> Yes, mark applied
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setAskApplied(false)}>
            Not yet
          </Button>
        </Alert>
      )}

    </div>
  );
}
