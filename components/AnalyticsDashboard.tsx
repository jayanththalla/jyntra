"use client";
// Dashboard: the hiring picture (from scraped company listings) next to what is relevant to THIS user.
// Market numbers are counts of rows in data/blrarena-jobs.json; personal numbers come from the database. Nothing is estimated.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { Banner } from "./Banner";
import { DataFreshness } from "./DataFreshness";
import { JobCard } from "./JobCard";
import { PageHeader } from "./PageHeader";
import { PageSkeleton } from "./PageSkeleton";
import { EmptyState } from "./EmptyState";
import { StartupAvatar } from "./StartupAvatar";
import { useLive } from "./live";
import { ArrowRightIcon, BriefcaseBusinessIcon } from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ageLabel, fmtDate, type ArenaJob } from "@/lib/arena/shared";
import type { ArenaOverview } from "@/lib/arena";
import type { DashboardMetrics, NextAction, RecommendedJob } from "@/lib/dashboard";

interface Data { picks: RecommendedJob[]; metrics: DashboardMetrics; actions: NextAction[]; last_discovery_at: string | null; name: string | null }

const MODE_COLOR: Record<string, string> = { hybrid: "bg-chart-3", onsite: "bg-chart-2", remote: "bg-chart-4", unknown: "bg-muted-foreground/30" };
const nf = (n: number) => n.toLocaleString("en-IN");

function Panel({ title, note, className, children }: { title: string; note?: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={cn("gap-4 px-4 sm:px-5", className)}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </Card>
  );
}

