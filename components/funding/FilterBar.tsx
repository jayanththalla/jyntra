"use client";
import { useState } from "react";
import { SelectField } from "@/components/SelectField";
import { Button } from "@/components/ui/button";
import { CancelIcon, ChevronDownIcon, MapPinIcon, RotateCcwIcon } from "@/components/icons";
import { CITY_BY_ID, SECTOR_BY_ID } from "@/lib/news/taxonomy";
import { cn } from "@/lib/utils";
import { DEFAULT_FILTERS, type Filters, type NewsResponse, type VerificationFilter } from "./types";

const RANGES = [
  { value: "any", label: "Any date" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const LEVELS: { value: VerificationFilter; label: string; hint: string }[] = [
  { value: "verified", label: "Verified", hint: "Completed raises reported by two or more publishers" },
  { value: "confirmed", label: "All confirmed", hint: "Every completed raise, including single-source stories" },
  { value: "all", label: "Include unconfirmed", hint: "Also show talks, plans and reported-but-unconfirmed stories" },
];

export function FilterBar({ data, filters, set, onReload }: { data: NewsResponse; filters: Filters; set: (patch: Partial<Filters>) => void; onReload: () => void }) {
  const [more, setMore] = useState(false);
  const cities = data.facets?.cities ?? [];
  const sectors = data.facets?.sectors ?? [];

  const active: { key: keyof Filters; label: string; reset: Partial<Filters> }[] = [];
  if (filters.city !== "all") active.push({ key: "city", label: filters.city === "unknown" ? "City not stated" : CITY_BY_ID.get(filters.city)?.label ?? filters.city, reset: { city: "all" } });
  if (filters.sector !== "all") active.push({ key: "sector", label: SECTOR_BY_ID.get(filters.sector)?.label ?? filters.sector, reset: { sector: "all" } });
  if (filters.publisher !== "all") active.push({ key: "publisher", label: filters.publisher, reset: { publisher: "all" } });
  if (filters.round !== "all") active.push({ key: "round", label: filters.round, reset: { round: "all" } });
  if (filters.investor !== "all") active.push({ key: "investor", label: `Investor: ${filters.investor}`, reset: { investor: "all" } });
  if (filters.range !== "any") active.push({ key: "range", label: RANGES.find((r) => r.value === filters.range)?.label ?? filters.range, reset: { range: "any" } });
  if (filters.hiring) active.push({ key: "hiring", label: "Hiring now", reset: { hiring: false } });
  const hiddenActive = active.filter((a) => ["publisher", "round", "investor", "range"].includes(a.key)).length;
  const clearAll = () => set({ ...DEFAULT_FILTERS, verification: filters.verification });

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="radiogroup" aria-label="How well a story is confirmed" className="inline-flex rounded-lg bg-muted p-0.5">
          {LEVELS.map((l) => {
            const on = filters.verification === l.value;
            return (
              <button
                key={l.value}
                type="button"
                role="radio"
                aria-checked={on}
                title={l.hint}
                onClick={() => set({ verification: l.value })}
                className={cn(
                  "min-h-8 rounded-md px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        <SelectField
          aria-label="Filter by city"
          value={filters.city}
          onValueChange={(city) => set({ city })}
          options={[
            { value: "all", label: "Any city" },
            ...cities.map((c) => ({ value: c.id, label: `${CITY_BY_ID.get(c.id)?.label ?? c.id} (${c.count})` })),
            { value: "unknown", label: "City not stated" },
          ]}
          className="h-9 min-w-36 text-xs"
        />
        <SelectField
          aria-label="Filter by sector"
          value={filters.sector}
          onValueChange={(sector) => set({ sector })}
          options={[{ value: "all", label: "Any sector" }, ...sectors.map((s) => ({ value: s.id, label: `${SECTOR_BY_ID.get(s.id)?.label ?? s.id} (${s.count})` }))]}
          className="h-9 min-w-44 text-xs"
        />
        <Button variant={filters.hiring ? "default" : "outline"} size="sm" aria-pressed={filters.hiring} onClick={() => set({ hiring: !filters.hiring })}>
          Hiring now
        </Button>
        <Button variant="ghost" size="sm" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          More filters{hiddenActive > 0 && ` (${hiddenActive})`}
          <ChevronDownIcon className={cn("transition-transform", more && "rotate-180")} aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={onReload} className="ml-auto">
          <RotateCcwIcon /> Reload
        </Button>
      </div>

      {more && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 p-2.5">
          <SelectField aria-label="Filter by publisher" value={filters.publisher} onValueChange={(publisher) => set({ publisher })} options={[{ value: "all", label: "All publishers" }, ...data.publishers.map((s) => ({ value: s, label: s }))]} className="h-9 min-w-40 text-xs" />
          {(data.rounds?.length ?? 0) > 0 && <SelectField aria-label="Filter by funding round" value={filters.round} onValueChange={(round) => set({ round })} options={[{ value: "all", label: "Any round" }, ...data.rounds!.map((r) => ({ value: r, label: r }))]} className="h-9 min-w-32 text-xs" />}
          {(data.investors?.length ?? 0) > 0 && <SelectField aria-label="Filter by investor" value={filters.investor} onValueChange={(investor) => set({ investor })} options={[{ value: "all", label: "Any investor" }, ...data.investors!.map((r) => ({ value: r, label: r }))]} className="h-9 min-w-36 text-xs" />}
          <SelectField aria-label="Filter by date" value={filters.range} onValueChange={(range) => set({ range })} options={RANGES} className="h-9 min-w-36 text-xs" />
          <SelectField aria-label="Sort" value={filters.sort} onValueChange={(sort) => set({ sort })} options={[{ value: "recent", label: "Newest first" }, { value: "amount", label: "Largest raise first" }]} className="h-9 min-w-40 text-xs" />
        </div>
      )}

      {active.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {active.map((a) => (
            <li key={a.key}>
              <button type="button" onClick={() => set(a.reset)} className="inline-flex h-6 items-center gap-1 rounded-full bg-primary/10 pl-2.5 pr-1.5 text-xs font-medium text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring">
                {a.key === "city" && <MapPinIcon className="size-3" aria-hidden />}
                {a.label}
                <CancelIcon className="size-3" aria-hidden />
                <span className="sr-only">Remove filter</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={clearAll} className="px-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Clear all</button>
          </li>
        </ul>
      )}
    </div>
  );
}
