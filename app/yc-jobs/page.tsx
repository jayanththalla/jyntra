"use client";
// YC Jobs: jobs at Y Combinator companies from this year's batches (or funded recently), posted in the
// last week. Everything shown comes from stored data: YC company pages, careers pages and funding news.
// Links and contacts appear only when a source listed them.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { JobView, StartupView } from "@/lib/types";
import { api } from "@/components/api";
import { JobCard } from "@/components/JobCard";
import { Emails } from "@/components/Emails";
import { Chip } from "@/components/Chip";
import { SelectField } from "@/components/SelectField";
import { StartupAvatar } from "@/components/StartupAvatar";
import { Banner } from "@/components/Banner";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { useLive } from "@/components/live";
import { DataFreshness } from "@/components/DataFreshness";
import { Pagination } from "@/components/Pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  BanknoteIcon,
  ExternalLinkIcon,
  GithubIcon,
  GlobeIcon,
  LinkedinIcon,
  Loader2Icon,
  RocketIcon,
  RotateCwIcon,
  SearchIcon,
  ClockIcon,
} from "@/components/icons";
import { ROLE_CATEGORIES } from "@/lib/jobs/roles";
import { ycFundedWithin } from "@/lib/filters";
import { ycBatchFundingDate, ycBatchName } from "@/lib/funding";
import { settings } from "@/config/settings";

type Funding = "90" | "30" | "any";
type Country = "any" | "india" | "usa";
interface Filters {
  /** "all" or a batch name like "Summer 2026". */
  batch: string;
  funding: Funding;
  country: Country;
  role: string;
  remote: boolean;
  internship: boolean;
  fresher: boolean;
  openSource: boolean;
  q: string;
}
// Funding defaults to any time: the batch row is the main way to narrow by date.
const DEFAULTS: Filters = { batch: "all", funding: "any", country: "any", role: "all", remote: false, internship: false, fresher: false, openSource: false, q: "" };

/** "Y Combinator Summer 2026" → "YC Summer 2026". */
const batchLabel = (round: string | null) => round?.replace(/^Y\s?Combinator\s*/i, "YC ").trim() || null;
const isLinkedIn = (url: string | null) => !!url && /^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(url);
const githubName = (url: string) => url.replace(/^https:\/\/github\.com\//, "");

function jobMatches(j: JobView, f: Filters): boolean {
  if (f.role !== "all" && !j.role_categories.includes(f.role)) return false;
  if (f.remote && j.work_arrangement !== "remote" && j.remote !== "yes") return false;
  if (f.internship && j.role_type !== "internship") return false;
  if (f.fresher && j.role_type !== "internship" && j.experience_level !== "fresher") return false;
  return true;
}

function startupMatches(s: StartupView, f: Filters): boolean {
  if (f.batch !== "all" && ycBatchName(s.funding_round) !== f.batch) return false;
  if (f.funding !== "any" && !ycFundedWithin(s, Number(f.funding))) return false;
  if (f.country === "india" && s.hq_country !== "India") return false;
  if (f.country === "usa" && s.hq_country !== "United States") return false;
  if (f.openSource && !s.open_source) return false;
  return true;
}

/** Funding line from stored facts only; YC dates are marked as estimates. */
function fundingLine(s: StartupView): string {
  const parts: string[] = [];
  if (s.last_funding_amount) parts.push(s.last_funding_amount);
  if (s.funding_round) parts.push(s.funding_round.replace(/^Y\s?Combinator\s*/i, "YC "));
  if (s.last_funding_date) parts.push(`${s.funding_date_approximate ? "≈ " : ""}${s.last_funding_date}`);
  return parts.join(" · ") || "Funding details not listed";
}

function ExtLink({ href, icon: Icon, children }: { href: string; icon: typeof GlobeIcon; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
      <Icon className="size-3.5" />
      {children}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function CompanyCard({ s, jobs, onChanged }: { s: StartupView; jobs: JobView[]; onChanged: () => void }) {
  const batch = batchLabel(s.funding_round);
  const founders = (s.founders ?? []).filter((p) => isLinkedIn(p.profile_url));
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <StartupAvatar name={s.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/startups/${s.id}`} className="text-lg font-semibold hover:text-primary">
                {s.name}
              </Link>
              {batch && <Badge variant="secondary">{batch}</Badge>}
              {s.open_source && <Badge variant="outline">Open source</Badge>}
              {s.funding_kind && s.funding_kind !== "confirmed" && <Badge variant="outline">{s.funding_kind === "planned" ? "Planned round" : "Unconfirmed"}</Badge>}
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {[s.hq_country && `HQ: ${s.hq_country}`, s.location].filter(Boolean).join(" · ") || "Location not listed"}
            </p>
          </div>
        </div>

        {s.description && <p className="line-clamp-2 text-sm text-muted-foreground">{s.description}</p>}

        <p className="flex items-start gap-1.5 text-[13px]">
          <BanknoteIcon className="mt-0.5 size-3.5 text-muted-foreground" />
          <span>
            {fundingLine(s)}
            {s.funding_source_url && (
              <>
                {" · "}
                <a href={s.funding_source_url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  source
                </a>
              </>
            )}
          </span>
        </p>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {s.website && <ExtLink href={s.website} icon={GlobeIcon}>Website</ExtLink>}
          {isLinkedIn(s.linkedin_url) && <ExtLink href={s.linkedin_url!} icon={LinkedinIcon}>Company LinkedIn</ExtLink>}
          {s.github_url && (
            <>
              <ExtLink href={s.github_url} icon={GithubIcon}>GitHub</ExtLink>
              <ExtLink
                href={`https://github.com/search?q=${encodeURIComponent(`org:${githubName(s.github_url)} is:issue is:open label:"good first issue"`)}&type=issues`}
                icon={ExternalLinkIcon}
              >
                Good first issues
              </ExtLink>
            </>
          )}
        </div>

        {founders.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="text-muted-foreground">Founders (from YC):</span>
            {founders.map((p) => (
              <ExtLink key={p.profile_url} href={p.profile_url!} icon={LinkedinIcon}>
                {p.name}
              </ExtLink>
            ))}
          </p>
        )}

        {s.emails.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Public emails (from their website)</p>
            <Emails emails={s.emails} limit={2} />
          </div>
        )}
      </div>

      <div className="divide-y divide-border border-t border-border px-4 sm:px-5">
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} application={s.applications.find((a) => a.job_id === j.id)} onChanged={onChanged} />
        ))}
      </div>
    </Card>
  );
}

