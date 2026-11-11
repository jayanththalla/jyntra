"use client";
// One company's listings: filter by role family, work mode and experience, search by title, paginate.
import { useMemo, useState } from "react";
import { BriefcaseBusinessIcon, MapPinIcon, SearchIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { SelectField } from "@/components/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JobApplyActions } from "@/components/companies/JobApplyActions";
import { EXPERIENCE_ORDER, MODE_LABEL, ageLabel, daysBetween, experienceBand, familyLabel, type ArenaJob } from "@/lib/arena/shared";

export function CompanyJobs({ jobs, today, slug }: { jobs: ArenaJob[]; today: string; slug: string; companyPage?: string }) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("all");
  const [mode, setMode] = useState("all");
  const [band, setBand] = useState("all");
  const [fresher, setFresher] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const families = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) m.set(j.family, (m.get(j.family) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [jobs]);
  const bands = useMemo(() => EXPERIENCE_ORDER.filter((b) => jobs.some((j) => experienceBand(j.experience, j.fresher) === b)), [jobs]);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return jobs.filter(
      (j) =>
        (!query || `${j.title} ${j.location ?? ""}`.toLowerCase().includes(query)) &&
        (family === "all" || j.family === family) &&
        (mode === "all" || j.mode === mode) &&
        (band === "all" || experienceBand(j.experience, j.fresher) === band) &&
        (!fresher || j.fresher),
    );
  }, [jobs, q, family, mode, band, fresher]);
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);
  const filtered = family !== "all" || mode !== "all" || band !== "all" || fresher || q !== "";
  const reset = () => { setQ(""); setFamily("all"); setMode("all"); setBand("all"); setFresher(false); setPage(1); };
  const on = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 px-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search this company's roles" value={q} onChange={(e) => on(setQ)(e.target.value)} placeholder="Search by title or location" className="pl-9" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <SelectField aria-label="Role family" value={family} onValueChange={on(setFamily)} className="w-full sm:w-64" options={[{ value: "all", label: "Every kind of role" }, ...families.map(([k, n]) => ({ value: k, label: `${familyLabel(k)} (${n})` }))]} />
            <SelectField aria-label="Work mode" value={mode} onValueChange={on(setMode)} className="w-full sm:w-44" options={[{ value: "all", label: "Any work mode" }, ...(["hybrid", "onsite", "remote"] as const).filter((m) => jobs.some((j) => j.mode === m)).map((m) => ({ value: m, label: MODE_LABEL[m] }))]} />
            <SelectField aria-label="Experience" value={band} onValueChange={on(setBand)} className="w-full sm:w-44" options={[{ value: "all", label: "Any experience" }, ...bands.map((b) => ({ value: b, label: b }))]} />
            <div className="flex items-center gap-2 px-1">
              <Checkbox id="co-job-fresher" checked={fresher} onCheckedChange={(v) => on(setFresher)(v === true)} />
              <Label htmlFor="co-job-fresher" className="text-[13px]">Fresher friendly</Label>
            </div>
          </div>
        </div>
      </Card>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        <b className="font-semibold text-foreground">{rows.length}</b> {rows.length === 1 ? "role" : "roles"}{filtered && <> of {jobs.length}</>}, newest first
      </p>

      {rows.length === 0 ? (
        <EmptyState icon={BriefcaseBusinessIcon} title="No roles match" actions={<Button variant="outline" onClick={reset}>Clear filters</Button>}>
          Try another role family or work mode.
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((j) => {
              const fresh = j.posted !== null && daysBetween(today, j.posted) <= 7;
              return (
                <li key={j.id}>
                  <Card className="gap-2 px-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5">
                    <div className="min-w-0 space-y-1.5">
                      <h2 className="font-semibold leading-snug [overflow-wrap:anywhere]">{j.title}</h2>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {j.location && <span className="inline-flex items-center gap-1"><MapPinIcon className="size-3.5" />{j.location}</span>}
                        <span>{ageLabel(today, j.posted)}</span>
                        {j.experience && <span>{j.experience}</span>}
                        {j.salary && <span>{j.salary}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {fresh && <Badge variant="success">New this week</Badge>}
                        {j.fresher && <Badge variant="info">Fresher friendly</Badge>}
                        {j.mode !== "unknown" && <Badge variant="secondary">{MODE_LABEL[j.mode]}</Badge>}
                        {j.type && j.type !== "unknown" && <Badge variant="outline">{j.type}</Badge>}
                        <Badge variant="outline">{familyLabel(j.family)}</Badge>
                      </div>
                      {j.summary && <p className="line-clamp-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{j.summary}</p>}
                    </div>
                    <JobApplyActions job={j} slug={slug} />
                  </Card>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border/60 pt-4">
            <Pagination total={rows.length} page={page} pageSize={pageSize} onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} />
          </div>
        </>
      )}
    </div>
  );
}
