"use client";
import { LOCATION_OPTIONS } from "@/lib/types";
import { ROLE_CATEGORIES } from "@/lib/jobs/roles";
import { INDUSTRY_CATEGORIES } from "@/lib/classification";
import { STAGE_LABELS } from "@/lib/funding";
import { Chip } from "./Chip";
import { ArrowDownIcon, RotateCcwIcon } from "@/components/icons";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export {
  AMOUNT_BUCKETS,
  ARRANGEMENT_OPTIONS,
  applyFilters,
  COUNTRY_OPTIONS,
  DEFAULT_FILTERS,
  EXPERIENCE_LEVELS,
  filtersForProfile,
  FUNDING_DAY_OPTIONS,
  fundingWindow,
  STAGE_OPTIONS,
  type FilterState,
} from "@/lib/filters";
import {
  AMOUNT_BUCKETS,
  ARRANGEMENT_OPTIONS,
  COUNTRY_OPTIONS,
  DEFAULT_FILTERS,
  EXPERIENCE_LEVELS,
  FUNDING_DAY_OPTIONS,
  fundingWindow,
  STAGE_OPTIONS,
  type FilterState,
} from "@/lib/filters";

const daysLabel = (d: number) => `last ${d} days`;

const AGE_OPTIONS = [
  ["new", "New (2024+)"],
  ["early", "Early stage"],
  ["growing", "Growing"],
  ["established", "Established"],
] as const;

