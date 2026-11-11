"use client";
import React, { memo, useState } from "react";
import Link from "next/link";
import type { StartupView } from "@/lib/types";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BadgeDollarSignIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MailIcon,
  MapPinIcon,
  SendIcon,
  ShieldCheckIcon,
  ClockIcon,
  StarIcon,
  type IconComponent,
} from "@/components/icons";
import { STATUS_LABEL } from "./JobCard";
import { STAGE_LABELS, type FundingStage } from "@/lib/funding";
import { COUNTRY_SHORT } from "@/lib/country";
import { MATCH_LABEL } from "./MatchScore";
import { StartupAvatar } from "./StartupAvatar";
import { api, jsonBody } from "./api";
import { Badge } from "@/components/ui/badge";
import { companyEvidence } from "@/lib/jobs/evidence";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function Fact({
  icon: Icon,
  children,
  title,
  strong,
}: {
  icon: IconComponent;
  children: React.ReactNode;
  title?: string;
  strong?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground",
        strong && "font-medium text-foreground"
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="truncate">{children}</span>
    </span>
  );
}

const SCORE_TONE = {
  strong: "text-accent-brand-foreground bg-secondary bg-secondary dark:text-accent-brand-foreground",
  potential: "text-warning bg-warning/10 border-warning/40",
  low: "text-muted-foreground bg-muted border-border",
};

const STAGE_TONE: Partial<Record<FundingStage, string>> = {
  pre_seed: "bg-lime-500/10 text-lime-700 ring-lime-500/25 dark:text-lime-300",
  seed: "bg-success/10 text-success ring-emerald-500/25 dark:text-success",
  series_a: "bg-secondary text-accent-brand-foreground ring-blue-500/25 dark:text-accent-brand-foreground",
  series_b_plus: "bg-secondary text-accent-brand-foreground ring-purple-500/25 dark:text-accent-brand-foreground",
  accelerator: "bg-warning/10 text-warning ring-orange-500/25 dark:text-warning",
  debt: "bg-slate-500/10 text-slate-700 ring-slate-500/25 dark:text-slate-300",
};

const KIND_PILL = {
  confirmed: { label: "✓ Confirmed", cls: "bg-success/10 text-success ring-emerald-500/25 dark:text-success" },
  planned: { label: "○ Planned", cls: "bg-warning/10 text-warning ring-amber-500/25 dark:text-warning" },
  rumored: { label: "? Rumored", cls: "bg-warning/10 text-warning ring-orange-500/25 dark:text-warning" },
} as const;

const PILL = "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-semibold ring-1 ring-inset";

function timeAgo(iso?: string | null) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return "today";
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: d > 300 ? "numeric" : undefined });
}

