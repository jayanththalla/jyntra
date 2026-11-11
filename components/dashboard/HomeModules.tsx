"use client";
// Dashboard: a personal career overview. Every number is a count or row from the database (/api/dashboard/modules, /api/analytics).
// Where a value does not exist yet the page says so and links to the action that creates it; nothing is invented.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { api } from "@/components/api";
import { useShell } from "@/components/AppShell";
import { MetricDisplay } from "@/components/kit/MetricDisplay";
import { QuickLinks } from "@/components/dashboard/QuickLinks";
import { CountUp, GrowBar } from "@/components/kit/CountUp";
import { DailyInsight } from "@/components/dashboard/DailyInsight";
import { ActivityTimeline, type TimelineEntry } from "@/components/kit/ActivityTimeline";
import { ErrorState } from "@/components/kit/States";
import { DashboardSkeleton } from "@/components/skeletons";
import { Stagger, StaggerItem } from "@/components/kit/Motion";
import { EmptyState } from "@/components/EmptyState";
import { MicIcon, SparklesIcon, SourceCodeIcon, NewspaperIcon, ArrowRightIcon, TargetIcon, GithubIcon, BookmarkIcon } from "@/components/icons";

const shortDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function SectionHead({ title, href, cta }: { title: string; href?: string; cta?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="eyebrow !text-foreground">{title}</h2>
      {href && <Link href={href} className="group inline-flex items-center gap-1 text-xs font-medium text-accent-brand-foreground hover:underline">{cta}<ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" /></Link>}
    </div>
  );
}

/** Interview scores over time. Shown only with two or more scored sessions; bars grow once when the data arrives. */
function ScoreChart({ series }: { series: { id: string; overall: number; started_at: string; role?: string | null; type?: string }[] }) {
  return (
    <figure aria-label={`Overall score of your last ${series.length} interviews`}>
      <div className="flex h-36 items-end gap-2 border-b border-border">
        {series.map((s, i) => (
          <Link key={s.id} href={`/mock-interview/history?id=${s.id}`} className="group relative flex h-full flex-1 flex-col justify-end outline-none" aria-label={`${s.role ?? s.type}: ${s.overall} out of 100 on ${shortDate(s.started_at)}`}>
            <span className="mb-1 text-center font-mono text-[10px] text-muted-foreground tabular group-hover:text-foreground">{s.overall}</span>
            <motion.span
              className="block w-full origin-bottom rounded-t-[3px] bg-indigo group-hover:bg-indigo-deep group-focus-visible:bg-indigo-deep"
              style={{ height: `${Math.max(4, s.overall)}%` }}
              initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.5, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            />
          </Link>
        ))}
      </div>
      <figcaption className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground"><span>{shortDate(series[0].started_at)}</span><span>score out of 100</span><span>{shortDate(series[series.length - 1].started_at)}</span></figcaption>
    </figure>
  );
}

export function HomeModules() {
  const { user } = useShell();
  const [d, setD] = useState<any>(null);
  const [a, setA] = useState<any>(null); // /api/analytics: saved opportunities, follow-ups
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    api("/api/dashboard/modules").then((r) => {
      if (r.status === 401) window.location.href = "/onboarding";
      else if (r.ok) setD(r.data);
      else setErr(r.error ?? "Could not load your dashboard.");
    });
    api("/api/analytics").then((r) => { if (r.ok) setA(r.data); }); // optional: the page works without it
  }, []);
  useEffect(load, [load]);

  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!d) return [];
    const rows: TimelineEntry[] = [
      ...d.interview.recent.map((s: any) => ({ id: `i${s.id}`, at: s.started_at, title: `${s.role ?? s.type} interview · ${s.overall ?? "–"}/100`, meta: s.mode === "timed" ? "Timed session" : "Practice session", href: `/mock-interview/history?id=${s.id}`, icon: MicIcon })),
      ...d.openSource.inProgress.map((c: any) => ({ id: `c${c.repo}${c.issue_number}`, at: c.updated_at, title: c.issue_title, meta: `${c.repo} · ${c.done}/9 steps${c.saved ? " · saved" : ""}`, href: `/open-source/contribute?repo=${encodeURIComponent(c.repo)}&issue=${c.issue_number}`, icon: GithubIcon })),
      ...d.funding.map((f: any) => ({ id: `f${f.url}`, at: f.published_at, title: f.headline, meta: `${f.company_name ?? "Company"} · ${f.funding_amount} · ${f.publisher}`, href: f.url, external: true, icon: NewspaperIcon })),
    ];
    return rows.sort((x, y) => (y.at ? +new Date(y.at) : 0) - (x.at ? +new Date(x.at) : 0)).slice(0, 7);
  }, [d]);

  if (err) return <div className="space-y-6"><PageHeader title="Your Jyntra" /><ErrorState title="Could not load your dashboard" onRetry={load}>{err}</ErrorState></div>;
  if (!d) return <DashboardSkeleton />;

  const first = (user?.profile?.name || "").trim().split(/\s+/)[0];
  const done = d.interview.completed as number;
  const saved = a ? (a.saved_jobs ?? 0) + (a.saved_startups ?? 0) : null;
  const subtitle = done
    ? `${done} interview${done === 1 ? "" : "s"} completed${d.interview.best != null ? `, best score ${d.interview.best}/100` : ""}.${a?.followups_due ? ` ${a.followups_due} follow-up${a.followups_due === 1 ? " is" : "s are"} due.` : ""}`
    : "Practise an interview, find a first open-source issue, or ask Atlas about your own experience. Your progress shows up here.";

  return (
    <div className="space-y-8">
      <header className="hero-zone relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10 sm:py-10">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full border border-white/15" />
        <div aria-hidden className="pointer-events-none absolute -right-4 -top-12 size-72 rounded-full border border-white/10" />
        <div className="relative grid items-center gap-4 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="font-heading text-xs font-bold uppercase tracking-wider text-white/70">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
            <h1 className="mt-2 font-heading text-[2rem] font-extrabold leading-[1.05] tracking-tight sm:text-5xl">{greeting()}{first ? `, ${first}` : ""}.</h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/85">{subtitle}</p>
            <Link href="/mock-interview" className="btn-sun mt-5 inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm shadow-[0_6px_0_-2px_rgba(20,18,43,.35)] transition-transform active:translate-y-0.5"><MicIcon className="size-4" />{done ? "Practise again" : "Start AI Interview"}</Link>
          </div>
          <img src="/illustrations/3d/rocket.png" alt="" width={320} height={320} className="mx-auto hidden w-48 drop-shadow-[0_20px_30px_rgba(20,18,43,.35)] sm:-my-6 sm:block lg:w-60" />
        </div>
      </header>

      <QuickLinks />

      <DailyInsight completed={done} best={d.interview.best ?? null} avg={d.interview.avg ?? null} saved={saved} followupsDue={a?.followups_due ?? 0} contributions={d.openSource.inProgress[0] ? { title: d.openSource.inProgress[0].issue_title, href: `/open-source/contribute?repo=${encodeURIComponent(d.openSource.inProgress[0].repo)}&issue=${d.openSource.inProgress[0].issue_number}` } : null} atlasDocs={d.atlas.documents ?? 0} />

      <section aria-label="Career overview">
        <SectionHead title="Career overview" />
        <dl className="grid grid-cols-2 divide-x divide-border lg:grid-cols-5 [&>*]:pl-4 [&>*:first-child]:pl-0">
          <MetricDisplay label="Interviews" value={<CountUp to={done} />} caption={done ? "completed sessions" : "none finished yet"} href="/mock-interview/history" />
          <MetricDisplay label="Average score" value={d.interview.avg != null ? <CountUp to={Math.round(d.interview.avg)} /> : "–"} unit={d.interview.avg != null ? "/100" : undefined} caption={d.interview.best != null ? `best ${d.interview.best}` : "after your first report"} />
          <MetricDisplay label="Saved" value={saved != null ? <CountUp to={saved} /> : "–"} caption="jobs and startups" href="/applications" />
          <MetricDisplay label="Contributions" value={<CountUp to={d.openSource.inProgress.length} />} caption="open-source in progress" href="/open-source" />
          <MetricDisplay label="Atlas sources" value={<CountUp to={d.atlas.documents ?? 0} />} caption={d.atlas.projects ? `${d.atlas.projects} projects indexed` : "indexed documents"} href="/career-ai" />
        </dl>
      </section>

      {a && a.outreach_contacted > 0 && (
        <section aria-label="Outreach results">
          <SectionHead title="Outreach results" href="/applications" cta="Record outcomes" />
          <div className="grid gap-4 sm:grid-cols-3">
            {([["Reply rate", a.outreach_replied], ["Positive replies", a.outreach_positive], ["Calls or interviews", a.outreach_meaningful]] as [string, number][]).map(([label, n]) => {
              const pct = Math.round((n / a.outreach_contacted) * 100);
              return (
                <div key={label} className="tile p-4">
                  <p className="eyebrow">{label}</p>
                  <p className="display mt-1 text-3xl"><CountUp to={pct} /><span className="ml-0.5 font-sans text-sm font-normal text-muted-foreground">%</span></p>
                  <div className="mt-2"><GrowBar pct={pct} /></div>
                  <p className="mt-2 text-xs text-muted-foreground">{n} of {a.outreach_contacted} contacted</p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Counts companies you sent outreach to, using the outcomes you recorded in Applications. Update outcomes there to keep this accurate; impressions, replies and offers are different stages.</p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 space-y-8 lg:col-span-7">
          <section aria-label="Interview progress">
            <SectionHead title="Interview progress" href={done ? "/mock-interview" : undefined} cta="Practise again" />
            {d.interview.series.length >= 2 ? (
              <ScoreChart series={d.interview.series} />
            ) : done === 1 ? (
              <p className="text-sm text-muted-foreground">One scored session so far ({d.interview.recent[0]?.overall ?? "–"}/100). Complete another and your trend appears here.</p>
            ) : (
              <EmptyState icon={TargetIcon} art="/illustrations/3d/mic.png" title="No finished interviews yet" actions={<Button asChild size="sm"><Link href="/mock-interview">Start your first</Link></Button>}>
                Your scores, strengths and areas to improve will build up here.
              </EmptyState>
            )}
          </section>

          <section aria-label="Open source">
            <SectionHead title="Open source" href="/open-source" cta="Find an issue" />
            {d.openSource.inProgress.length === 0 && d.openSource.forYou.length === 0 ? (
              <p className="text-sm text-muted-foreground">{d.openSource.hasSkills ? "No beginner issue matches your listed skills right now. Browse all issues." : "Add skills to your profile to see issues matched to them, or browse beginner issues."}</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {d.openSource.inProgress.map((c: any) => (
                  <li key={c.repo + c.issue_number}>
                    <Link href={`/open-source/contribute?repo=${encodeURIComponent(c.repo)}&issue=${c.issue_number}`} className="flex items-center gap-3 py-2.5 outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{c.issue_title}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{c.repo}</span></span>
                      <span className="shrink-0 font-mono text-[11px] tabular text-muted-foreground">{c.done}/9 steps</span>
                    </Link>
                  </li>
                ))}
                {d.openSource.forYou.map((p: any) => (
                  <li key={p.repo}>
                    <a href={p.issue_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2.5 outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.repo}</span><span className="block truncate text-xs text-muted-foreground">Matched on {p.matchedOn.join(", ")}</span></span>
                      <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">for you</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-8 lg:col-span-5">
          <section aria-label="Funding updates">
            <SectionHead title="Funding wire" href="/news" cta="All news" />
            {d.funding.length === 0 ? <p className="text-sm text-muted-foreground">No funding stories collected yet.</p> : (
              <ul className="divide-y divide-border border-y border-border">
                {d.funding.map((f: any) => (
                  <li key={f.url}>
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="block py-3 outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="display block text-[17px] leading-snug">{f.headline}</span>
                      <span className="mt-1 block font-mono text-[11px] text-muted-foreground">{f.company_name ?? "Company"}{f.funding_round && ` · ${f.funding_round}`} · <span className="text-foreground">{f.funding_amount}</span></span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{f.publisher}{f.published_at && ` · ${shortDate(f.published_at)}`}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Recent activity">
            <SectionHead title="Activity" />
            {timeline.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet. Finish an interview or start a contribution and it will be listed here.</p> : <ActivityTimeline entries={timeline} />}
          </section>
        </div>
      </div>

      {saved === 0 && (
        <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground"><BookmarkIcon className="size-4" />You haven&apos;t saved any jobs or startups yet. <Link className="font-medium text-accent-brand-foreground hover:underline" href="/discover">Browse Discover</Link></p>
      )}
    </div>
  );
}
