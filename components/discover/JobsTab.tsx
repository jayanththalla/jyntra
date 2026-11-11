"use client";
// Discover → Jobs. One list of individual jobs. YC batch and source are filters here, not a separate page.
// The default view is "New this week"; older roles that are still listed are one click away (Posted → Any date).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { CandidateProfile, StartupView } from "@/lib/types";
import { api } from "@/components/api";
import { JobCard, SOURCE_NAMES } from "@/components/JobCard";
import { EXPERIENCE_LEVELS, filtersForProfile } from "@/components/Filters";
import { Banner } from "@/components/Banner";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { SelectField } from "@/components/SelectField";
import { Pagination } from "@/components/Pagination";
import { useLive } from "@/components/live";
import { DataFreshness } from "@/components/DataFreshness";
import { BriefcaseBusinessIcon, ExternalLinkIcon, SearchIcon, SlidersHorizontalIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_CATEGORIES } from "@/lib/jobs/roles";
import { inPostedWindow, newestOrder, POSTED_WINDOWS, type PostedWindow } from "@/lib/jobs/age";
import { jobEvidence } from "@/lib/jobs/evidence";
import { ycBatchFundingDate, ycBatchName } from "@/lib/funding";

const isPosted = (v: string | null): v is PostedWindow => v === "week" || v === "confirmed_week" || v === "any";

