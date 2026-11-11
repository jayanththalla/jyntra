import Link from "next/link";
import type { IconComponent } from "@/components/icons";

export interface TimelineEntry { id: string; at: string | null; title: string; meta?: string; href?: string; external?: boolean; icon: IconComponent }

const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—");

/** Vertical timeline: mono date, rule with a node, then the event. Dates come from the records themselves. */
export function ActivityTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="relative">
      {entries.map((e, idx) => {
        const inner = (
          <>
            <span className="w-14 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground tabular">{fmt(e.at)}</span>
            <span className="relative flex w-5 shrink-0 justify-center" aria-hidden>
              {idx < entries.length - 1 && <span className="absolute left-1/2 top-4 h-[calc(100%+0.5rem)] w-px -translate-x-1/2 bg-border" />}
              <span className="relative z-10 mt-0.5 flex size-5 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground"><e.icon className="size-3" /></span>
            </span>
            <span className="min-w-0 pb-5">
              <span className="block truncate text-sm font-medium">{e.title}</span>
              {e.meta && <span className="block truncate text-xs text-muted-foreground">{e.meta}</span>}
            </span>
          </>
        );
        const cls = "flex gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
        return (
          <li key={e.id}>
            {e.href ? (e.external ? <a href={e.href} target="_blank" rel="noopener noreferrer" className={`${cls} hover:[&_span.truncate]:underline`}>{inner}</a> : <Link href={e.href} className={cls}>{inner}</Link>) : <div className={cls}>{inner}</div>}
          </li>
        );
      })}
    </ol>
  );
}