/** Horizontal bars scaled to the largest value in the list. */
function Bars({ rows, tone = "bg-primary" }: { rows: { label: string; value: number; href?: string; hint?: string }[]; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const label = r.href ? <Link href={r.href} className="truncate hover:text-primary hover:underline">{r.label}</Link> : <span className="truncate">{r.label}</span>;
        return (
          <li key={r.label} className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,13rem)_1fr_3rem]">
            {label}
            <div className="h-2 rounded-full bg-muted" role="img" aria-label={`${r.label}: ${r.value}`}>
              <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
            </div>
            <span className="text-right tabular-nums text-muted-foreground">{nf(r.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function JobList({ rows, today, empty }: { rows: { slug: string; company: string; job: ArenaJob }[]; today: string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="-mx-2 divide-y divide-border/60">
      {rows.map(({ slug, company, job }) => (
        <li key={job.id}>
          <Link href={`/companies/${slug}`} className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{job.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{company}{job.experience ? ` · ${job.experience}` : ""}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{ageLabel(today, job.posted)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AnalyticsDashboard({ arena, today }: { arena: ArenaOverview; today: string }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Data>("/api/dashboard");
    if (r.status === 401) return router.replace("/onboarding");
    if (!r.ok) return setError(r.error);
    setError(null);
    setData(r.data);
  }, [router]);
  useEffect(() => { load(); }, [load]);
  useLive(load);

  const t = arena.totals;
  const empty = t.jobs === 0;
  const weekMax = Math.max(1, ...arena.weekly.map((w) => w.count));
  const modeTotal = Math.max(1, arena.modes.reduce((n, m) => n + m.count, 0));
  const stated = arena.modes.filter((m) => m.key !== "unknown").reduce((n, m) => n + m.count, 0);

  const tiles: { label: string; value: number; hint: string; href: string }[] = [
    { label: "Open roles", value: t.jobs, hint: `at ${nf(t.companies)} companies`, href: "/companies" },
    { label: "Posted in last 30 days", value: t.last30, hint: t.latestPosted ? `latest posting ${fmtDate(t.latestPosted)}` : "no dates listed", href: "/companies" },
    { label: "Fresher friendly", value: t.fresher, hint: "marked for freshers", href: "/companies" },
    { label: "Remote", value: t.remote, hint: "work mode says remote", href: "/companies" },
    { label: "Your new matches", value: data?.metrics.new_matches ?? 0, hint: data ? "fit your profile, found this week" : "loading", href: "/discover" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={data?.name ? `Welcome back, ${data.name.split(" ")[0]}` : "Dashboard"}
        subtitle="Who is hiring in Bengaluru, what they want, and what fits you."
        actions={<>
          <Link href="/companies" className={buttonVariants({ variant: "outline" })}>Browse companies</Link>
          <Link href="/discover" className={buttonVariants({ variant: "outline" })}>Open Discover <ArrowRightIcon /></Link>
        </>}
      />
      <DataFreshness />

      {empty ? (
        <EmptyState icon={BriefcaseBusinessIcon} title="No listings collected yet">
          Run <code className="rounded bg-muted px-1.5 py-0.5 text-xs">npm run blrarena:jobs</code> to download every company&apos;s jobs. The numbers and charts on this page fill in from that file.
        </EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {tiles.map((m, i) => (
              <li key={m.label} className={cn(i === 0 && "col-span-2 lg:col-span-1")}>
                <Link href={m.href} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card className="h-full gap-1 px-4 transition-colors hover:ring-primary/40">
                    <div className="text-2xl font-semibold tabular-nums">{nf(m.value)}</div>
                    <div className="text-sm font-medium">{m.label}</div>
                    <p className="text-xs text-muted-foreground">{m.hint}</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Postings by week" note={`Roles by posted date, 8 weeks up to ${t.latestPosted ? fmtDate(t.latestPosted) : "today"}. Each bar starts on the date shown.`} className="lg:col-span-2">
              <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label="Roles posted per week for the last eight weeks">
                {arena.weekly.map((w, i) => (
                  <div key={w.week} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5 text-center">
                    <span className="text-xs tabular-nums text-muted-foreground">{nf(w.count)}</span>
                    <div className="rounded-t-md bg-brand-gradient" style={{ height: `${Math.max(2, (w.count / weekMax) * 78)}%`, opacity: w.count === 0 ? 0.25 : 1 }} />
                    <span className={cn("truncate text-[11px] text-muted-foreground", i % 2 === 0 && "max-sm:invisible")}>{new Date(w.week + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Work mode" note={`${Math.round((stated / modeTotal) * 100)}% of listings state one. The rest don't say.`}>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Share of roles by work mode">
                {arena.modes.map((m) => m.count > 0 && <div key={m.key} className={MODE_COLOR[m.key]} style={{ width: `${(m.count / modeTotal) * 100}%` }} />)}
              </div>
              <ul className="space-y-2 text-[13px]">
                {arena.modes.map((m) => (
                  <li key={m.key} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2"><span className={cn("size-2.5 rounded-sm", MODE_COLOR[m.key])} />{m.label}</span>
                    <span className="tabular-nums text-muted-foreground">{nf(m.count)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="What companies are hiring for" note="Open roles by role family, top 8.">
              <Bars rows={arena.families.slice(0, 8).map((f) => ({ label: f.label, value: f.count }))} />
            </Panel>
            <Panel title="Experience asked for" note="Minimum experience stated in the listing.">
              <Bars tone="bg-chart-4" rows={arena.experience.filter((e) => e.count > 0).map((e) => ({ label: e.label, value: e.count }))} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Companies with the most open roles">
              <Bars tone="bg-chart-2" rows={arena.topCompanies.map((c) => ({ label: c.name, value: c.count, href: `/companies/${c.slug}` }))} />
              <Link href="/companies" className="text-sm font-medium text-primary hover:underline">All {nf(t.companies)} companies</Link>
            </Panel>
            <Panel title="Hiring fastest" note="Most roles posted in the last 30 days.">
              {arena.fastestGrowing.length === 0 ? <p className="text-sm text-muted-foreground">No postings in the last 30 days.</p> : (
                <ul className="-mx-2 divide-y divide-border/60">
                  {arena.fastestGrowing.map((c) => (
                    <li key={c.slug}>
                      <Link href={`/companies/${c.slug}`} className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                        <StartupAvatar name={c.name} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{c.recent} new of {c.total}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Newest roles" note="Most recently posted across all companies.">
              <JobList rows={arena.newest} today={today} empty="No dated roles yet." />
            </Panel>
            <Panel title="Fresher-friendly roles" note="Newest roles marked for freshers.">
              <JobList rows={arena.freshers} today={today} empty="No fresher roles in the current data." />
            </Panel>
          </div>
        </>
      )}

      <section aria-labelledby="for-you" className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 id="for-you" className="text-lg font-semibold">For you</h2>
          {data && data.metrics.new_matches > data.picks.length && <Link href="/discover" className="text-sm font-medium text-primary hover:underline">See all {data.metrics.new_matches}</Link>}
        </div>
        {error && <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>}>{error}</Banner>}
        {!data && !error && <PageSkeleton variant="cards" count={3} />}
        {data && (
          <>
            {data.actions.length > 0 && (
              <ul className="divide-y divide-border rounded-xl border bg-card">
                {data.actions.map((a, i) => (
                  <li key={i}>
                    <Link href={a.href} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                      <span>{a.text}</span>
                      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {data.picks.length === 0 ? (
              <EmptyState icon={BriefcaseBusinessIcon} title="No new matching jobs right now" actions={<Link href="/discover" className={buttonVariants({ variant: "outline" })}>Browse older listings</Link>}>
                Nothing new that fits your profile has appeared this week. Older roles that are still listed are in Discover under Posted → Any date.
              </EmptyState>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-4">
                {data.picks.map(({ job, company }) => (
                  <JobCard key={job.id} job={job} showCompany={company.name} startup={{ id: company.id, name: company.name }} onChanged={load} />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