function SwitchRow({ id, label, on, onChange, hint }: { id: string; label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <Label htmlFor={id} className="flex-col items-start gap-0.5 leading-snug">
        {label}
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </Label>
      <Switch id={id} checked={on} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

/** Collapsible filter group. A group with an active filter is always shown open, so you can see what's filtering the list. */
function Group({ title, children, hint, defaultOpen = true, active = 0 }: { title: string; children: React.ReactNode; hint?: string; defaultOpen?: boolean; active?: number }) {
  const [open, setOpen] = useState(defaultOpen || active > 0);
  useEffect(() => {
    if (active > 0) setOpen(true);
  }, [active]);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t py-4 first:border-t-0 first:pt-0">
      <CollapsibleTrigger className="flex min-h-7 w-full items-center justify-between gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="flex items-center gap-2">
          {title}
          {active > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {active}
            </Badge>
          )}
        </span>
        <ArrowDownIcon className={cn("text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <CollapsibleContent className="mt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** The filters currently narrowing the list, each with a one-click remove. Shown above the results. */
export function activeFilterChips(f: FilterState, set: (f: FilterState) => void): { key: string; label: string; remove: () => void }[] {
  const chips: { key: string; label: string; remove: () => void }[] = [];
  for (const r of f.roles ?? []) chips.push({ key: `r:${r}`, label: r, remove: () => set({ ...f, roles: (f.roles ?? []).filter((x) => x !== r) }) });
  for (const l of f.levels ?? []) {
    const label = EXPERIENCE_LEVELS.find(([k]) => k === l)?.[1] ?? l;
    chips.push({ key: `e:${l}`, label, remove: () => set({ ...f, levels: (f.levels ?? []).filter((x) => x !== l) }) });
  }
  for (const l of f.locations) chips.push({ key: `l:${l}`, label: l, remove: () => set({ ...f, locations: f.locations.filter((x) => x !== l) }) });
  for (const t of f.types ?? []) chips.push({ key: `t:${t}`, label: t, remove: () => set({ ...f, types: (f.types ?? []).filter((x) => x !== t) }) });
  for (const a of f.arrangements ?? [])
    chips.push({ key: `w:${a}`, label: ARRANGEMENT_OPTIONS.find(([k]) => k === a)?.[1] ?? a, remove: () => set({ ...f, arrangements: (f.arrangements ?? []).filter((x) => x !== a) }) });
  const country = f.country ?? "any";
  if (country !== "any") chips.push({ key: "c", label: COUNTRY_OPTIONS.find(([k]) => k === country)![1], remove: () => set({ ...f, country: "any" }) });
  const days = fundingWindow(f);
  if (days != null) chips.push({ key: "f", label: `Funded: ${daysLabel(days)}`, remove: () => set({ ...f, fundingDays: null, funding: [] }) });
  if (f.confirmedOnly) chips.push({ key: "fc", label: "Confirmed funding only", remove: () => set({ ...f, confirmedOnly: false }) });
  for (const st of f.stages ?? [])
    chips.push({ key: `s:${st}`, label: STAGE_LABELS[st as keyof typeof STAGE_LABELS] ?? st, remove: () => set({ ...f, stages: (f.stages ?? []).filter((x) => x !== st) }) });
  for (const a of f.amounts ?? [])
    chips.push({ key: `$:${a}`, label: AMOUNT_BUCKETS.find(([k]) => k === a)?.[1] ?? a, remove: () => set({ ...f, amounts: (f.amounts ?? []).filter((x) => x !== a) }) });
  for (const a of f.age) chips.push({ key: `a:${a}`, label: AGE_OPTIONS.find(([x]) => x === a)?.[1] ?? a, remove: () => set({ ...f, age: f.age.filter((x) => x !== a) }) });
  for (const r of f.relevance ?? [])
    chips.push({ key: `m:${r}`, label: r === "strong" ? "Great matches" : "Good matches", remove: () => set({ ...f, relevance: (f.relevance ?? []).filter((x) => x !== r) }) });
  if (f.hiringOnly) chips.push({ key: "hiring", label: "Hiring now", remove: () => set({ ...f, hiringOnly: false }) });
  if (f.matchingOnly) chips.push({ key: "fits", label: "Has a job that fits me", remove: () => set({ ...f, matchingOnly: false }) });
  if (f.emailOnly) chips.push({ key: "email", label: "Has an email", remove: () => set({ ...f, emailOnly: false }) });
  if (f.search) chips.push({ key: "q", label: `“${f.search}”`, remove: () => set({ ...f, search: "" }) });
  return chips;
}

export function Filters({ f, set, defaults = DEFAULT_FILTERS }: { f: FilterState; set: (f: FilterState) => void; defaults?: FilterState }) {
  const roles = f.roles ?? [];
  const levels = f.levels ?? [];
  const types = f.types ?? [];
  const arrangements = f.arrangements ?? [];
  const stages = f.stages ?? [];
  const amounts = f.amounts ?? [];
  const country = f.country ?? "any";
  const days = fundingWindow(f);
  return (
    <div className="text-sm">
      <Group title="Country" hint="Where the startup is headquartered (not where its investors are)" active={country === "any" ? 0 : 1}>
        <div className="flex flex-wrap gap-2">
          {COUNTRY_OPTIONS.map(([k, l]) => (
            <Chip key={k} label={l} on={country === k} onClick={() => set({ ...f, country: k })} />
          ))}
        </div>
      </Group>

      <Group title="Role type" hint={levels.length ? "Only jobs at these levels are shown" : "Pick Internship or Fresher to see entry-level jobs only"} active={levels.length}>
        <div className="flex flex-wrap gap-2">
          {EXPERIENCE_LEVELS.map(([k, l, hint]) => (
            <Chip key={k} label={l} title={hint} on={levels.includes(k)} onClick={() => set({ ...f, levels: toggle(levels, k) })} />
          ))}
        </div>
      </Group>

      <Group title="Job role" hint={roles.length ? "Only jobs in these roles are shown" : "Leave empty to see every role"} active={roles.length}>
        <div className="flex flex-wrap gap-2">
          {ROLE_CATEGORIES.map((r) => (
            <Chip key={r} label={r} on={roles.includes(r)} onClick={() => set({ ...f, roles: toggle(roles, r) })} />
          ))}
        </div>
      </Group>

      <Group
        title="Recently funded"
        active={(days != null ? 1 : 0) + (f.confirmedOnly ? 1 : 0)}
        hint={days != null ? "By the date the round was announced" : "Any funding date"}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {FUNDING_DAY_OPTIONS.map((d) => (
              // One period at a time ("30 days" already includes "7 days").
              // Funding spans months, so picking a period looks at all startups, not just today's changes.
              // News-found startups usually have no jobs listed yet, so "Hiring now" is turned off too.
              <Chip
                key={d}
                label={`${d} days`}
                on={days === d}
                onClick={() => set(days === d ? { ...f, fundingDays: null, funding: [] } : { ...f, fundingDays: d, funding: [], view: "all", hiringOnly: false })}
              />
            ))}
            <Chip label="Any time" on={days == null} onClick={() => set({ ...f, fundingDays: null, funding: [] })} />
          </div>
          <SwitchRow
            id="flt-confirmed"
            label="Confirmed announcements only"
            hint="Hide planned rounds and unconfirmed reports"
            on={!!f.confirmedOnly}
            onChange={(v) => set({ ...f, confirmedOnly: v })}
          />
        </div>
      </Group>

      <Group title="Funding stage" active={stages.length} defaultOpen={stages.length > 0}>
        <div className="flex flex-wrap gap-2">
          {STAGE_OPTIONS.map((k) => (
            <Chip key={k} label={STAGE_LABELS[k]} on={stages.includes(k)} onClick={() => set({ ...f, stages: toggle(stages, k), view: "all" })} />
          ))}
        </div>
      </Group>

      <Group title="Funding amount" active={amounts.length} defaultOpen={amounts.length > 0} hint="In US dollars. Amounts we couldn't read are hidden when this is on">
        <div className="flex flex-wrap gap-2">
          {AMOUNT_BUCKETS.map(([k, l]) => (
            <Chip key={k} label={l} on={amounts.includes(k)} onClick={() => set({ ...f, amounts: toggle(amounts, k), view: "all" })} />
          ))}
        </div>
      </Group>

      <Group title="Work arrangement" active={arrangements.length} defaultOpen={arrangements.length > 0} hint="Only what the job posting itself says">
        <div className="flex flex-wrap gap-2">
          {ARRANGEMENT_OPTIONS.map(([k, l]) => (
            <Chip key={k} label={l} on={arrangements.includes(k)} onClick={() => set({ ...f, arrangements: toggle(arrangements, k) })} />
          ))}
        </div>
      </Group>

      <Group title="Location" active={f.locations.length}>
        <div className="flex flex-wrap gap-2">
          <Chip label="Anywhere" on={f.locations.length === 0} onClick={() => set({ ...f, locations: [] })} />
          {LOCATION_OPTIONS.map((l) => (
            <Chip
              key={l}
              label={l}
              on={f.locations.includes(l)}
              onClick={() => set({ ...f, locations: toggle(f.locations, l) })}
              title={l === "Remote" ? "Remote jobs not restricted to another country" : l === "Remote - India" ? "Remote jobs explicitly open to India" : undefined}
            />
          ))}
        </div>
      </Group>

      <Group title="Show only" active={[f.hiringOnly, f.matchingOnly, f.emailOnly].filter(Boolean).length + (f.relevance ?? []).length}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {[
              ["strong", "Great matches"],
              ["potential", "Good matches"],
            ].map(([k, l]) => (
              <Chip key={k} label={l} on={(f.relevance ?? []).includes(k)} onClick={() => set({ ...f, relevance: toggle(f.relevance ?? [], k) })} />
            ))}
          </div>
          <SwitchRow id="flt-hiring" label="Hiring now" hint="Has at least one open job" on={f.hiringOnly} onChange={(v) => set({ ...f, hiringOnly: v })} />
          <SwitchRow id="flt-fits" label="Has a job that fits me" hint="A great or good match" on={f.matchingOnly} onChange={(v) => set({ ...f, matchingOnly: v })} />
          <SwitchRow id="flt-email" label="Has a contact email" hint="Published on their website" on={!!f.emailOnly} onChange={(v) => set({ ...f, emailOnly: v })} />
        </div>
      </Group>

      <Group title="Industry" active={types.length} defaultOpen={types.length > 0}>
        <div className="flex flex-wrap gap-2">
          <Chip label="Any" on={!types.length} onClick={() => set({ ...f, types: [] })} />
          {INDUSTRY_CATEGORIES.map((t) => (
            <Chip key={t} label={t} on={types.includes(t)} onClick={() => set({ ...f, types: toggle(types, t) })} />
          ))}
          {/* Types picked during onboarding that aren't an industry category stay selectable. */}
          {types
            .filter((t) => !(INDUSTRY_CATEGORIES as readonly string[]).includes(t))
            .map((t) => (
              <Chip key={t} label={t} on onClick={() => set({ ...f, types: toggle(types, t) })} />
            ))}
        </div>
      </Group>

      <Group title="Startup age" active={f.age.length} defaultOpen={f.age.length > 0}>
        <div className="flex flex-wrap gap-2">
          {AGE_OPTIONS.map(([k, l]) => (
            <Chip key={k} label={l} on={f.age.includes(k)} onClick={() => set({ ...f, age: toggle(f.age, k) })} />
          ))}
        </div>
      </Group>

      <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={() => set({ ...defaults, view: f.view, sort: f.sort })}>
        <RotateCcwIcon /> Reset to my defaults
      </Button>
    </div>
  );
}
