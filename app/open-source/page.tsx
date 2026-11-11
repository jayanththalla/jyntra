"use client";
// Open source: GitHub repos of YC open-source companies and popular projects, each with one suggested
// beginner issue. Data comes from YC (company list + GitHub account) and GitHub's public search. Nothing is invented.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton, RefreshShimmer } from "@/components/Skeleton";
import { useLive } from "@/components/live";
import { DataFreshness, useBackgroundRefresh } from "@/components/DataFreshness";
import { api } from "@/components/api";
import { Chip } from "@/components/Chip";
import { SelectField } from "@/components/SelectField";
import { Banner } from "@/components/Banner";
import { EmptyState } from "@/components/EmptyState";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ProgramsGuide } from "@/components/oss/ProgramsGuide";
import { Pagination } from "@/components/Pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckIcon, CircleAlertIcon, ExternalLinkIcon, FilterXIcon, GithubIcon, GlobeIcon, Loader2Icon, MessageSquareIcon, RotateCwIcon, SearchIcon, SparklesIcon, StarIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { COLLECTIONS, COLLECTION_BY_ID, DIFFICULTY_LABELS, FRESHNESS, difficultyOf, updatedWithin } from "@/lib/oss/filters";

interface Project {
  repo: string;
  /** 'yc' = a YC open-source company's repo; 'popular' = an active, well-starred GitHub project. */
  origin: "yc" | "popular";
  stars: number | null;
  language: string | null;
  repo_description: string | null;
  collections: string[];
  github_org: string;
  company_name: string;
  company_yc_url: string | null;
  company_website: string | null;
  one_liner: string | null;
  yc_batch: string | null;
  hiring: boolean;
  beginner_issues: number;
  issue_title: string;
  issue_url: string;
  issue_labels: string[];
  issue_comments: number;
  issue_updated_at: string | null;
}
interface Stats {
  companies: number;
  with_github: number;
  last_search: string | null;
}


interface RunSource { name: string; state: "pending" | "running" | "done" | "failed"; note?: string }
interface RunStatus { running: boolean; startedAt: string | null; finishedAt: string | null; stats?: { startups: number; errors: number }; sources?: RunSource[] }

const STALE_DAYS = 3;

