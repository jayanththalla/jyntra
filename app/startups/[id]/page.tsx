import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/users";
import { loadStartups } from "@/lib/discovery/read";
import { companyEvidence } from "@/lib/jobs/evidence";
import { FUNDING_LABELS, KIND_LABELS, STAGE_LABELS } from "@/lib/funding";
import { StartupJobs } from "./StartupJobs";
import { StartupOutreachAction } from "./StartupOutreachAction";
import { StartupSaveAction } from "./StartupSaveAction";
import { StartupFit } from "./StartupFit";
import { ProofOfWork } from "./ProofOfWork";
import { ShareButton } from "@/components/kit/ShareButton";
import { query } from "@/lib/database";
import { Badge } from "@/components/ui/badge";
import { Emails } from "@/components/Emails";
import { StartupAvatar } from "@/components/StartupAvatar";
import { ArrowDownIcon, ArrowLeftIcon, BotIcon, BadgeDollarSignIcon, CalendarIcon, ExternalLinkIcon, GlobeIcon, LinkIcon, MapPinIcon, UserRoundIcon, type IconComponent } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const dynamic = "force-dynamic";

function Fact({ icon: Icon, label, value, source }: { icon: IconComponent; label: string; value: React.ReactNode; source?: string | null }) {
  const unknown = value === null || value === undefined || value === "";
  return (
    <div className="flex gap-3 rounded-lg bg-muted/60 p-3.5">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className={`mt-0.5 text-sm break-words [overflow-wrap:anywhere] ${unknown ? "text-muted-foreground/70" : "font-medium"}`}>
          {unknown ? "Not known" : value}
          {source && !unknown && (
            <a href={source} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex min-h-6 items-center text-xs font-normal text-muted-foreground underline hover:text-foreground">
              source
            </a>
          )}
        </dd>
      </div>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: React.ReactNode; href?: string | null }) {
  const unknown = value === null || value === undefined || value === "";
  return (
    // Phones: label above value. Long URLs wrap instead of pushing the page wider than the screen.
    <div className="grid grid-cols-1 gap-0.5 border-b py-2.5 text-sm last:border-b-0 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 break-words [overflow-wrap:anywhere] ${unknown ? "text-muted-foreground/70" : ""}`}>
        {unknown ? (
          "Not known"
        ) : href ? (
          <a className="underline hover:text-muted-foreground" href={href} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export default async function StartupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/onboarding");
  const [s] = await loadStartups(user, { id: Number(id) });
  if (!s) notFound();
  const src = (f: string) => s.field_sources[f]?.url ?? null;
  const evidence = companyEvidence(s);
  const funding = [s.funding_round, s.last_funding_amount, s.last_funding_date].filter(Boolean).join(" · ");
  // Stored funding stories linked to this company (exactly-one-match linking, see lib/news/store). A failure just hides the card.
  const stories = await query<{ id: number; headline: string; url: string; publisher: string; published_at: string | null; funding_amount: string | null; funding_round: string | null }>(
    "SELECT id, headline, url, publisher, published_at, funding_amount, funding_round FROM funding_articles WHERE startup_id = $1 ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 8",
    [s.id]
  ).catch(() => []);
  const fitting = s.jobs.filter((j) => j.match.relevance === "strong" || j.match.relevance === "potential").length;

  return (
    <div className="space-y-6">
      <Link href="/discover?tab=startups" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2.5 text-muted-foreground" })}>
        <ArrowLeftIcon /> Back to Discover
      </Link>

      <Card>
        <CardContent className="space-y-5 sm:px-6">
          <div className="flex items-start gap-4">
            <StartupAvatar name={s.name} size="lg" />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{s.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{[s.industry, s.location].filter(Boolean).join(" · ") || "Category unknown"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Last checked <time dateTime={new Date(s.last_seen_at).toISOString()}>{new Date(s.last_seen_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time>
              </p>
            </div>
          </div>
          <p className="max-w-3xl leading-relaxed text-muted-foreground">{s.description ?? "No description available yet."}</p>

          <div className="flex flex-wrap gap-2">
            {s.careers_url && (
              <a href={s.careers_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
                Careers page <ExternalLinkIcon />
              </a>
            )}
            {s.website && (
              <a href={s.website} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
                <GlobeIcon /> Website
              </a>
            )}
            {s.github_url && (
              <a href={s.github_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
                <LinkIcon /> GitHub
              </a>
            )}
            {s.linkedin_url && (
              <a href={s.linkedin_url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
                <LinkIcon /> LinkedIn
              </a>
            )}
            <StartupOutreachAction startup={s} />
            <ShareButton title={`${s.name} on Jyntra`} />
            <StartupFit startupId={s.id} name={s.name} />
            <StartupSaveAction startupId={s.id} saved={s.applications.find((a) => a.job_id === null) ? { id: s.applications.find((a) => a.job_id === null)!.id, status: s.applications.find((a) => a.job_id === null)!.status } : null} />
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact
              icon={MapPinIcon}
              label="Headquarters"
              value={[s.location, s.hq_country && !(s.location ?? "").includes(s.hq_country) ? s.hq_country : null].filter(Boolean).join(", ") || s.hq_country}
              source={s.hq_source_url ?? src("location")}
            />
            <Fact icon={GlobeIcon} label="Remote jobs" value={s.remote_available === null ? null : s.remote_available ? "Yes, at least one job is remote" : "No, all jobs are on-site"} />
            <Fact icon={CalendarIcon} label="Founded" value={s.founded_year} source={src("founded_year")} />
            <Fact
              icon={BadgeDollarSignIcon}
              label="Last funding"
              value={funding ? `${funding}${s.funding_date_approximate ? " (approx. date)" : ""}` : null}
              source={s.funding_source_url}
            />
            <Fact icon={UserRoundIcon} label="Investors" value={s.investors?.join(", ")} />
            <Fact icon={BotIcon} label="AI product" value={s.is_ai === null ? null : s.is_ai ? `Yes${s.ai_category ? `, ${s.ai_category}` : ""}` : "No"} />
          </dl>
        </CardContent>
      </Card>

      {(s.funding_reports.length > 0 || s.funding_conflicts.length > 0 || s.founders.length > 0 || s.hq_evidence || s.other_locations.length > 0) && (
        <Card>
          <CardHeader className="sm:px-6">
            <CardTitle className="text-xl">Verification</CardTitle>
            <CardDescription>What each source said, so you can check it yourself. Nothing here is guessed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 sm:px-6">
            {s.funding_conflicts.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-semibold">Sources disagree</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {s.funding_conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.hq_evidence && (
              <p className="text-sm">
                <span className="font-medium">Headquarters: </span>
                {s.hq_country} <span className="text-muted-foreground">({s.hq_confidence} confidence) · {s.hq_evidence}</span>
                {s.other_locations.length > 0 && <span className="text-muted-foreground"> · Other offices: {s.other_locations.join(", ")}</span>}
              </p>
            )}
            {s.funding_reports.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">
                  Funding reports{s.funding_stage ? ` · ${STAGE_LABELS[s.funding_stage]}` : ""}
                  {s.funding_kind ? ` · ${KIND_LABELS[s.funding_kind]}` : ""}
                  {s.funding_verification_url && (
                    <>
                      {" · "}
                      <a className="underline" href={s.funding_verification_url} target="_blank" rel="noreferrer">
                        confirmed by a second outlet
                      </a>
                    </>
                  )}
                </p>
                <ul className="divide-y text-sm">
                  {s.funding_reports.map((r, i) => (
                    <li key={`${r.url}-${i}`} className="flex flex-wrap items-center gap-x-2 py-1.5">
                      {r.url ? (
                        <a className="font-medium hover:underline" href={r.url} target="_blank" rel="noreferrer">
                          {r.source}
                        </a>
                      ) : (
                        <span className="font-medium">{r.source}</span>
                      )}
                      <span className="text-muted-foreground">
                        {[r.date, r.amount, r.round, r.kind !== "confirmed" ? KIND_LABELS[r.kind] : null].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s.founders.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">Founders (as listed on YC)</p>
                <ul className="flex flex-wrap gap-2 text-sm">
                  {s.founders.map((f) => (
                    <li key={f.name} className="rounded-md bg-muted/60 px-2.5 py-1">
                      {f.profile_url ? (
                        <a className="underline" href={f.profile_url} target="_blank" rel="noreferrer">
                          {f.name}
                        </a>
                      ) : (
                        f.name
                      )}
                      {f.title ? <span className="text-muted-foreground"> · {f.title}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card aria-labelledby="evidence-title">
        <CardHeader className="sm:px-6">
          <CardTitle id="evidence-title" className="text-xl">What we know about hiring here</CardTitle>
          <CardDescription>Three different things, kept apart: a verified opening, a funding signal, and an unverified lead.</CardDescription>
        </CardHeader>
        <CardContent className="sm:px-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-medium">Job openings</dt>
              <dd className="mt-1 text-muted-foreground">
                {s.jobs.length ? `${evidence.label}${evidence.listed_roles && evidence.verified_roles ? `, ${evidence.listed_roles} listed by third parties` : ""}. Each job below shows its source and when it was last checked.` : "None found in the sources we check."}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Funding signal</dt>
              <dd className="mt-1 text-muted-foreground">
                {funding ? <>{funding}{s.funding_date_approximate ? " (approximate date)" : ""}{s.funding_kind && s.funding_kind !== "confirmed" ? `. ${KIND_LABELS[s.funding_kind]}, not confirmed` : ""}.{" "}
                  {s.funding_source_url ? <a className="underline" href={s.funding_source_url} target="_blank" rel="noopener noreferrer">Source<span className="sr-only"> (opens in a new tab)</span></a> : "No source link stored."}{" "}
                  This shows the company has money. It does not show an open role.</> : "No funding information stored."}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Unverified leads</dt>
              <dd className="mt-1 text-muted-foreground">
                {s.careers_url ? <>A careers page exists: <a className="underline" href={s.careers_url} target="_blank" rel="noopener noreferrer">open it<span className="sr-only"> (opens in a new tab)</span></a>. We did not confirm any role from it.</> : "No careers page is known."}{" "}
                {s.emails.length ? "A public contact email is on record." : "No public email is on record."}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <ProofOfWork name={s.name} description={s.description} website={s.website} roles={[...new Set(s.jobs.map((j) => j.job_title))].slice(0, 3)} />

      <Card>
        <CardHeader className="sm:px-6">
          <CardTitle className="text-xl">Jobs</CardTitle>
          <CardDescription>{s.jobs.length ? `${s.jobs.length} listing${s.jobs.length > 1 ? "s" : ""} found, ${fitting} that fit${fitting === 1 ? "s" : ""} your profile.` : "We didn't find job listings from our sources."}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y sm:px-6">
          <StartupJobs s={s} />
        </CardContent>
      </Card>

      {stories.length > 0 && (
        <Card>
          <CardHeader className="sm:px-6">
            <CardTitle className="text-xl">Funding stories</CardTitle>
            <CardDescription>News articles about this company that we stored, newest first. Amounts and rounds are only what the headline says.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y sm:px-6">
            {stories.map((a) => (
              <div key={a.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                  {a.headline}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{a.publisher}</Badge>
                  <span>{a.published_at ? new Date(a.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "No date given"}</span>
                  {(a.funding_amount || a.funding_round) && <span>· {[a.funding_amount, a.funding_round].filter(Boolean).join(" · ")} (from the headline)</span>}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="sm:px-6">
          <CardTitle className="text-xl">Contact</CardTitle>
          <CardDescription>
            Only addresses published on {s.domain ?? "their website"} itself. We never guess emails. &ldquo;Receives mail&rdquo; means the domain has mail servers; it doesn&apos;t guarantee a particular inbox is read.
          </CardDescription>
        </CardHeader>
        <CardContent className="sm:px-6">
          <Emails emails={s.emails} checked />
        </CardContent>
      </Card>

      <Card>
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-6">
            <span>
              <span className="block font-semibold">How we found this startup</span>
              <span className="block text-sm text-muted-foreground">Sources, dates and how we classified it</span>
            </span>
            <ArrowDownIcon className="size-5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
          <dl className="mt-4 px-4 sm:px-6">
            <Row label="Found via" value={s.sources_seen.join(", ")} href={s.source_url} />
            <Row label="Funding status" value={FUNDING_LABELS[s.funding_status]} />
            <Row label="Funding source" value={s.funding_source} href={s.funding_source_url} />
            <Row label="Careers page" value={s.careers_url} href={s.careers_url} />
            <Row label="AI classification" value={s.is_ai === null ? null : `${s.is_ai ? "AI startup" : "Not an AI startup"} (${s.classification_confidence} confidence)`} />
            <Row label="Why" value={s.classification_reasons.join(" · ")} />
            <Row label="New startup" value={s.is_new_startup === null ? null : s.is_new_startup ? "Yes" : "No"} />
            <Row label="First found" value={new Date(s.first_discovered_at).toLocaleString("en-IN", { timeZone: "UTC", timeZoneName: "short" })} />
            <Row label="Last checked" value={new Date(s.last_seen_at).toLocaleString("en-IN", { timeZone: "UTC", timeZoneName: "short" })} />
            <Row label="Last changed" value={`${new Date(s.last_updated_at).toLocaleString("en-IN", { timeZone: "UTC", timeZoneName: "short" })}${s.last_change_reason ? ` (${s.last_change_reason})` : ""}`} />
          </dl>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}
