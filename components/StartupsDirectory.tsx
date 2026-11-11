"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StartupView } from "@/lib/types";
import { useRouter } from "next/navigation";
import { activeFilterChips, applyFilters, DEFAULT_FILTERS, Filters, filtersForProfile, type FilterState } from "./Filters";
import { StartupCard } from "./StartupCard";
import { Summary, type SummaryPick } from "./Summary";
import { Pagination } from "./Pagination";
import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  CancelIcon,
  FileTextIcon,
  Loader2Icon,
  RotateCcwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  type IconComponent,
} from "@/components/icons";
import { api } from "./api";
import { Banner } from "./Banner";
import { PageSkeleton } from "./PageSkeleton";
import { EmptyState } from "./EmptyState";
import { SelectField } from "./SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLive } from "@/components/live";
import { DataFreshness } from "@/components/DataFreshness";

interface RunState {
  running: boolean;
  log: string[];
  finishedAt: string | null;
  stats: { startups: number; created: number; updated: number; newJobs: number; errors: number };
}

const FILTER_KEY = "dsf.filters.v1";

const SORTS: [FilterState["sort"], string][] = [
  ["match", "Best match for me"],
  ["relevant_jobs", "Most jobs that fit me"],
  ["discovered", "Newest found"],
  ["funding", "Most recently funded"],
  ["founded", "Youngest startups"],
];

const HOW_IT_WORKS: [IconComponent, string, string][] = [
  [SearchIcon, "We find startups", "From Y Combinator, Google funding news, job boards and company careers pages."],
  [FileTextIcon, "We match them to you", "Every job is scored on role, skills, location and experience."],
  [BriefcaseBusinessIcon, "You apply and reach out", "Open the job, generate an AI pitch, and contact founders directly."],
];

function ago(iso: string) {
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
}