const daysAgo = (date: string) => {
  const d = Math.round((Date.now() - new Date(date).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

/** Only links on github.com, so a stored URL can never point elsewhere. */
const gh = (url: string | null) => (url && /^https:\/\/github\.com\//i.test(url) ? url : null);
const beginnerIssuesUrl = (repo: string) =>
  `https://github.com/${repo}/issues?q=${encodeURIComponent('is:issue is:open no:assignee label:"good first issue"')}`;
const recentBatch = (b: string | null) => !!b && /(2025|2026)/.test(b);
/** 96235 → "96k". */
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** A plain-language hint from facts we have (labels, comments), never a made-up difficulty score. */
function issueHint(p: Project): string {
  const labels = p.issue_labels.map((l) => l.toLowerCase());
  const base = labels.some((l) => l.includes("good first")) ? "Marked good first issue" : labels.some((l) => l.includes("help wanted")) ? "Maintainers want help" : "Open and unassigned";
  const talk = p.issue_comments === 0 ? "nobody has commented yet" : p.issue_comments <= 3 ? "light discussion" : "active discussion, read it first";
  return `${base} · ${talk}`;
}

type Origin = "all" | "yc" | "popular";

const LANG_DOT = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];
const langDot = (l: string) => LANG_DOT[[...l].reduce((n, c) => n + c.charCodeAt(0), 0) % LANG_DOT.length];

/** One repository as a dense row (GitHub-style list): repo and metadata on the left, the suggested issue and actions on the right. */
function ProjectCard({ p }: { p: Project }) {
  const [owner, name] = p.repo.split("/");
  const issueUrl = gh(p.issue_url);
  const desc = p.one_liner || p.repo_description;
  const m = /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(issueUrl ?? "");
  const d = difficultyOf(p);
  return (
    <article className="grid gap-x-8 gap-y-3 border-b border-border py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <a href={`https://github.com/${p.repo}`} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 font-mono text-[15px] font-semibold text-accent-brand-foreground hover:underline">
          <GithubIcon className="size-4 shrink-0 text-foreground" />
          <span className="min-w-0 break-all"><span className="font-normal text-muted-foreground">{owner}/</span>{name}</span>
        </a>
        {desc && <p className="line-clamp-2 text-sm text-muted-foreground">{desc}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
          {p.language && <span className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", langDot(p.language))} aria-hidden />{p.language}</span>}
          {p.stars != null && <span className="inline-flex items-center gap-1" title={`${p.stars.toLocaleString("en-IN")} stars`}><StarIcon className="size-3.5" />{compact(p.stars)}</span>}
          <span>{p.beginner_issues} good first issue{p.beginner_issues === 1 ? "" : "s"}</span>
          {p.origin === "yc" ? (
            <span className="text-foreground">{p.company_yc_url ? <a href={p.company_yc_url} target="_blank" rel="noreferrer" className="hover:underline">{p.company_name}</a> : p.company_name}{p.yc_batch && ` · YC ${p.yc_batch}`}</span>
          ) : <span>popular on GitHub</span>}
          {p.hiring && <span className="rounded-sm border border-success/50 px-1.5 text-success">hiring</span>}
          {p.collections?.map((id) => <span key={id} title={COLLECTION_BY_ID.get(id)?.basis} className="rounded-sm border border-border px-1.5">{COLLECTION_BY_ID.get(id)?.label ?? id}</span>)}
        </div>
      </div>

      <div className="min-w-0 space-y-2 border-l-2 border-border pl-4">
        <p className="eyebrow !text-muted-foreground">Suggested issue</p>
        {issueUrl ? (
          <a href={issueUrl} target="_blank" rel="noreferrer" className="line-clamp-2 block text-sm font-medium leading-snug hover:underline">{p.issue_title}</a>
        ) : <p className="line-clamp-2 text-sm font-medium leading-snug">{p.issue_title}</p>}
        <p className="text-xs text-muted-foreground">
          {d && <span title={d.basis} className="font-medium text-foreground">{DIFFICULTY_LABELS[d.level]} · </span>}
          {issueHint(p)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          {p.issue_labels.slice(0, 3).map((l) => <span key={l} className="rounded-sm border border-border px-1.5 py-0.5">{l}</span>)}
          <span className="inline-flex items-center gap-1"><MessageSquareIcon className="size-3" />{p.issue_comments}</span>
          {p.issue_updated_at && <span>updated {daysAgo(p.issue_updated_at)}</span>}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {m && <Link href={`/open-source/contribute?repo=${encodeURIComponent(m[1]!)}&issue=${m[2]}`} className={cn(buttonVariants({ size: "sm" }), "h-8")}>Start contribution</Link>}
          {issueUrl && <a href={issueUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}>Open issue <ExternalLinkIcon /></a>}
          {p.beginner_issues > 1 && <a href={beginnerIssuesUrl(p.repo)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8")}>All issues</a>}
          {/^https?:\/\//i.test(p.company_website ?? "") && <a href={p.company_website!} target="_blank" rel="noreferrer" aria-label="Company website" className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8")}><GlobeIcon /></a>}
        </div>
      </div>
    </article>
  );
}

const SEGMENTS: { v: Origin; label: string }[] = [
  { v: "all", label: "All" },
  { v: "yc", label: "YC" },
  { v: "popular", label: "Popular" },
];

export default function OpenSourcePage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hiring, setHiring] = useState(false);
  const [recent, setRecent] = useState(false);
  const [origin, setOrigin] = useState<Origin>("all");
  const [language, setLanguage] = useState("all");
  const [collection, setCollection] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [fresh, setFresh] = useState("any");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const wasRunning = useRef(false);
  const bgRefresh = useBackgroundRefresh();

  const load = useCallback(async () => {
    setLoading(true);
    const { ok, data, error } = await api<{ projects: Project[]; stats: Stats }>("/api/open-source");
    setLoading(false);
    if (!ok) return setError(error);
    setError(null);
    setProjects(data.projects ?? []);
    setStats(data.stats ?? null);
  }, []);

  const pollRun = useCallback(async () => {
    const { ok, data } = await api<RunStatus>("/api/discover", { timeoutMs: 10_000 });
    if (ok) setRun(data);
    return ok ? data : null;
  }, []);

  useEffect(() => {
    load();
    pollRun();
  }, [load, pollRun]);
  useLive(load);

  // While a refresh runs, check its progress every few seconds; reload the list once it finishes.
  const running = !!run?.running;
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        load();
      }
      return;
    }
    wasRunning.current = true;
    const t = setInterval(pollRun, 4000);
    return () => clearInterval(t);
  }, [running, pollRun, load]);

  async function findNew() {
    setRunError(null);
    const r = await api<RunStatus & { upToDate?: boolean }>("/api/discover", { method: "POST", timeoutMs: 15_000 });
    if (!r.ok) return setRunError(r.error);
    setRun(r.data);
    if (r.data.upToDate) load();
  }

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (projects ?? []).filter(
      (p) =>
        (origin === "all" || p.origin === origin) &&
        (language === "all" || p.language === language) &&
        (collection === "all" || (p.collections ?? []).includes(collection)) &&
        (difficulty === "all" || (difficulty === "unrated" ? !difficultyOf(p) : difficultyOf(p)?.level === difficulty)) &&
        updatedWithin(p.issue_updated_at, FRESHNESS.find((f) => f.value === fresh)?.days ?? null) &&
        (!hiring || p.hiring) &&
        (!recent || recentBatch(p.yc_batch)) &&
        (!query || `${p.repo} ${p.company_name} ${p.one_liner ?? ""} ${p.repo_description ?? ""} ${p.issue_title}`.toLowerCase().includes(query))
    );
  }, [projects, q, hiring, recent, origin, language, collection, difficulty, fresh]);

  const languages = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of projects ?? []) if (p.language) count.set(p.language, (count.get(p.language) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  }, [projects]);
  const counts = { all: projects?.length ?? 0, yc: (projects ?? []).filter((p) => p.origin === "yc").length, popular: (projects ?? []).filter((p) => p.origin === "popular").length };

  const narrowed = !!q || hiring || recent || origin !== "all" || language !== "all" || collection !== "all" || difficulty !== "all" || fresh !== "any";
  const collectionCounts = useMemo(() => new Map(COLLECTIONS.map((c) => [c.id, (projects ?? []).filter((p) => p.collections?.includes(c.id)).length])), [projects]);
  const reset = () => {
    setQ("");
    setHiring(false);
    setRecent(false);
    setOrigin("all");
    setLanguage("all");
    setCollection("all");
    setDifficulty("all");
    setFresh("any");
    setPage(1);
  };
  const on = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const checkedAge = stats?.last_search ? Math.round((Date.now() - new Date(stats.last_search).getTime()) / 86_400_000) : null;
  const neverChecked = !!projects && !loading && !error && !stats?.last_search; // only after the first load has finished
  const stale = checkedAge != null && checkedAge >= STALE_DAYS;

  return (
    <div className="space-y-5">
      <PageHeader
        art="/illustrations/3d/heart.png"
        eyebrow="Open source"
        title="Find your first contribution"
        subtitle={
          <>
            Discover beginner-friendly issues across popular open-source projects. Get AI-powered insights to start contributing with confidence.
            {stats?.last_search && <span className="mt-0.5 block text-xs">GitHub last checked {daysAgo(stats.last_search)}</span>}
          </>
        }
        actions={
          <Button variant="outline" className="h-10" onClick={load} disabled={loading}>
            {loading ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
            Reload
          </Button>
        }
      />
      <ProgramsGuide />
      <DataFreshness />

      {error && (
        <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>}>
          {error}
        </Banner>
      )}

      {/* Refresh status: while a search runs the list keeps showing and gets a light shimmer; no banner, no wait message. */}
      {running && <span className="sr-only" role="status" aria-live="polite">Finding new projects. Results appear here when it finishes.</span>}
      {!running && (neverChecked || stale) && (
        <Banner tone="warn" action={<Button size="sm" onClick={findNew}><SparklesIcon /> Find new projects</Button>}>
          {neverChecked ? "Projects haven't been searched for yet." : `This list was last refreshed ${checkedAge} days ago.`} A search takes a few minutes.
        </Banner>
      )}
      {runError && <Banner tone="error" onDismiss={() => setRunError(null)}>{runError}</Banner>}
      {!running && run?.finishedAt && run.stats && run.stats.errors > 0 && (
        <Banner tone="warn">Last search finished with {run.stats.errors} source error{run.stats.errors === 1 ? "" : "s"}, so the list may be incomplete.</Banner>
      )}

      {/* Filter bar: shown once there is data to filter. */}
      {projects && projects.length > 0 && (
        <div className="space-y-3 border-b border-border pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search projects" value={q} onChange={(e) => on(setQ)(e.target.value)} placeholder="Search a repo, company or issue" className="h-10 pl-9" />
            </div>
            <div role="radiogroup" aria-label="Project type" className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted p-0.5 md:w-auto">
              {SEGMENTS.map((sg) => (
                <button
                  key={sg.v}
                  type="button"
                  role="radio"
                  aria-checked={origin === sg.v}
                  onClick={() => on(setOrigin)(sg.v)}
                  className={cn("min-h-9 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors", origin === sg.v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {sg.label} <span className="text-xs opacity-60">{counts[sg.v]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {languages.length > 0 && (
              <SelectField aria-label="Language" value={language} onValueChange={on(setLanguage)} options={[{ value: "all", label: "Any language" }, ...languages.map((l) => ({ value: l, label: l }))]} />
            )}
            <SelectField aria-label="Issue difficulty" value={difficulty} onValueChange={on(setDifficulty)} options={[{ value: "all", label: "Any difficulty" }, { value: "easy", label: DIFFICULTY_LABELS.easy }, { value: "moderate", label: DIFFICULTY_LABELS.moderate }, { value: "hard", label: DIFFICULTY_LABELS.hard }, { value: "unrated", label: "Not rated" }]} />
            <SelectField aria-label="Issue freshness" value={fresh} onValueChange={on(setFresh)} options={FRESHNESS.map((f) => ({ value: f.value, label: f.label }))} />
            <Chip label="Company is hiring" on={hiring} onClick={() => on(setHiring)(!hiring)} title="The YC company has open jobs" />
            <Chip label="YC 2025–2026" on={recent} onClick={() => on(setRecent)(!recent)} title="Companies from the 2025 and 2026 YC batches" />
            {COLLECTIONS.map((c) => (
              <Chip key={c.id} label={`${c.label} ${collectionCounts.get(c.id) ?? 0}`} on={collection === c.id} onClick={() => on(setCollection)(collection === c.id ? "all" : c.id)} title={`${c.basis}. Check the programme's official site for this year's participating projects.`} />
            ))}
            {narrowed && (
              <Button variant="ghost" size="sm" className="h-9" onClick={reset}>
                <FilterXIcon /> Clear filters
              </Button>
            )}
          </div>
        </div>
      )}

      {!projects && !error && <Skeleton variant="card-list" count={5} />}

      {projects && (
        <RefreshShimmer active={loading || running || bgRefresh} className="no-refresh-sweep space-y-5">
          {projects.length > 0 && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <b className="font-semibold text-foreground">{shown.length}</b> project{shown.length === 1 ? "" : "s"}
              {narrowed && ` of ${projects.length}`}
            </p>
          )}

          {projects.length === 0 && !running && (
            <EmptyState
              icon={GithubIcon}
              title="No open-source projects yet"
              actions={<Button onClick={findNew}><SparklesIcon /> Find new projects</Button>}
            >
              Projects are found during a search of YC companies and GitHub. It takes a few minutes and results appear here on their own.
            </EmptyState>
          )}
          {projects.length > 0 && shown.length === 0 && (
            <EmptyState icon={SearchIcon} title="No projects match" actions={narrowed && <Button variant="outline" onClick={reset}>Clear filters</Button>}>
              Try a different search or turn off a filter.
            </EmptyState>
          )}

          <div className="border-t border-foreground/80">
            {shown.slice((page - 1) * pageSize, page * pageSize).map((p) => (
              <ProjectCard key={p.repo} p={p} />
            ))}
          </div>

          {shown.length > 0 && (
            <Pagination total={shown.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          )}

          {projects.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Issues are open, unassigned and labelled good first issue or help wanted. Read the issue and comment before starting, so the maintainers know you&apos;re on it.
            </p>
          )}
        </RefreshShimmer>
      )}
    </div>
  );
}