export const StartupCard = memo(function StartupCard({
  s,
  onChanged,
}: {
  s: StartupView;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const relevant = s.jobs.filter(
    (j) => j.match.relevance === "strong" || j.match.relevance === "potential"
  );
  const saved = s.applications.find((a) => a.job_id === null);
  const evidence = companyEvidence(s);
  const recentlyFunded = ["funded_30", "funded_90", "funded_180"].includes(s.funding_status);
  const careers = s.careers_url ?? s.website ?? s.source_url;
  const topJob = relevant[0] ?? s.jobs[0] ?? null;
  const otherJobs = s.jobs.filter((j) => j.id !== topJob?.id);
  const remote = s.location_tags.includes("Remote - India")
    ? "Remote (India)"
    : s.location_tags.includes("Remote")
    ? "Remote"
    : null;
  const meta = [s.industry, s.is_ai && s.ai_category ? s.ai_category : null].filter(Boolean).join(" · ");
  const tag = s.is_fresh
    ? s.show_again
      ? "Kept in New"
      : s.last_change_reason === "New discovery"
      ? "New"
      : "Updated"
    : null;

  const primaryEmail = s.emails?.[0];

  async function act(url: string, init: RequestInit) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const { ok } = await api(url, init);
    setBusy(false);
    if (!ok) setFailed(true);
    else onChanged();
  }

  const save = () =>
    act("/api/applications", {
      method: "POST",
      ...jsonBody({ startup_id: s.id, job_id: null, status: "Saved" }),
    });

  const toggleShowAgain = () =>
    act(`/api/startups/${s.id}`, {
      method: "PATCH",
      ...jsonBody({ show_again: !s.show_again }),
    });

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 1500);
    } catch {}
  };

  return (
    <article className="h-full min-h-0 w-full">
      <Card className="surface-hover rise-in flex h-full min-h-[26.5rem] flex-col gap-0 overflow-hidden rounded-2xl py-0">
        <div className="h-1 w-full shrink-0 bg-brand-gradient opacity-70" aria-hidden />
        <CardHeader className="shrink-0 p-4 pb-2.5 sm:p-5 sm:pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <StartupAvatar name={s.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <h3 className="truncate text-base font-semibold leading-tight tracking-tight">
                    <Link
                      href={`/startups/${s.id}`}
                      className="inline-block py-0.5 transition-colors hover:text-primary hover:underline"
                    >
                      {s.name}
                    </Link>
                  </h3>
                  {s.funding_verification_url && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex text-accent-brand-foreground" aria-label="Independently verified"><ShieldCheckIcon className="size-4" /></span>
                      </TooltipTrigger>
                      <TooltipContent>Independently verified by a second source</TooltipContent>
                    </Tooltip>
                  )}
                  {tag && (
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px] font-medium"
                      title={s.last_change_reason ?? ""}
                    >
                      {tag}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {meta || "Startup"}
                  {s.location ? ` · ${s.location}` : ""}
                </p>
                {(s.funding_stage && s.funding_stage !== "other") || (recentlyFunded && s.funding_kind) || s.categories.length > 0 || (s.funding_conflicts?.length ?? 0) > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {recentlyFunded && s.funding_kind && (
                      <span className={cn(PILL, KIND_PILL[s.funding_kind].cls)}>{KIND_PILL[s.funding_kind].label}</span>
                    )}
                    {s.funding_stage && s.funding_stage !== "other" && (
                      <span className={cn(PILL, STAGE_TONE[s.funding_stage] ?? "bg-muted text-muted-foreground ring-border")}>{STAGE_LABELS[s.funding_stage]}</span>
                    )}
                    {s.categories.slice(0, 2).map((c) => (
                      <span key={c} className={cn(PILL, "bg-secondary text-secondary-foreground ring-border/60 font-medium")}>{c}</span>
                    ))}
                    {(s.funding_conflicts?.length ?? 0) > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn(PILL, "bg-destructive/10 text-destructive ring-red-500/25 dark:text-destructive")}>⚠ Sources disagree</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{s.funding_conflicts.join(" · ")}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                "shrink-0 rounded-lg border px-2 py-1 text-center font-mono",
                relevant.length > 0 ? SCORE_TONE[s.relevance] : SCORE_TONE.low
              )}
              title={relevant.length > 0 ? "Your best match score" : "No matching roles yet"}
            >
              <div className="text-base font-bold leading-none tabular-nums">
                {relevant.length > 0 ? `${s.best_match}%` : "—"}
              </div>
              <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider">
                {relevant.length > 0 ? MATCH_LABEL[s.relevance] : "No match"}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-0 sm:px-5">
          <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
            {s.description || "No company description yet."}
          </p>

          <div className="flex min-h-[2.5rem] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-muted/40 px-3 py-2">
            <Fact icon={BriefcaseBusinessIcon} strong={evidence.signal === "open_roles"} title={evidence.detail}>
              {evidence.label}
            </Fact>
            {remote && <Fact icon={MapPinIcon}>{remote}</Fact>}
            {recentlyFunded && (
              <Fact
                icon={BadgeDollarSignIcon}
                title={s.funding_source ? `Source: ${s.funding_source}` : undefined}
              >
                {s.funding_kind && s.funding_kind !== "confirmed"
                  ? s.funding_kind === "planned"
                    ? "Planning to raise"
                    : "Reported raise (unconfirmed)"
                  : s.last_funding_amount
                  ? `Raised ${s.last_funding_amount}`
                  : "Funded"}
                {s.funding_stage && s.funding_stage !== "other" ? ` (${STAGE_LABELS[s.funding_stage]})` : s.funding_round ? ` (${s.funding_round})` : ""}
                {s.funding_date_approximate ? " ≈" : ""}
                {s.funding_verification_url ? " ✓" : ""}
              </Fact>
            )}
            {s.hq_country && (
              <Fact
                icon={MapPinIcon}
                title={`HQ: ${s.hq_evidence ?? s.hq_country} (${s.hq_confidence ?? "medium"} confidence)`}
              >
                HQ {COUNTRY_SHORT[s.hq_country]}
              </Fact>
            )}
            {s.open_source && <Fact icon={StarIcon} title="Open source per its YC page">Open source</Fact>}
            {s.is_ai === true && <Fact icon={BotIcon}>AI Product</Fact>}
            {s.founded_year && <Fact icon={CalendarIcon}>Est. {s.founded_year}</Fact>}
          </div>

          {s.investors && s.investors.length > 0 && (
            <p className="truncate text-[11px] text-muted-foreground" title={s.investors.join(", ")}>
              <span className="font-semibold text-foreground/70">Investors:</span> {s.investors.slice(0, 2).join(", ")}
              {s.investors.length > 2 ? ` +${s.investors.length - 2} more` : ""}
            </p>
          )}

          <div className="min-h-[5.5rem] rounded-xl border border-border/60 bg-muted/20 p-3">
            {topJob ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Target role
                      </span>
                      {topJob.match.relevance && topJob.match.relevance !== "low" && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "px-1 py-0 text-[9px] font-medium",
                            topJob.match.relevance === "strong"
                              ? "bg-secondary bg-secondary text-accent-brand-foreground"
                              : "border-warning/40 bg-warning/10 text-warning"
                          )}
                        >
                          {topJob.match.relevance === "strong" ? "Strong match" : "Good match"}
                        </Badge>
                      )}
                    </div>
                    <h4 className="mt-0.5 truncate text-xs font-semibold text-foreground">
                      {topJob.job_title}
                    </h4>
                  </div>
                  {topJob.apply_url || topJob.job_url ? (
                    <a
                      href={topJob.apply_url ?? topJob.job_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-6 min-w-6 shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      title="View original posting"
                    >
                      View <ExternalLinkIcon className="size-3" />
                    </a>
                  ) : null}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  {topJob.location && <span className="truncate">{topJob.location}</span>}
                  {topJob.experience_level && <span>· {topJob.experience_level}</span>}
                  {topJob.salary && <span>· {topJob.salary}</span>}
                  {topJob.posted_date && <span>· Posted {timeAgo(topJob.posted_date)}</span>}
                </div>

                {otherJobs.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="mt-1 inline-flex min-h-6 items-center gap-1 text-[11px] font-medium text-accent-brand-foreground hover:underline"
                      >
                        +{otherJobs.length} more open job{otherJobs.length > 1 ? "s" : ""}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-64 w-72">
                      {otherJobs.map((job) => (
                        <DropdownMenuItem
                          key={job.id}
                          onClick={() => {
                            const href = job.apply_url ?? job.job_url;
                            if (href) window.open(href, "_blank", "noopener,noreferrer");
                          }}
                          className="justify-between"
                        >
                          <span className="truncate">{job.job_title}</span>
                          <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            ) : (
              <div className="flex h-full min-h-[4.5rem] flex-col justify-center">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Target role
                </span>
                <p className="mt-1 text-xs text-muted-foreground">No open roles listed yet.</p>
              </div>
            )}
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
            {timeAgo(s.first_discovered_at) && <span className="inline-flex items-center gap-1"><CalendarIcon className="size-3" />Discovered {timeAgo(s.first_discovered_at)}</span>}
            {timeAgo(s.last_verified_at) && <span className="inline-flex items-center gap-1"><ClockIcon className="size-3" />Verified {timeAgo(s.last_verified_at)}</span>}
            {recentlyFunded && timeAgo(s.last_funding_date) && <span className="inline-flex items-center gap-1"><BadgeDollarSignIcon className="size-3" />Funded {timeAgo(s.last_funding_date)}{s.funding_date_approximate ? " ≈" : ""}</span>}
            {s.funding_source && <span className="truncate">via {s.funding_source}</span>}
            {s.funding_reports.length > 1 && <span>{s.funding_reports.length} reports</span>}
          </div>

          <div className="mb-4 flex min-h-[2.25rem] items-center justify-between rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5 text-xs">
            {primaryEmail ? (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <MailIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-[11px]">{primaryEmail.email}</span>
                  <Badge variant="secondary" className="px-1.5 py-0 text-[9px] capitalize">
                    {primaryEmail.type}
                  </Badge>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => copyEmail(primaryEmail.email)}
                      aria-label="Copy email"
                    >
                      {copiedEmail ? <CheckIcon className="size-3 text-accent-brand-foreground" /> : <CopyIcon className="size-3" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copiedEmail ? "Copied" : "Copy email"}</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <MailIcon className="size-3.5 shrink-0" />
                No public email — use Reach out to draft a message
              </div>
            )}
          </div>
        </CardContent>

        <div className="mt-auto shrink-0">
          <Separator />
          <CardFooter className="flex flex-wrap items-center justify-between gap-2 bg-muted/10 p-3 sm:px-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Link
                href={`/outreach/${s.id}${topJob ? `?jobId=${topJob.id}` : ""}`}
                className={buttonVariants({ size: "xs" })}
                title="Open the outreach editor for this startup"
              >
                <SendIcon className="size-3.5" /> Reach out
              </Link>

              {topJob?.apply_url || topJob?.job_url ? (
                <a
                  href={topJob.apply_url ?? topJob.job_url}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline", size: "xs" })}
                >
                  Apply
                  <ExternalLinkIcon className="size-3 text-muted-foreground" />
                </a>
              ) : careers ? (
                <a
                  href={careers}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline", size: "xs" })}
                >
                  Careers
                  <ExternalLinkIcon className="size-3 text-muted-foreground" />
                </a>
              ) : null}

              <Button
                variant="outline"
                size="xs"
                onClick={save}
                disabled={!!saved || busy}
                title={saved ? "Saved in Applications" : "Save startup"}
              >
                {saved ? <BookmarkCheckIcon className="size-3.5 text-accent-brand-foreground" /> : <BookmarkIcon className="size-3.5" />}
                {saved ? (STATUS_LABEL[saved.status] ?? "Saved") : "Save"}
              </Button>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={toggleShowAgain}
                disabled={busy}
                className={cn(!s.show_again && "text-muted-foreground")}
                title={s.show_again ? "Remove from New list" : "Keep in New list"}
                aria-pressed={s.show_again}
              >
                <StarIcon className={cn("size-3.5", s.show_again && "fill-amber-400 text-warning")} />
              </Button>

              <Link href={`/startups/${s.id}`} className={buttonVariants({ variant: "ghost", size: "xs" })}>
                Details <ArrowRightIcon className="size-3" />
              </Link>
            </div>

            {failed && (
              <p role="alert" className="flex w-full items-center gap-1 text-[11px] text-destructive">
                <AlertCircleIcon className="size-3" />
                Action failed. Please try again.
              </p>
            )}
          </CardFooter>
        </div>
      </Card>

    </article>
  );
});