export function StartupsDirectory({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const [startups, setStartups] = useState<StartupView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<FilterState>(DEFAULT_FILTERS);
  const [defaults, setDefaults] = useState<FilterState>(DEFAULT_FILTERS);
  const [run, setRun] = useState<RunState | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [explorer, setExplorer] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Pagination state (10, 20, 30 per page)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const filtersReady = useRef(false);

  const load = useCallback(async () => {
    const { ok, status, data, error } = await api("/api/startups");
    if (status === 401) {
      router.replace("/onboarding");
      return;
    }
    if (!ok) setError(error);
    else {
      setError(null);
      setStartups(data.startups);
      setLastRunAt(data.lastRun?.started_at ?? null);
      setName((data.profile?.name as string) || null);
      setExplorer(!!data.profile?.explorer);
      if (!filtersReady.current) {
        filtersReady.current = true;
        const d = filtersForProfile(data.profile);
        setDefaults(d);
        let saved: Partial<FilterState> | null = null;
        try {
          const raw = localStorage.getItem(FILTER_KEY);
          if (raw) saved = JSON.parse(raw);
        } catch {}
        setF(saved ? { ...d, ...saved } : d);
      }
    }
  }, [router]);

  const watchRun = useCallback(() => {
    if (poll.current) return;
    poll.current = setInterval(async () => {
      const { ok, data: s } = await api<RunState>("/api/discover");
      if (!ok) return;
      setRun(s);
      if (!s.running) {
        clearInterval(poll.current!);
        poll.current = null;
        load();
      }
    }, 2000);
  }, [load]);

  useEffect(() => {
    load();
    // Read once on the client; useSearchParams would force this whole page to client-render behind a Suspense bailout.
    if (new URLSearchParams(window.location.search).get("welcome") === "1") {
      router.replace("/discover?tab=startups");
      findToday(true);
    }
    api<RunState>("/api/discover").then(({ ok, data: s }) => {
      if (ok && s.running) {
        setRun(s);
        watchRun();
      }
    });
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, watchRun]);

  function setFilters(next: FilterState) {
    setF(next);
    setPage(1); // Reset to first page on filter change
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {}
  }

  async function findToday(welcome = false) {
    setNotice(null);
    const { ok, data, error } = await api("/api/discover", { method: "POST" });
    if (!ok) {
      setError(error);
      return;
    }
    if (data.upToDate) {
      setNotice(
        welcome
          ? `Welcome! Here are startups matched to your profile, from a search ${ago(data.lastRunAt)} ago.`
          : `You're up to date. We last checked ${ago(data.lastRunAt)} ago, so try again later for new startups.`
      );
      return;
    }
    if (welcome) setNotice("Welcome! We're finding startups for you now.");
    setRun(data);
    watchRun();
  }

  useLive(load); // reloads by itself when a background refresh finishes

  const viewList = useMemo(() => (startups ?? []).filter((s) => f.view === "all" || s.is_fresh), [startups, f.view]);
  const shown = useMemo(() => applyFilters(startups ?? [], f), [startups, f]);
  const chips = activeFilterChips(f, setFilters);

  // Paginated slice for current page
  const paginatedStartups = useMemo(() => {
    const start = (page - 1) * pageSize;
    return shown.slice(start, start + pageSize);
  }, [shown, page, pageSize]);

  function pickSummary(p: SummaryPick) {
    const base: FilterState = {
      ...DEFAULT_FILTERS,
      view: f.view,
      sort: f.sort,
      locations: [],
      hiringOnly: false,
      matchingOnly: false,
      relevance: [],
      emailOnly: false,
      levels: [],
      types: [],
    };
    const by: Record<SummaryPick, Partial<FilterState>> = {
      all: {},
      great: { relevance: ["strong"], sort: "match" },
      good: { relevance: ["potential"], sort: "match" },
      jobs: { hiringOnly: true, sort: "relevant_jobs" },
      ai: { types: ["AI"] },
      funded: { funding: ["funded_180"], sort: "funding" },
      new: { age: ["new"], sort: "founded" },
      email: { emailOnly: true },
    };
    setFilters({ ...base, ...by[p] });
    setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const loosen = useMemo(() => {
    if (!startups?.length || shown.length) return [];
    const options: [string, FilterState][] = [
      ["Show all startups, not just new & updated", { ...f, view: "all" }],
      ["Include startups with no open jobs found", { ...f, hiringOnly: false }],
      ["Any funding date", { ...f, funding: [] }],
      ["Any location", { ...f, locations: [] }],
      ["Any job role", { ...f, roles: [] }],
      ["Any experience level", { ...f, levels: [] }],
      ["Any startup type", { ...f, types: [] }],
      ["Any startup age", { ...f, age: [] }],
      ["Not only jobs that fit me", { ...f, matchingOnly: false }],
      ["Any match level", { ...f, relevance: [] }],
      ["Not only startups with an email", { ...f, emailOnly: false }],
      ["Clear the search", { ...f, search: "" }],
    ];
    return options
      .filter(([, next]) => JSON.stringify(next) !== JSON.stringify(f))
      .map(([label, next]) => ({ label, next, count: applyFilters(startups, next).length }))
      .filter((o) => o.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }, [startups, shown.length, f]);

  const lastRunLabel = lastRunAt ? new Date(lastRunAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
  const freshCount = (startups ?? []).filter((s) => s.is_fresh).length;
  const stale = !!(startups?.length && lastRunAt && new Date(lastRunAt).toDateString() !== new Date().toDateString());
  const running = !!run?.running;

  let banner: React.ReactNode = null;
  if (error)
    banner = (
      <Banner
        tone="error"
        action={
          <Button size="sm" variant="outline" onClick={() => load()}>
            Try again
          </Button>
        }
        onDismiss={() => setError(null)}
      >
        {error}
      </Banner>
    );
  else if (running && startups?.length)
    banner = (
      <Banner tone="progress">
        <b className="font-semibold">Finding fresh startups for you.</b> Hang tight, this only takes a few minutes. Keep browsing and new results will appear on their own.
      </Banner>
    );
  else if (notice) banner = <Banner onDismiss={() => setNotice(null)}>{notice}</Banner>;
  else if (stale)
    banner = (
      <Banner
        tone="warn"
        action={
          <Button size="sm" variant="outline" onClick={() => findToday()}>
            Check now
          </Button>
        }
      >
        These results are from <b className="font-semibold">{lastRunLabel}</b>. Click <b className="font-semibold">Find Startups Today</b> for fresh ones.
      </Banner>
    );

  const filterPanel = <Filters f={f} set={setFilters} defaults={defaults} />;

  return (
    <div className="space-y-6">
      <header className={embedded ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-center sm:justify-between"}>
        <div className="min-w-0">
          {!embedded && <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Recently funded startups</h1>}
          <p className="mt-1 text-sm text-muted-foreground">
            {startups && startups.length > 0
              ? `${startups.length} startups · ranked by your skills and preferences. `
              : "Recently funded startups, matched to your profile. "}
            A funding round is a signal, not an open role: each company shows whether we found a real opening.
            {lastRunLabel ? ` Last checked ${lastRunLabel}.` : ""}
          </p>
        </div>
        <Button onClick={() => findToday()} disabled={running} variant="outline" className="w-full shrink-0 sm:w-auto">
          {running ? <Loader2Icon className="size-4 animate-spin" /> : <RotateCcwIcon className="size-4" />}
          {running ? "Refreshing…" : "Refresh results"}
        </Button>
      </header>

      <DataFreshness />

      {banner}

      {explorer && (
        <Banner
          action={
            <Button size="sm" onClick={() => router.push("/onboarding")}>
              Add my skills
            </Button>
          }
        >
          <b className="font-semibold">You&apos;re exploring recently funded startups.</b> Add your skills and we&apos;ll show the jobs that fit you.
        </Banner>
      )}

      {startups && startups.length > 0 && (
        <Summary
          list={viewList}
          label={f.view === "today" ? `Found in latest search${lastRunLabel ? ` (${lastRunLabel})` : ""}` : "All startups discovered"}
          onPick={pickSummary}
        />
      )}

      {!startups && !error && <PageSkeleton variant="cards" count={6} />}

      {startups && startups.length === 0 && (
        <Card className="border-dashed border-2">
          <CardHeader>
            <CardTitle className="text-xl">{running ? "Finding startups for you…" : "Let's find your first startups"}</CardTitle>
            <CardDescription className="max-w-lg">
              {running ? "Hang tight, this only takes a few minutes. Results show up here on their own, so you can leave this page open." : "One click checks the latest startups and matches their jobs to your profile."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ol className="grid gap-3 sm:grid-cols-3">
              {HOW_IT_WORKS.map(([Icon, title, body], i) => (
                <li key={title} className="rounded-xl border border-border/60 bg-muted/40 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-background text-accent-brand-foreground shadow-xs ring-1 ring-border">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Step {i + 1}</span>
                  </div>
                  <div className="mt-3 text-sm font-semibold">{title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
            {!running && (
              <Button size="lg" onClick={() => findToday()} className="bg-brand-gradient text-white hover:opacity-90">
                <SearchIcon /> Find startups now
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main Results Layout with 2 Cards Per Row */}
      {startups && startups.length > 0 && (
        <div id="results" className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Sticky filter sidebar */}
          <aside aria-label="Filters" className="hidden lg:block">
            <div className="scroll-thin sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain pr-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Filters</h2>
                {chips.length > 0 && (
                  <Button variant="ghost" size="xs" onClick={() => setFilters(defaults)} className="text-xs text-muted-foreground">
                    Reset
                  </Button>
                )}
              </div>
              {filterPanel}
            </div>
          </aside>

          {/* Results section */}
          <section aria-label="Startups" className="min-w-0 space-y-4">
            {/* Search and filter controls */}
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground size-4" />
                <Input
                  type="search"
                  aria-label="Search startups and job titles"
                  value={f.search}
                  onChange={(e) => setFilters({ ...f, search: e.target.value })}
                  placeholder="Search startups, keywords, or job titles..."
                  className="pl-9 h-10"
                />
              </div>
              <Button
                variant="outline"
                size="default"
                className="shrink-0 lg:hidden"
                onClick={() => setShowFilters(true)}
                aria-haspopup="dialog"
              >
                <SlidersHorizontalIcon />
                Filters
                {chips.length > 0 && (
                  <Badge className="tabular-nums ml-1" aria-label={`${chips.length} active`}>
                    {chips.length}
                  </Badge>
                )}
              </Button>
            </div>

            {/* View tabs and sort dropdown */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Tabs value={f.view} onValueChange={(v) => setFilters({ ...f, view: v as FilterState["view"] })}>
                <TabsList aria-label="Which startups" className="h-9">
                  {(
                    [
                      ["today", "New & updated", freshCount, "Startups that are new, or have new jobs or funding, in the latest check"],
                      ["all", "All", startups?.length ?? 0, "Everything found so far"],
                    ] as const
                  ).map(([v, label, n, hint]) => (
                    <TabsTrigger key={v} value={v} title={hint} className="px-3 text-xs">
                      {label} <span className="ml-1 font-normal text-muted-foreground tabular-nums">({n})</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="hidden sm:inline">Sort by</span>
                <SelectField
                  aria-label="Sort by"
                  value={f.sort}
                  onValueChange={(v) => setFilters({ ...f, sort: v as FilterState["sort"] })}
                  options={SORTS.map(([value, label]) => ({ value, label }))}
                  className="min-w-44 h-9 text-xs"
                />
              </div>
            </div>

            {/* Active chips */}
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <Button key={c.key} variant="outline" size="xs" className="rounded-full pr-1.5 text-xs" onClick={c.remove} aria-label={`Remove filter: ${c.label}`}>
                    {c.label}
                    <CancelIcon className="size-3 text-muted-foreground ml-1" />
                  </Button>
                ))}
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => setFilters({ ...DEFAULT_FILTERS, locations: [], hiringOnly: false, view: f.view, sort: f.sort })}
                  className="text-xs text-muted-foreground"
                >
                  Clear all
                </Button>
              </div>
            )}

            {/* Count & Pagination overview */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <p aria-live="polite">
                Showing <b className="font-semibold text-foreground">{shown.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, shown.length)}</b> of{" "}
                <b className="font-semibold text-foreground">{shown.length}</b> startup{shown.length === 1 ? "" : "s"}
              </p>
            </div>

            {shown.length === 0 && (
              <EmptyState
                icon={SearchIcon}
                title="No startups match all of these filters together"
                actions={
                  <div className="flex w-full flex-col items-center gap-2">
                    {loosen.map((o) => (
                      <Button key={o.label} variant="outline" onClick={() => setFilters(o.next)}>
                        {o.label}
                        <Badge variant="secondary" className="tabular-nums ml-2">
                          {o.count}
                        </Badge>
                      </Button>
                    ))}
                    <Button variant="ghost" onClick={() => setFilters(defaults)}>
                      Reset filters
                    </Button>
                  </div>
                }
              >
                {loosen.length > 0 ? "Try loosening one of them:" : "Try removing a filter above."}
              </EmptyState>
            )}

            {/* 2 Cards Per Row Grid */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-4">
              {paginatedStartups.map((s) => (
                <StartupCard key={s.id} s={s} onChanged={load} />
              ))}
            </div>

            {/* Pagination Controls */}
            {shown.length > 0 && (
              <div className="pt-6 border-t border-border/60">
                <Pagination
                  total={shown.length}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={(p) => {
                    setPage(p);
                    document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  onPageSizeChange={(sz) => {
                    setPageSize(sz);
                    setPage(1);
                  }}
                />
              </div>
            )}
          </section>
        </div>
      )}

      {/* Phone filters sheet */}
      <Sheet open={showFilters} onOpenChange={setShowFilters}>
        <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl lg:hidden">
          <SheetHeader className="border-b pb-3">
            <SheetTitle className="text-base font-semibold">Filters</SheetTitle>
            <SheetDescription className="text-xs">
              {shown.length} startup{shown.length === 1 ? "" : "s"} match right now.
            </SheetDescription>
          </SheetHeader>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{filterPanel}</div>
          <SheetFooter className="border-t pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button size="lg" className="w-full bg-brand-gradient text-white hover:opacity-90" onClick={() => setShowFilters(false)}>
              Show {shown.length} startup{shown.length === 1 ? "" : "s"} <ArrowRightIcon />
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
