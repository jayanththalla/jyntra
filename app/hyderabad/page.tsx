"use client";
// Hyderabad startup map: a searchable directory of ~1,200 Hyderabad startups from an open MIT dataset
// (github.com/shivtchandra/hydstartuplist). It refreshes by itself like the other pages.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { Banner } from "@/components/Banner";
import { DataFreshness } from "@/components/DataFreshness";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Pagination } from "@/components/Pagination";
import { SelectField } from "@/components/SelectField";
import { useLive } from "@/components/live";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ExternalLinkIcon, MapPinIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

interface Row {
  id: number;
  name: string;
  website: string | null;
  careers_url: string | null;
  description: string | null;
  location: string | null;
  industry: string | null;
  founded_year: number | null;
  tags: string[];
  open_jobs: number;
}
interface Reply {
  total: number;
  directoryTotal: number;
  industries: { name: string; n: number }[];
  startups: Row[];
  lastSeenAt: string | null;
  attribution: { name: string; license: string; url: string; map: string };
}

/** Street addresses in the dataset are long; the neighbourhood is what people look for. */
const shortPlace = (loc: string | null) => (loc ?? "").split(",").slice(-4, -2).map((p) => p.trim()).filter(Boolean).join(", ") || (loc ?? "").slice(0, 60);
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

export default function HyderabadMapPage() {
  const router = useRouter();
  const [data, setData] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [industry, setIndustry] = useState("all");
  const [hiring, setHiring] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Typing is debounced so each keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), limit: String(Math.min(pageSize, 30)) });
    if (term) qs.set("q", term);
    if (industry !== "all") qs.set("industry", industry);
    if (hiring) qs.set("hiring", "1");
    const r = await api<Reply>(`/api/hyderabad?${qs}`);
    if (r.status === 401) return router.replace("/onboarding");
    if (!r.ok) return setError(r.error);
    setError(null);
    setData(r.data);
  }, [page, pageSize, term, industry, hiring, router]);

  useEffect(() => {
    load();
  }, [load]);
  useLive(load);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hyderabad startup map"
        subtitle={`${data ? data.directoryTotal.toLocaleString() : "About 1,200"} startups in Hyderabad with their website, careers link and what they do. Not limited to recently funded companies.`}
      />
      <DataFreshness />

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search Hyderabad startups" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, what they do, or area (Gachibowli, Madhapur…)" className="pl-9" />
          </div>
          <SelectField
            aria-label="Industry"
            value={industry}
            onValueChange={(v) => {
              setIndustry(v);
              setPage(1);
            }}
            options={[{ value: "all", label: "All industries" }, ...(data?.industries ?? []).map((i) => ({ value: i.name, label: `${i.name} (${i.n})` }))]}
            className="w-full sm:w-52"
          />
          <Button
            variant={hiring ? "default" : "outline"}
            aria-pressed={hiring}
            onClick={() => {
              setHiring((h) => !h);
              setPage(1);
            }}
          >
            Hiring now
          </Button>
        </CardContent>
      </Card>

      {error && !data && <Banner tone="error" action={<Button size="sm" variant="outline" onClick={load}>Try again</Button>}>{error}</Banner>}
      {!data && !error && <PageSkeleton variant="cards" count={6} />}

      {data && data.directoryTotal === 0 && (
        <EmptyState icon={MapPinIcon} title="The Hyderabad directory is being loaded">It appears here as soon as the first refresh finishes. This page updates by itself.</EmptyState>
      )}
      {data && data.directoryTotal > 0 && data.total === 0 && <EmptyState icon={SearchIcon} title="No startups match">Try a different word or industry, or turn off “Hiring now”.</EmptyState>}

      {data && data.total > 0 && (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">{data.total.toLocaleString()} {data.total === 1 ? "startup" : "startups"}</p>
          <div className="grid gap-3 md:grid-cols-2">
            {data.startups.map((s) => (
              <Card key={s.id}>
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/startups/${s.id}`} className="min-w-0 text-base font-semibold hover:underline">{s.name}</Link>
                    {s.open_jobs > 0 && <Badge>{s.open_jobs} open {s.open_jobs === 1 ? "role" : "roles"}</Badge>}
                  </div>
                  {s.description && <p className="line-clamp-3 text-sm text-muted-foreground">{s.description}</p>}
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPinIcon className="size-3.5 shrink-0" />
                    <span className="truncate" title={s.location ?? undefined}>{shortPlace(s.location)}</span>
                    {s.founded_year && <span>· founded {s.founded_year}</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {s.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {safeHref(s.website) && (
                      <a href={safeHref(s.website)!} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Website <ExternalLinkIcon />
                      </a>
                    )}
                    {safeHref(s.careers_url) && (
                      <a href={safeHref(s.careers_url)!} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                        Careers <ExternalLinkIcon />
                      </a>
                    )}
                    <Link href={`/startups/${s.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Details</Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Pagination total={data.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Dataset: <a className="underline" href={data?.attribution.url ?? "https://github.com/shivtchandra/hydstartuplist"} target="_blank" rel="noopener noreferrer">Mapping HYD open data<span className="sr-only"> (opens in a new tab)</span></a> · MIT licence. Community-maintained; check the company&apos;s own site.
      </p>
    </div>
  );
}