export function JobsTab() {
  const router = useRouter();
  const sp = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [startups, setStartups] = useState<StartupView[] | null>(null);
  const [myLocations, setMyLocations] = useState<string[]>([]);
  const [onlyRelevant, setOnlyRelevant] = useState(true);
  const [loc, setLoc] = useState<"mine" | "any">("mine");
  const [role, setRole] = useState("all");
  const [level, setLevel] = useState("all");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"all" | "remote" | "onsite">("all");
  const [type, setType] = useState("all");
  const [source, setSource] = useState(sp.get("source") ?? "all");
  const [batch, setBatch] = useState(sp.get("batch") ?? "all");
  const [posted, setPosted] = useState<PostedWindow>(isPosted(sp.get("posted")) ? (sp.get("posted") as PostedWindow) : "week");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sort, setSort] = useState<"match" | "newest">("match");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    const { ok, status, data: d, error } = await api("/api/startups");
    if (status === 401) return router.replace("/onboarding");
    if (!ok) return setError(error);
    setError(null);
    setStartups(d.startups ?? []);
    const locs = filtersForProfile(d.profile as CandidateProfile | null).locations;
    setMyLocations(locs);
    if (!locs.length) setLoc("any");
  }, [router]);
  useEffect(() => {
    load();
  }, [load]);
  useLive(load);

  const allRows = useMemo(() => (startups ?? []).flatMap((s) => s.jobs.map((j) => ({ j, s }))), [startups]);
  // Options come from the data we hold, never a hard-coded list.
  const types = useMemo(() => Array.from(new Set(allRows.map(({ j }) => j.employment_type).filter(Boolean) as string[])).sort(), [allRows]);
  const sources = useMemo(() => Array.from(new Set(allRows.map(({ j }) => j.source))).sort(), [allRows]);
  const batches = useMemo(() => {
    const count = new Map<string, number>();
    for (const { s } of allRows) {
      const b = ycBatchName(s.funding_round);
      if (b) count.set(b, (count.get(b) ?? 0) + 1);
    }
    const date = (b: string) => ycBatchFundingDate(`Y Combinator ${b}`) ?? "";
    return [...count.entries()].sort((a, b) => date(b[0]).localeCompare(date(a[0])));
  }, [allRows]);

  const passes = useCallback(
    (row: (typeof allRows)[number], window: PostedWindow) => {
      const { j, s } = row;
      const query = q.trim().toLowerCase();
      return (
        inPostedWindow(j.recency, window) &&
        (!onlyRelevant || j.match.relevance === "strong" || j.match.relevance === "potential") &&
        (loc === "any" || j.location_tags.some((t) => myLocations.includes(t))) &&
        (role === "all" || j.role_categories.includes(role)) &&
        (level === "all" || j.role_type === level || j.experience_level === level) &&
        // "unknown" remote status matches neither Remote nor On-site: we don't guess.
        (mode === "all" || (mode === "remote" ? j.remote === "yes" : j.remote === "no")) &&
        (type === "all" || j.employment_type === type) &&
        (source === "all" || j.source === source) &&
        (batch === "all" || ycBatchName(s.funding_round) === batch) &&
        (!verifiedOnly || jobEvidence(j).kind === "verified_opening") &&
        (!query || `${j.job_title} ${s.name} ${j.location ?? ""} ${j.skills.join(" ")}`.toLowerCase().includes(query))
      );
    },
    [q, onlyRelevant, loc, myLocations, role, level, mode, type, source, batch, verifiedOnly],
  );

  const jobs = useMemo(() => {
    const rows = allRows.filter((r) => passes(r, posted));
    return rows.sort((a, b) => (sort === "newest" ? newestOrder(a.j.recency, b.j.recency) || b.j.match.match_score - a.j.match.match_score : b.j.match.match_score - a.j.match.match_score));
  }, [allRows, passes, posted, sort]);

  // How many MORE roles would appear if the user looked at every listing that is still open.
  const olderHidden = useMemo(() => (posted === "any" ? 0 : allRows.filter((r) => passes(r, "any")).length - jobs.length), [allRows, passes, posted, jobs.length]);

  useEffect(() => setPage(1), [onlyRelevant, loc, role, level, q, mode, type, source, batch, posted, verifiedOnly, sort]);
  const paginated = useMemo(() => jobs.slice((page - 1) * pageSize, page * pageSize), [jobs, page, pageSize]);

  const activeCount = [loc === "mine" && myLocations.length > 0, role !== "all", level !== "all", mode !== "all", type !== "all", source !== "all", batch !== "all", posted !== "week", verifiedOnly, onlyRelevant].filter(Boolean).length;
  const reset = () => {
    setLoc("any"); setMode("all"); setType("all"); setSource("all"); setBatch("all"); setRole("all"); setLevel("all"); setQ(""); setVerifiedOnly(false); setPosted("week");
  };
  const w = "w-full sm:w-44";

  return (
    <div className="space-y-5">
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
            <SelectField aria-label="Posted" value={posted} onValueChange={(v) => setPosted(v as PostedWindow)} options={POSTED_WINDOWS.map((p) => ({ value: p.value, label: p.label }))} className={w} />
            <SelectField aria-label="Work mode" value={mode} onValueChange={(v) => setMode(v as typeof mode)} options={[{ value: "all", label: "Remote or on-site" }, { value: "remote", label: "Remote" }, { value: "onsite", label: "On-site" }]} className={w} />
            <SelectField aria-label="Employment type" value={type} onValueChange={setType} options={[{ value: "all", label: "Any type" }, ...types.map((t) => ({ value: t, label: t }))]} className={w} />
            <SelectField aria-label="Source" value={source} onValueChange={setSource} options={[{ value: "all", label: "Any source" }, ...sources.map((x) => ({ value: x, label: SOURCE_NAMES[x] ?? x }))]} className={w} />
            {batches.length > 0 && (
              <SelectField aria-label="Y Combinator batch" value={batch} onValueChange={setBatch} options={[{ value: "all", label: "Any YC batch" }, ...batches.map(([b, n]) => ({ value: b, label: `YC ${b} (${n})` }))]} className={w} />
            )}
            <SelectField aria-label="Experience needed" value={level} onValueChange={setLevel} options={[{ value: "all", label: "Any experience" }, ...EXPERIENCE_LEVELS.map(([k, l]) => ({ value: k, label: l }))]} className={w} />
            <SelectField aria-label="Job role" value={role} onValueChange={setRole} options={[{ value: "all", label: "All roles" }, ...ROLE_CATEGORIES.map((r) => ({ value: r, label: r }))]} className={w} />
            <SelectField aria-label="Location" value={loc} onValueChange={(v) => setLoc(v as "mine" | "any")} options={[...(myLocations.length > 0 ? [{ value: "mine", label: "My locations" }] : []), { value: "any", label: "Anywhere" }]} className={w} />
            <SelectField aria-label="Sort by" value={sort} onValueChange={(v) => setSort(v as typeof sort)} options={[{ value: "match", label: "Best match" }, { value: "newest", label: "Newest posted" }]} className="w-full sm:ml-auto sm:w-44" />
            <div className="col-span-2 flex items-center gap-2 px-1 sm:col-span-1">
              <Checkbox id="only-relevant" checked={onlyRelevant} onCheckedChange={(v) => setOnlyRelevant(v === true)} />
              <Label htmlFor="only-relevant" className="flex min-h-6 items-center text-[13px]">Only jobs that fit me</Label>
            </div>
            <div className="col-span-2 flex items-center gap-2 px-1 sm:col-span-1">
              <Checkbox id="verified-only" checked={verifiedOnly} onCheckedChange={(v) => setVerifiedOnly(v === true)} />
              <Label htmlFor="verified-only" className="flex min-h-6 items-center text-[13px]">Verified openings only</Label>
            </div>
          </div>
          <p className="min-h-4 text-xs text-muted-foreground">
            {POSTED_WINDOWS.find((p) => p.value === posted)?.help}
            {loc === "mine" && myLocations.length > 0 ? ` My locations: ${myLocations.join(", ")}.` : ""}
          </p>
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
        <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>}>
          {error}
        </Banner>
      )}
      {!startups && !error && <PageSkeleton variant="cards" count={6} />}

      {startups && (
        <>
          <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
            <b className="font-semibold text-foreground">{jobs.length}</b> job{jobs.length === 1 ? "" : "s"}
            {olderHidden > 0 && (
              <>
                {" · "}
                <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setPosted("any")}>
                  {olderHidden} older role{olderHidden === 1 ? "" : "s"} still listed. Show them
                </button>
              </>
            )}
          </p>
          {jobs.length === 0 ? (
            startups.length === 0 ? (
              <EmptyState icon={BriefcaseBusinessIcon} title="No jobs yet" actions={<Link href="/discover?tab=startups" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">See startups</Link>}>
                Sources have not returned any jobs yet. Check the data-freshness line above, or look at recently funded startups.
              </EmptyState>
            ) : (
              <EmptyState
                icon={SearchIcon}
                title="No jobs match these filters"
                actions={
                  <>
                    {onlyRelevant && <Button variant="outline" onClick={() => setOnlyRelevant(false)}>Include weaker matches</Button>}
                    {loc === "mine" && myLocations.length > 0 && <Button variant="outline" onClick={() => setLoc("any")}>Look anywhere, not just {myLocations.slice(0, 2).join(", ")}</Button>}
                    {posted !== "any" && <Button variant="outline" onClick={() => setPosted("any")}>Show older listings</Button>}
                    <Button variant="outline" onClick={reset}>Clear filters</Button>
                  </>
                }
              >
                Try a different role, widen the posted window, or look anywhere.
              </EmptyState>
            )
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-4">
                {paginated.map(({ j, s }) => (
                  <JobCard key={j.id} job={j} showCompany={s.name} funding={s} startup={s} application={s.applications.find((a) => a.job_id === j.id)} onChanged={load} />
                ))}
              </div>
              <div className="border-t border-border/60 pt-4">
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
            </>
          )}
        </>
      )}
    </div>
  );
}
