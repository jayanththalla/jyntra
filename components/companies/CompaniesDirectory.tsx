"use client";
// Companies directory: grid of company cards matching the screenshot design.
// Clicking a card opens a slide-out side panel with that company's job listings — no page navigation needed.
import { useCallback, useMemo, useState } from "react";
import { BuildingIcon, MapPinIcon, SearchIcon, Loader2Icon, CancelIcon } from "@/components/icons";
import { JobApplyActions } from "@/components/companies/JobApplyActions";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { SelectField } from "@/components/SelectField";
import { StartupAvatar } from "@/components/StartupAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { EXPERIENCE_ORDER, fmtDate, type CompanyCard, type ArenaJob, experienceBand, MODE_LABEL } from "@/lib/arena/shared";

type Sort = "roles" | "recent" | "fresher" | "name";
const SORTS: { value: Sort; label: string }[] = [
  { value: "roles", label: "Most open roles" },
  { value: "recent", label: "Most posted in 30 days" },
  { value: "fresher", label: "Most fresher roles" },
  { value: "name", label: "Name A to Z" },
];

interface PanelData {
  slug: string;
  name: string;
  location: string | null;
  page: string | null;
  jobs: ArenaJob[];
  loading: boolean;
  error: boolean;
}

export function CompaniesDirectory({ cards, cities = [], families, fetchedAt }: { cards: CompanyCard[]; cities?: string[]; families: { key: string; label: string; companies: number }[]; fetchedAt: string | null }) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("all");
  const [city, setCity] = useState("all");
  const [sort, setSort] = useState<Sort>("roles");
  const [fresherOnly, setFresherOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [pFresher, setPFresher] = useState(false);
  const [pBand, setPBand] = useState("all");

  const panelBands = useMemo(() => (panel ? EXPERIENCE_ORDER.filter((b) => panel.jobs.some((j) => experienceBand(j.experience, j.fresher) === b)) : []), [panel]);
  const panelJobs = useMemo(
    () => (panel ? panel.jobs.filter((j) => (!pFresher || j.fresher) && (pBand === "all" || experienceBand(j.experience, j.fresher) === pBand)) : []),
    [panel, pFresher, pBand]
  );

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = cards.filter((c) => (!query || c.name.toLowerCase().includes(query)) && (city === "all" || c.city === city) && (family === "all" || c.families.includes(family)) && (!fresherOnly || c.fresher > 0) && (!remoteOnly || c.remote > 0));
    const by: Record<Sort, (a: CompanyCard, b: CompanyCard) => number> = {
      roles: (a, b) => b.count - a.count,
      recent: (a, b) => b.recent - a.recent || b.count - a.count,
      fresher: (a, b) => b.fresher - a.fresher || b.count - a.count,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
  }, [cards, q, city, family, sort, fresherOnly, remoteOnly]);

  const reset = (fn: () => void) => { fn(); setPage(1); };
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);

  const openPanel = useCallback(async (card: CompanyCard) => {
    // Set loading state immediately
    setPFresher(fresherOnly);
    setPBand("all");
    setPanel({ slug: card.slug, name: card.name, location: card.location, page: null, jobs: [], loading: true, error: false });
    try {
      const res = await fetch(`/api/companies/${card.slug}/jobs`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setPanel({ slug: card.slug, name: card.name, location: card.location, page: typeof data.page === "string" ? data.page : null, jobs: data.jobs ?? [], loading: false, error: false });
    } catch {
      setPanel((prev) => prev ? { ...prev, loading: false, error: true } : null);
    }
  }, [fresherOnly]);

  const closePanel = useCallback(() => setPanel(null), []);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <Card>
        <div className="flex flex-col gap-3 px-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search companies" value={q} onChange={(e) => reset(() => setQ(e.target.value))} placeholder="Search companies" className="pl-9" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {cities.length > 1 && (
              <SelectField aria-label="City" value={city} onValueChange={(v) => reset(() => setCity(v))} className="w-full sm:w-44" options={[{ value: "all", label: "All cities" }, ...cities.map((x) => ({ value: x, label: x }))]} />
            )}
            <SelectField aria-label="Role family" value={family} onValueChange={(v) => reset(() => setFamily(v))} className="w-full sm:w-64" options={[{ value: "all", label: "Every kind of role" }, ...families.map((f) => ({ value: f.key, label: `${f.label} (${f.companies})` }))]} />
            <SelectField aria-label="Sort companies" value={sort} onValueChange={(v) => setSort(v as Sort)} className="w-full sm:w-56" options={SORTS} />
            <div className="flex items-center gap-2 px-1">
              <Checkbox id="co-fresher" checked={fresherOnly} onCheckedChange={(v) => reset(() => setFresherOnly(v === true))} />
              <Label htmlFor="co-fresher" className="text-[13px]">Has fresher roles</Label>
            </div>
            <div className="flex items-center gap-2 px-1">
              <Checkbox id="co-remote" checked={remoteOnly} onCheckedChange={(v) => reset(() => setRemoteOnly(v === true))} />
              <Label htmlFor="co-remote" className="text-[13px]">Has remote roles</Label>
            </div>
          </div>
        </div>
      </Card>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        <b className="font-semibold text-foreground">{rows.length}</b> {rows.length === 1 ? "company" : "companies"}
        {fetchedAt && <> · listings collected {fmtDate(fetchedAt.slice(0, 10))}</>}
      </p>

      {rows.length === 0 ? (
        <EmptyState icon={BuildingIcon} title="No companies match">Try a shorter name or clear the role filter.</EmptyState>
      ) : (
        <div className="flex gap-0">
          {/* ── Grid of company cards ── */}
          <div className={`min-w-0 transition-all duration-300 ${panel ? "flex-1" : "w-full"}`}>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
              {shown.map((c) => (
                <li key={c.slug}>
                  <button
                    type="button"
                    onClick={() => openPanel(c)}
                    className={`block h-full w-full rounded-xl text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring ${panel?.slug === c.slug ? "ring-2 ring-primary" : ""}`}
                  >
                    <Card className={`h-full gap-2 px-4 transition-colors hover:bg-accent/50 hover:ring-primary/40 ${panel?.slug === c.slug ? "border-primary/50 bg-accent/30" : ""}`}>
                      <div className="flex items-center gap-3">
                        <StartupAvatar name={c.name} src={c.logoSrc} />
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate font-semibold leading-tight">{c.name}</h2>
                          {c.location && (
                            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                              <MapPinIcon className="size-3 shrink-0" />
                              {c.location}
                            </p>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <b className="font-semibold text-foreground tabular-nums">{c.count}</b> open {c.count === 1 ? "role" : "roles"}
                        {c.fresher > 0 && <>, <b className="font-semibold text-foreground tabular-nums">{c.fresher}</b> for freshers</>}
                      </p>
                    </Card>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-border/60 pt-4 mt-4">
              <Pagination total={rows.length} page={page} pageSize={pageSize} onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
            </div>
          </div>

          {/* ── Side Panel (desktop) + sheet (mobile) ── */}
          {panel && (
            <>
              <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={closePanel} aria-hidden />
              <aside className="fixed inset-x-0 bottom-0 z-50 flex h-[85vh] flex-col overflow-hidden rounded-t-xl border border-border/70 bg-card shadow-lg lg:sticky lg:top-20 lg:z-auto lg:ml-3 lg:h-[calc(100vh-6rem)] lg:w-[22rem] lg:shrink-0 lg:rounded-xl lg:inset-auto">
                <div className="flex items-start justify-between gap-3 border-b border-border/60 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <StartupAvatar name={panel.name} src={`/api/companies/${panel.slug}/logo`} />
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold">{panel.name}</h3>
                      {panel.location && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPinIcon className="size-3 shrink-0" />
                          {panel.location}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={closePanel} aria-label="Close panel">
                    <CancelIcon />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {panel.loading ? (
                    <div className="flex h-40 items-center justify-center">
                      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : panel.error ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      Failed to load jobs.{" "}
                      <button type="button" className="font-medium text-primary hover:underline" onClick={() => { const card = cards.find((c) => c.slug === panel.slug); if (card) openPanel(card); }}>
                        Retry
                      </button>
                    </div>
                  ) : panel.jobs.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">No open roles listed.</div>
                  ) : (
                    <>
                    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5">
                      <SelectField aria-label="Experience" value={pBand} onValueChange={setPBand} className="w-40" options={[{ value: "all", label: "Any experience" }, ...panelBands.map((b) => ({ value: b, label: b }))]} />
                      <div className="flex items-center gap-2">
                        <Checkbox id="panel-fresher" checked={pFresher} onCheckedChange={(v) => setPFresher(v === true)} />
                        <Label htmlFor="panel-fresher" className="text-[13px]">Fresher roles</Label>
                      </div>
                    </div>
                    {panelJobs.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">No roles match these filters.</div>
                    ) : (
                    <ul className="divide-y divide-border/50">
                      {panelJobs.map((job) => (
                        <li key={job.id} className="px-4 py-3 transition-colors hover:bg-accent/30">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h4 className="text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{job.title}</h4>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {[job.seniority, experienceBand(job.experience, job.fresher), job.experience].filter(Boolean).join(" · ")}
                              </p>
                              {job.location && (
                                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                  <MapPinIcon className="size-3 shrink-0" />
                                  <span className="truncate">{job.location}</span>
                                </p>
                              )}
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {job.fresher && <Badge variant="info" className="text-[10px] px-1.5 py-0">Fresher</Badge>}
                                {job.mode !== "unknown" && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{MODE_LABEL[job.mode]}</Badge>}
                                {job.type && job.type !== "unknown" && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{job.type}</Badge>}
                              </div>
                            </div>
                            <JobApplyActions job={job} slug={panel.slug} sourcePage={panel.page} compact />
                          </div>
                        </li>
                      ))}
                    </ul>
                    )}
                    </>
                  )}
                </div>
                {!panel.loading && panel.jobs.length > 0 && (
                  <div className="border-t border-border/60 px-4 py-3 text-center text-xs text-muted-foreground">
                    {panelJobs.length === panel.jobs.length ? panelJobs.length : `${panelJobs.length} of ${panel.jobs.length}`} open {panel.jobs.length === 1 ? "role" : "roles"}
                  </div>
                )}
              </aside>
            </>
          )}
        </div>
      )}
    </div>
  );
}
