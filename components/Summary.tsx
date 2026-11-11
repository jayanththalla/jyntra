import type { StartupView } from "@/lib/types";
import { ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Which subset a summary tile stands for; clicking a tile filters the list to it. */
export type SummaryPick = "all" | "great" | "good" | "jobs" | "ai" | "funded" | "new" | "email";

export const isAiStartup = (s: StartupView) => s.is_ai === true || s.industry === "AI Startup";
export const isRecentlyFunded = (s: StartupView) => ["funded_30", "funded_90", "funded_180"].includes(s.funding_status);

function Tile({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: string;
  onClick?: () => void;
}) {
  const clickable = !!onClick && value > 0;
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={!clickable}
      title={clickable ? `${hint}. Click to show them` : hint}
      className={cn(
        "group h-auto min-w-28 shrink-0 snap-start flex-col items-start gap-1 rounded-xl border border-border/50 bg-card/60 p-3.5 text-left font-normal whitespace-normal transition-all duration-200 hover:border-primary/40 hover:bg-muted/70 hover:shadow-xs disabled:opacity-80 disabled:hover:bg-card/60 sm:min-w-0"
      )}
    >
      <div className={cn("text-2xl leading-none font-bold tabular-nums tracking-tight", tone || "text-foreground")}>
        {value}
      </div>
      <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
        {label}
        {clickable && (
          <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5 text-muted-foreground/60" />
        )}
      </div>
    </Button>
  );
}

export function Summary({
  list,
  label,
  onPick,
}: {
  list: StartupView[];
  label: string;
  onPick?: (p: SummaryPick) => void;
}) {
  const strong = list.filter((s) => s.relevance === "strong").length;
  const potential = list.filter((s) => s.relevance === "potential").length;
  const pick = (p: SummaryPick) => (onPick ? () => onPick(p) : undefined);

  return (
    <Card aria-label={label} className="border border-border/70 shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold tracking-tight">{label}</CardTitle>
          <CardDescription className="hidden text-xs text-muted-foreground sm:block">
            Click any metric to instantly filter results
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Phones: swipeable row. Larger screens: grid. */}
        <div className="no-scrollbar -mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-8">
          <Tile label="Startups found" value={list.length} hint="Startups in this view" onClick={pick("all")} />
          <Tile
            label="Great matches"
            value={strong}
            tone="text-primary"
            hint="Have a job for your target role, in your locations, at your experience level"
            onClick={pick("great")}
          />
          <Tile
            label="Good matches"
            value={potential}
            tone="text-warning"
            hint="Have a job that fits, with something to check (location or role)"
            onClick={pick("good")}
          />
          <Tile
            label="Open jobs"
            value={list.reduce((n, s) => n + s.jobs.length, 0)}
            hint="All open jobs at these startups"
            onClick={pick("jobs")}
          />
          <Tile
            label="AI startups"
            value={list.filter(isAiStartup).length}
            hint="AI is central to their product"
            onClick={pick("ai")}
          />
          <Tile
            label="Funded recently"
            value={list.filter(isRecentlyFunded).length}
            tone="text-accent-brand-foreground"
            hint="Raised money in the last 6 months"
            onClick={pick("funded")}
          />
          <Tile
            label="New (2024+)"
            value={list.filter((s) => s.is_new_startup === true).length}
            hint="Founded in 2024 or later"
            onClick={pick("new")}
          />
          <Tile
            label="With email"
            value={list.filter((s) => s.emails.length > 0).length}
            hint="A contact email is published on their website"
            onClick={pick("email")}
          />
        </div>
      </CardContent>
    </Card>
  );
}
