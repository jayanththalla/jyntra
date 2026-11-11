"use client";
import { useEffect, useMemo, useState } from "react";
import type { CandidateProfile, StartupView } from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { JobCard, SOURCE_NAMES } from "@/components/JobCard";
import { jobAgeDays } from "@/lib/jobs/age";
import { EXPERIENCE_LEVELS, filtersForProfile } from "@/components/Filters";
import { Banner } from "@/components/Banner";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { SelectField } from "@/components/SelectField";
import { BriefcaseBusinessIcon, ExternalLinkIcon, SearchIcon, SlidersHorizontalIcon } from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_CATEGORIES } from "@/lib/jobs/roles";
import { Pagination } from "@/components/Pagination";
import { useLive } from "@/components/live";
import { DataFreshness } from "@/components/DataFreshness";

export default function JobsPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [startups, setStartups] = useState<StartupView[] | null>(null);
  const [myLocations, setMyLocations] = useState<string[]>([]);
  const [onlyRelevant, setOnlyRelevant] = useState(true);
  const [loc, setLoc] = useState<"mine" | "any">("mine");
  const [role, setRole] = useState<string>("all");
  const [level, setLevel] = useState<string>("all");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"all" | "remote" | "onsite">("all");
  const [type, setType] = useState("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState<"match" | "newest">("match");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const load = async () => {
    const { ok, status, data: d, error } = await api("/api/startups");
    if (status === 401) return router.replace("/onboarding");
    if (!ok) return setError(error);
    setError(null);
    setStartups(d.startups ?? []);
    const locs = filtersForProfile(d.profile as CandidateProfile | null).locations;
    setMyLocations(locs);
    if (!locs.length) setLoc("any");
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLive(load); // reloads by itself when a background refresh finishes

  const allRows = useMemo(() => (startups ?? []).flatMap((s) => s.jobs.map((j) => ({ j, s }))), [startups]);
  // Options come from the data we actually hold, never a hard-coded list.
  const types = useMemo(() => Array.from(new Set(allRows.map(({ j }) => j.employment_type).filter(Boolean) as string[])).sort(), [allRows]);
  const sources = useMemo(() => Array.from(new Set(allRows.map(({ j }) => j.source))).sort(), [allRows]);

  const jobs = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = allRows
      .filter(({ j }) => !onlyRelevant || j.match.relevance === "strong" || j.match.relevance === "potential")
      .filter(({ j }) => loc === "any" || j.location_tags.some((t) => myLocations.includes(t)))
      .filter(({ j }) => role === "all" || j.role_categories.includes(role))
      .filter(({ j }) => level === "all" || (j.role_type === level || j.experience_level === level))
      // "unknown" remote status matches neither Remote nor On-site: we don't guess.
      .filter(({ j }) => mode === "all" || (mode === "remote" ? j.remote === "yes" : j.remote === "no"))
      .filter(({ j }) => type === "all" || j.employment_type === type)
      .filter(({ j }) => source === "all" || j.source === source)
      .filter(({ j, s }) => !query || `${j.job_title} ${s.name} ${j.location ?? ""} ${j.skills.join(" ")}`.toLowerCase().includes(query));
    const age = (d: string | null) => jobAgeDays(d) ?? Number.POSITIVE_INFINITY; // undated jobs sort last
    return rows.sort((a, b) =>
      sort === "newest" ? age(a.j.posted_date) - age(b.j.posted_date) || b.j.match.match_score - a.j.match.match_score : b.j.match.match_score - a.j.match.match_score,
    );
  }, [allRows, onlyRelevant, loc, myLocations, role, level, q, mode, type, source, sort]);

  useEffect(() => setPage(1), [onlyRelevant, loc, role, level, q, mode, type, source, sort]);

  const paginatedJobs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return jobs.slice(start, start + pageSize);
  }, [jobs, page, pageSize]);

  const narrowed = loc !== "any" || role !== "all" || level !== "all" || onlyRelevant || !!q || mode !== "all" || type !== "all" || source !== "all";
  const activeCount = [loc === "mine" && myLocations.length > 0, role !== "all", level !== "all", mode !== "all", type !== "all", source !== "all", onlyRelevant].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Jobs" subtitle="Open roles at the startups we track, scored against your profile, with posting date and source on each one." />
      <DataFreshness />

      <Card>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search jobs by title, company, skill or location" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, company, skill or location" className="pl-9" />
            </div>
            <Button variant="outline" className="shrink-0 sm:hidden" aria-expanded={showFilters} aria-controls="job-filters" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontalIcon /> Filters{activeCount > 0 ? ` (${activeCount})` : ""}
            </Button>
          </div>
          <div id="job-filters" className={(showFilters ? "grid" : "hidden") + " grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"}>
            <SelectField aria-label="Work mode" value={mode} onValueChange={(v) => setMode(v as typeof mode)} options={[{ value: "all", label: "Remote or on-site" }, { value: "remote", label: "Remote" }, { value: "onsite", label: "On-site" }]} className="w-full sm:w-44" />
            <SelectField aria-label="Employment type" value={type} onValueChange={setType} options={[{ value: "all", label: "Any type" }, ...types.map((t) => ({ value: t, label: t }))]} className="w-full sm:w-44" />
            <SelectField aria-label="Source" value={source} onValueChange={setSource} options={[{ value: "all", label: "Any source" }, ...sources.map((x) => ({ value: x, label: SOURCE_NAMES[x] ?? x }))]} className="w-full sm:w-44" />
            <SelectField
              aria-label="Experience needed"
              value={level}
              onValueChange={setLevel}
              options={[{ value: "all", label: "Any experience" }, ...EXPERIENCE_LEVELS.map(([k, l]) => ({ value: k, label: l }))]}
              className="w-full sm:w-44"
            />
            <SelectField aria-label="Job role" value={role} onValueChange={setRole} options={[{ value: "all", label: "All roles" }, ...ROLE_CATEGORIES.map((r) => ({ value: r, label: r }))]} className="w-full sm:w-44" />
            <SelectField
              aria-label="Location"
              value={loc}
              onValueChange={(v) => setLoc(v as "mine" | "any")}
              options={[...(myLocations.length > 0 ? [{ value: "mine", label: "My locations" }] : []), { value: "any", label: "Anywhere" }]}
              className="w-full sm:w-44"
            />
            <SelectField aria-label="Sort by" value={sort} onValueChange={(v) => setSort(v as typeof sort)} options={[{ value: "match", label: "Best match" }, { value: "newest", label: "Newest posted" }]} className="w-full sm:ml-auto sm:w-44" />
            <div className="col-span-2 flex items-center gap-2 px-1 sm:col-span-1">
              <Checkbox id="only-relevant" checked={onlyRelevant} onCheckedChange={(v) => setOnlyRelevant(v === true)} />
              <Label htmlFor="only-relevant" className="flex min-h-6 items-center text-[13px]">
                Only jobs that fit me
              </Label>
            </div>
          </div>
          {/* always rendered (empty until the profile loads) so the page below never jumps */}
          <p className="min-h-4 text-xs text-muted-foreground">{loc === "mine" && myLocations.length > 0 ? `My locations: ${myLocations.join(", ")}` : "\u00a0"}</p>
        </CardContent>
      </Card>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="basis-full">Search other boards (opens their site; Jyntra doesn&apos;t import from them):</span>
        {[
          ["LinkedIn", `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(q.trim())}`],
          ["Wellfound", "https://wellfound.com/jobs"],
          ["CutShort", "https://cutshort.io/jobs"],
        ].map(([name, href]) => (
          <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1 font-medium text-primary hover:underline">
            {name} <ExternalLinkIcon className="size-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ))}
      </p>

      {error && (
        <Banner
          tone="error"
          action={
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          }
        >
          {error}
        </Banner>
      )}

      {!startups && !error && (
<PageSkeleton variant="cards" count={6} />
      )}

      {startups && (
        <>
          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
            <b className="font-semibold text-foreground">{jobs.length}</b> job{jobs.length === 1 ? "" : "s"}
          </p>
          {jobs.length === 0 ? (
            startups.length === 0 ? (
              <EmptyState
                icon={BriefcaseBusinessIcon}
                title="No jobs yet"
                actions={
                  <Link href="/startups" className={buttonVariants()}>
                    Go to Startups
                  </Link>
                }
              >
                Check for startups first. Their open jobs show up here, ranked for you.
              </EmptyState>
            ) : (
              <EmptyState
                icon={SearchIcon}
                title="No jobs match these filters"
                actions={
                  narrowed && (
                    <>
                      {onlyRelevant && (
                        <Button variant="outline" onClick={() => setOnlyRelevant(false)}>
                          Include weaker matches
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setLoc("any");
                          setMode("all");
                          setType("all");
                          setSource("all");
                          setRole("all");
                          setLevel("all");
                          setQ("");
                        }}
                      >
                        Clear filters
                      </Button>
                    </>
                  )
                }
              >
                Try a different role or experience level, or look anywhere.
              </EmptyState>
            )
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-4">
                {paginatedJobs.map(({ j, s }) => (
                  <JobCard key={j.id} job={j} showCompany={s.name} funding={s} startup={s} application={s.applications.find((a) => a.job_id === j.id)} onChanged={load} />
                ))}
              </div>

              {jobs.length > 0 && (
                <div className="pt-4 border-t border-border/60">
                  <Pagination
                    total={jobs.length}
                    page={page}
                    pageSize={pageSize}
                    onPageChange={(p) => {
                      setPage(p);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    onPageSizeChange={(sz) => {
                      setPageSize(sz);
                      setPage(1);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
