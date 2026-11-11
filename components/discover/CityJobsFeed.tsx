"use client";
// Company-board jobs for Bengaluru, Hyderabad, Chennai and India-remote. Reads /api/jobs/feed (our database only): opening this
// never contacts a company site or ATS. Shows the original apply link and an honest "last checked" time.
import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Banner } from "@/components/Banner";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { SelectField } from "@/components/SelectField";
import { StartupAvatar } from "@/components/StartupAvatar";
import { BriefcaseBusinessIcon, ExternalLinkIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Job {
  id: number; title: string; cities: string[]; company: { slug: string; name: string; logoSrc: string }; locations: string[]; cityClass: string; remoteIndia: boolean; workplaceType: string | null;
  employmentType: string | null; experienceMin: number | null; experienceMax: number | null; postedAt: string | null; firstSeenAt: string; lastCheckedAt: string | null; applyUrl: string | null;
  freshness: { state: "fresh" | "delayed" | "unavailable"; label: string };
}
const CITIES = [
  { value: "target", label: "Bengaluru, Hyderabad, Chennai & India remote" }, { value: "bengaluru", label: "Bengaluru" }, { value: "hyderabad", label: "Hyderabad" }, { value: "chennai", label: "Chennai" },
  { value: "remote", label: "Remote (India)" }, { value: "other_india", label: "Other Indian cities" },
];
const ROLES = [["", "Any role"], ["software_engineering", "Software engineering"], ["data_ml", "Data & ML"], ["devops_sre", "DevOps / SRE"], ["product_management", "Product"], ["design", "Design"], ["qa", "QA"], ["sales", "Sales"], ["marketing", "Marketing"], ["customer_success", "Customer success"], ["hr", "HR"], ["finance", "Finance"], ["operations", "Operations"]];
const TYPES = [["", "Any type"], ["full", "Full-time"], ["intern", "Internship"], ["contract", "Contract"], ["part", "Part-time"]];
const POSTED = [["", "Any date"], ["7", "Last 7 days"], ["30", "Last 30 days"]];
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const CITY_NAME: Record<string, string> = { bengaluru: "Bengaluru", hyderabad: "Hyderabad", chennai: "Chennai" };
const CITY_LABEL: Record<string, string> = { bengaluru: "Bengaluru", hyderabad: "Hyderabad", chennai: "Chennai", both: "Bengaluru + Hyderabad", multi: "Multiple cities", india_remote: "India remote", other_india: "India", unknown: "Location not stated" };

export function CityJobsFeed() {
  const [f, setF] = useState({ city: "target", q: "", role: "", type: "", years: "", posted: "", fresh: false, page: 1 });
  const [data, setData] = useState<{ total: number; jobs: Job[]; pageSize: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cov, setCov] = useState<{ boardsWatched: number; companiesWatched: number; lastSuccessfulRefresh: string | null } | null>(null);
  useEffect(() => { api<any>("/api/jobs/coverage").then((r) => { if (r.ok) setCov(r.data); }); }, []);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, page: 1, ...p }));
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ city: f.city, page: String(f.page), pageSize: "20" });
      if (f.q) qs.set("q", f.q); if (f.role) qs.set("role", f.role); if (f.type) qs.set("type", f.type); if (f.years) qs.set("years", f.years); if (f.posted) qs.set("postedWithinDays", f.posted); if (f.fresh) qs.set("fresh", "1");
      const r = await api<{ total: number; jobs: Job[]; pageSize: number }>(`/api/jobs/feed?${qs}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (r.ok) { setData(r.data); setErr(null); } else setErr(r.error ?? "Could not load jobs.");
    }, f.q ? 250 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [f]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 gap-2 px-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input type="search" aria-label="Search title, company or location" placeholder="Search title, company or location" value={f.q} onChange={(e) => set({ q: e.target.value })} className="lg:col-span-3" />
          <SelectField aria-label="City" value={f.city} onValueChange={(v) => set({ city: v })} options={CITIES} />
          <SelectField aria-label="Role" value={f.role || "any"} onValueChange={(v) => set({ role: v === "any" ? "" : v })} options={ROLES.map(([v, l]) => ({ value: v || "any", label: l! }))} />
          <SelectField aria-label="Employment type" value={f.type || "any"} onValueChange={(v) => set({ type: v === "any" ? "" : v })} options={TYPES.map(([v, l]) => ({ value: v || "any", label: l! }))} />
          <SelectField aria-label="Date published" value={f.posted || "any"} onValueChange={(v) => set({ posted: v === "any" ? "" : v })} options={POSTED.map(([v, l]) => ({ value: v || "any", label: l! }))} />
          <Input type="number" min={0} max={40} aria-label="My years of experience" placeholder="My years of experience" value={f.years} onChange={(e) => set({ years: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.fresh} onChange={(e) => set({ fresh: e.target.checked })} /> Only recently checked sources</label>
        </div>
      </Card>
      {err && <Banner tone="error">{err}</Banner>}
      {data && <p className="text-sm text-muted-foreground" aria-live="polite">{data.total.toLocaleString("en-IN")} openings from company career boards</p>}
      {data && data.jobs.length === 0 && <EmptyState icon={BriefcaseBusinessIcon} title="No openings match">{cov && cov.boardsWatched > 0 ? `Jyntra currently watches ${cov.boardsWatched.toLocaleString("en-IN")} employer career boards (${cov.companiesWatched.toLocaleString("en-IN")} companies), last refreshed ${ago(cov.lastSuccessfulRefresh)}. None of them lists a matching opening right now. Try a wider city or clear a filter; new boards are discovered daily.` : "No employer career boards have been connected yet, so there are no listings to show. We never fill this page with placeholder jobs."}</EmptyState>}
      <ul className="space-y-3">
        {data?.jobs.map((j) => (
          <li key={j.id}>
            <Card className="px-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <StartupAvatar name={j.company.name} src={j.company.logoSrc} />
                  <div className="min-w-0">
                    <h3 className="font-medium leading-snug">{j.title}</h3>
                    <p className="text-sm text-muted-foreground">{j.company.name} · {j.locations.slice(0, 3).join(" / ") || CITY_LABEL[j.cityClass]}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{j.cities?.length ? j.cities.map((c) => CITY_NAME[c] ?? c).join(" + ") : CITY_LABEL[j.cityClass] ?? j.cityClass}</Badge>
                      {j.remoteIndia && j.cityClass !== "india_remote" && <Badge variant="outline">Remote option</Badge>}
                      {j.workplaceType && j.workplaceType !== "unknown" && <Badge variant="outline">{j.workplaceType}</Badge>}
                      {j.employmentType && <Badge variant="outline">{j.employmentType}</Badge>}
                      {j.experienceMin !== null && <Badge variant="outline">{j.experienceMin}{j.experienceMax !== null ? `–${j.experienceMax}` : "+"} yrs</Badge>}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {j.postedAt ? `Posted ${new Date(j.postedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "Posting date not stated by the source"} · First seen by Jyntra {ago(j.firstSeenAt)} · Last checked {ago(j.lastCheckedAt)}
                      {j.freshness.state !== "fresh" && <span className="ml-1 font-medium text-warning">· {j.freshness.label}</span>}
                    </p>
                  </div>
                </div>
                {j.applyUrl ? (
                  <a href={j.applyUrl} target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ size: "sm", className: "shrink-0" })}>
                    Apply now <ExternalLinkIcon /><span className="sr-only">for {j.title} (opens in a new tab)</span>
                  </a>
                ) : <p className="max-w-[11rem] text-xs text-muted-foreground sm:text-right">Application link unavailable from the source</p>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data && data.total > data.pageSize && <Pagination page={f.page} pageSize={data.pageSize} total={data.total} onPageChange={(p) => setF((x) => ({ ...x, page: p }))} onPageSizeChange={() => {}} />}
    </div>
  );
}
