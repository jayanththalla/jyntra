"use client";
import { LEVEL_INFO, type Summary } from "./types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CLS: Record<string, string> = {
  demonstrated: "border-success/40 text-success",
  self_reported: "bg-secondary text-accent-brand-foreground",
  inferred: "border-warning/40 text-warning",
  unverified: "text-muted-foreground",
};
export function LevelBadge({ level, children }: { level: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" title={`${LEVEL_INFO[level]?.label ?? level}: ${LEVEL_INFO[level]?.hint ?? ""}`} className={cn("cursor-help", CLS[level])}>{children}</Badge>
  );
}

function Group({ title, items }: { title: string; items: { name: string; level: string }[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{items.map((i) => <LevelBadge key={i.name} level={i.level}>{i.name}</LevelBadge>)}</div>
    </div>
  );
}

export function KnowledgeProfile({ s, hideTitle = false }: { s: Summary; hideTitle?: boolean }) {
  const empty = !s.projects.length && !s.skills.length && !s.coding.length;
  return (
    <section aria-labelledby="kp-h" className="space-y-3">
      {!hideTitle && <h2 id="kp-h" className="text-sm font-semibold">What I know about you</h2>}
      {empty ? (
        <p className="text-sm text-muted-foreground">Nothing extracted yet. Add a source and this fills in from your own documents. Nothing here is made up.</p>
      ) : (
        <>
          <Group title="Projects" items={s.projects.map((p) => ({ name: p.name, level: p.level }))} />
          <Group title="Skills" items={s.skills} />
          <Group title="Coding" items={s.coding} />
          <ul className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground" aria-label="Evidence levels">
            {Object.entries(LEVEL_INFO).map(([k, v]) => <li key={k}><span className="font-medium">{v.label}</span>: {v.hint}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
