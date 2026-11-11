"use client";
import { useLive } from "./live";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { Banner } from "./Banner";
import { EmptyState } from "./EmptyState";
import { ExternalLinkIcon, NewspaperIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton, RefreshShimmer } from "@/components/Skeleton";
import { useBackgroundRefresh } from "@/components/DataFreshness";
import { FilterBar } from "./funding/FilterBar";
import { StoryCard } from "./funding/StoryCard";
import { DEFAULT_FILTERS, fmtDate, type Filters, type NewsResponse } from "./funding/types";

/**
 * Funding news from stored articles. `compact` is the dashboard preview. Every article shows its publisher,
 * the publisher's date (or "No date given"), and when we last checked it. Nothing here is a live search.
 */
export function FundingNews({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<NewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bgRefresh = useBackgroundRefresh();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS); // default: completed raises only. Talks and unconfirmed stories are one click away.
  const [page, setPage] = useState(1);
  const [sug, setSug] = useState<{ loading: boolean; method?: string; message?: string | null; items: { id: number; reason: string; headline: string; publisher: string; url: string }[] } | null>(null);
  const suggest = async () => {
    setSug({ loading: true, items: [] });
    const r = await api<any>("/api/news/suggest", { method: "POST", timeoutMs: 50_000 });
    setSug(r.ok ? { loading: false, method: r.data.method, message: r.data.message, items: r.data.suggestions } : { loading: false, message: "Suggestions are unavailable right now.", items: [] });
  };
  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: compact ? "3" : "12", page: String(page) });
    if (filters.publisher !== "all") qs.set("publisher", filters.publisher);
    if (filters.range !== "any") qs.set("days", filters.range);
    if (filters.verification === "verified") qs.set("verification", "verified");
    else if (filters.verification === "confirmed") qs.set("kind", "confirmed");
    if (filters.city !== "all") qs.set("city", filters.city);
    if (filters.sector !== "all") qs.set("sector", filters.sector);
    if (filters.round !== "all") qs.set("round", filters.round);
    if (filters.investor !== "all") qs.set("investor", filters.investor);
    if (filters.hiring) qs.set("hiring", "1");
    if (filters.sort === "amount") qs.set("sort", "amount");
    const res = await api<NewsResponse>(`/api/news?${qs}`);
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else setError(res.error);
    setLoading(false);
  }, [compact, filters, page]);

  useEffect(() => {
    load();
  }, [load]);
  useLive(() => {
    load();
  });

  // First load only: a skeleton shaped like the feed. Later reloads and filter changes keep the stories in place.
  if (!data && !error) return compact ? <Skeleton variant="list" count={3} /> : <Skeleton variant="news-grid" count={6} />;

  if (error && !data)
    return (
      <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>}>
        Funding news is unavailable right now. {error}
      </Banner>
    );
  if (!data) return null;

  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const filtered = JSON.stringify({ ...filters, verification: "" }) !== JSON.stringify({ ...DEFAULT_FILTERS, verification: "" }) || filters.verification !== "confirmed";

  return (
    <RefreshShimmer active={(loading || bgRefresh) && !!data} className="no-refresh-sweep space-y-3">
      {!compact && data.state === "ok" && <FilterBar data={data} filters={filters} set={set} onReload={load} />}

      {data.state === "ok" && data.source_notes && data.source_notes.length > 0 && (
        <p className="text-xs text-warning" role="status">
          {data.source_notes[0].message}
          {data.serving_cache && " Other sources are still being shown."}
        </p>
      )}
      {data.state === "ok" && (
        <p className="text-xs text-muted-foreground" role="status">
          {data.total} stor{data.total === 1 ? "y" : "ies"}{filtered ? (data.total === 1 ? " matches your filters" : " match your filters") : ""}. Dates are the publisher&apos;s; a story without one says so. A funding story is not proof of an open role.
          {data.last_checked_at && <> Last checked {fmtDate(data.last_checked_at)}.</>}
        </p>
      )}

      {data.state !== "ok" ? (
        <div className="space-y-3">
          <EmptyState icon={NewspaperIcon} title={data.state === "unavailable" ? "Funding news is unavailable right now" : "No verified funding articles yet"}>
            {data.message}
          </EmptyState>
          {data.directory && !compact && (
            <div className="rounded-md border border-border bg-card p-4 text-sm">
              <p className="mb-2 font-medium">Source directory (publisher sites, not news items)</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {data.directory.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1 text-accent-brand-foreground hover:underline">
                      {d.name} <ExternalLinkIcon className="size-3" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : data.articles.length === 0 ? (
        <EmptyState
          icon={NewspaperIcon}
          title="No stories match these filters"
          actions={filtered ? <Button size="sm" variant="outline" onClick={() => set({ ...DEFAULT_FILTERS, verification: "all" })}>Show everything</Button> : undefined}
        >
          Stories with no publication date are left out of date ranges, and a story with no stated city is not matched by a city filter. Remove a filter or choose &quot;Include unconfirmed&quot;.
        </EmptyState>
      ) : (
        <>
          {!compact && (
            <div className="mb-3 space-y-2">
              <Button size="sm" variant="outline" onClick={suggest} disabled={sug?.loading}>{sug?.loading ? "Looking…" : "Suggest stories for my profile"}</Button>
              {sug && !sug.loading && (
                <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-sm" role="status">
                  {sug.items.length ? (
                    <>
                      <p className="mb-1 text-xs text-muted-foreground">{sug.method === "ai" ? "Picked by an AI model from the stories below; it only ranks them." : "Matched by words from your profile."} A funding story does not mean a company is hiring.</p>
                      <ul className="space-y-1">{sug.items.map((x) => <li key={x.id}><a href={x.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{x.headline}</a> <span className="text-muted-foreground">· {x.publisher} · {x.reason}</span></li>)}</ul>
                    </>
                  ) : <p className="text-muted-foreground">{sug.message ?? "No suggestions."}</p>}
                </div>
              )}
            </div>
          )}
          {(() => {
            const lead = !compact && page === 1 ? data.articles[0] : null;
            const rest = lead ? data.articles.slice(1) : data.articles;
            const handlers = { onCity: (city: string) => set({ city }), onSector: (sector: string) => set({ sector }) };
            return (
              <div className="grid gap-x-10 lg:grid-cols-12">
                {lead && (
                  <ul className="rule-top mb-6 lg:col-span-12" aria-label="Featured story">
                    <StoryCard key={lead.id} a={lead} compact={false} featured {...handlers} />
                  </ul>
                )}
                <ul className={compact ? "lg:col-span-12" : "border-t border-foreground/80 lg:col-span-12 lg:columns-2 lg:gap-x-10 [&>li]:break-inside-avoid"} aria-label="Recent funding stories">
                  {rest.map((a) => (
                    <StoryCard key={a.id} a={a} compact={compact} {...handlers} />
                  ))}
                </ul>
              </div>
            );
          })()}
        </>
      )}

      {!compact && data.state === "ok" && pages > 1 && (
        <nav className="flex items-center justify-between pt-1" aria-label="News pages">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </nav>
      )}
    </RefreshShimmer>
  );
}