export default function YcJobsPage() {
  const router = useRouter();
  const [startups, setStartups] = useState<StartupView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    const { ok, status, data, error } = await api("/api/yc-jobs");
    setLoading(false);
    if (status === 401) return router.replace("/onboarding");
    if (!ok) return setError(error);
    setError(null);
    setStartups(data.startups ?? []);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);
  useLive(load);

  const set = (patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  // Companies with at least one matching job, best match first; jobs best match first.
  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return (startups ?? [])
      .filter((s) => startupMatches(s, f))
      .map((s) => ({
        s,
        jobs: s.jobs
          .filter((j) => jobMatches(j, f) && (!q || `${j.job_title} ${s.name}`.toLowerCase().includes(q)))
          .sort((a, b) => b.match.match_score - a.match.match_score),
      }))
      .filter((r) => r.jobs.length > 0)
      .sort((a, b) => b.jobs[0].match.match_score - a.jobs[0].match.match_score);
  }, [startups, f]);

  // Batches present in the data, newest first, with how many companies each has.
  const batches = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of startups ?? []) {
      const b = ycBatchName(s.funding_round);
      if (b) count.set(b, (count.get(b) ?? 0) + 1);
    }
    const date = (b: string) => ycBatchFundingDate(`Y Combinator ${b}`) ?? "";
    return [...count.entries()].sort((a, b) => date(b[0]).localeCompare(date(a[0])));
  }, [startups]);

  const jobCount = rows.reduce((n, r) => n + r.jobs.length, 0);
  const totalJobs = (startups ?? []).reduce((n, s) => n + s.jobs.length, 0);
  const narrowed = JSON.stringify(f) !== JSON.stringify(DEFAULTS);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="YC Jobs"
        subtitle={`Jobs at companies from this year's Y Combinator batches, posted in the last ${settings.maxListedJobAgeDays} days, best match first.`}
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
            Refresh
          </Button>
        }
      />
      <DataFreshness />

      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search YC jobs"
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search a job title or YC company"
            className="h-10 pl-9"
          />
        </div>
        {batches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="YC batch">
            <span className="text-[13px] font-semibold">Batch</span>
            <Chip label="All batches" on={f.batch === "all"} onClick={() => set({ batch: "all" })} />
            {batches.map(([b, n]) => (
              <Chip
                key={b}
                label={`${b} (${n})`}
                on={f.batch === b}
                // A batch is its own date range, so the funding window is opened up.
                onClick={() => set(f.batch === b ? { batch: "all" } : { batch: b, funding: "any" })}
                title={`YC ${b} companies`}
              />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <SelectField
            aria-label="Funded"
            value={f.funding}
            onValueChange={(v) => set({ funding: v as Funding })}
            options={[
              { value: "90", label: "Funded: 3 months" },
              { value: "30", label: "Funded: 30 days" },
              { value: "any", label: "Funded: any time" },
            ]}
          />
          <SelectField
            aria-label="Headquarters"
            value={f.country}
            onValueChange={(v) => set({ country: v as Country })}
            options={[
              { value: "any", label: "Any country" },
              { value: "india", label: "HQ in India" },
              { value: "usa", label: "HQ in USA" },
            ]}
          />
          <SelectField
            aria-label="Job role"
            value={f.role}
            onValueChange={(v) => set({ role: v })}
            options={[{ value: "all", label: "All roles" }, ...ROLE_CATEGORIES.map((r) => ({ value: r, label: r }))]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip label="Remote" on={f.remote} onClick={() => set({ remote: !f.remote })} title="Remote jobs only" />
          <Chip label="Internships" on={f.internship} onClick={() => set({ internship: !f.internship })} title="Internship and trainee roles" />
          <Chip label="Fresher-friendly" on={f.fresher} onClick={() => set({ fresher: !f.fresher })} title="Internships, entry-level, or 0–1 years asked" />
          <Chip
            label="Open source"
            on={f.openSource}
            onClick={() => set({ openSource: !f.openSource })}
            title="Companies whose YC page lists a GitHub account or that YC tags Open Source"
          />
        </div>
        {f.funding !== "any" && (
          <p className="text-xs text-muted-foreground">Companies in the current YC batch count as funded: YC invests when the batch starts.</p>
        )}
      </div>

      {error && (
        <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>}>
          {error}
        </Banner>
      )}

      {!startups && !error && <PageSkeleton variant="cards" count={4} />}

      {startups && (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            <b className="font-semibold text-foreground">{jobCount}</b> job{jobCount === 1 ? "" : "s"} at{" "}
            <b className="font-semibold text-foreground">{rows.length}</b> YC compan{rows.length === 1 ? "y" : "ies"}
          </p>

          {rows.length === 0 &&
            (startups.length === 0 ? (
              <EmptyState
                icon={RocketIcon}
                title="No recent YC companies yet"
                actions={<Link href="/dashboard" className={buttonVariants()}>Go to Dashboard</Link>}
              >
                Click <b>Find Startups Today</b> on the Dashboard. It reads the latest YC batches, and their jobs show up here.
              </EmptyState>
            ) : totalJobs === 0 ? (
              <EmptyState
                icon={ClockIcon}
                title={`No YC jobs posted in the last ${settings.maxListedJobAgeDays} days`}
                actions={<Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>Go to Dashboard</Link>}
              >
                We know {startups.length} recent YC compan{startups.length === 1 ? "y" : "ies"}, but none posted a job this week. New searches run from the Dashboard.
              </EmptyState>
            ) : (
              <EmptyState
                icon={SearchIcon}
                title="No YC jobs match these filters"
                actions={narrowed && <Button variant="outline" onClick={() => { setF(DEFAULTS); setPage(1); }}>Clear filters</Button>}
              >
                There {totalJobs === 1 ? "is" : "are"} {totalJobs} recent YC job{totalJobs === 1 ? "" : "s"} in total. Try another role or turn off a toggle.
              </EmptyState>
            ))}

          <div className="space-y-4">
            {pageRows.map(({ s, jobs }) => (
              <CompanyCard key={s.id} s={s} jobs={jobs} onChanged={load} />
            ))}
          </div>

          {rows.length > 0 && (
            <Pagination
              total={rows.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
