"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Markdown } from "./Markdown";
import { LEVEL_INFO, relTime, type Answer } from "./types";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/Banner";
import { ChevronDownIcon, ExternalLinkIcon, FileTextIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

const isHttp = (u: string | null) => !!u && /^https?:\/\//i.test(u);

/** The answer text, notices, deterministic skill analysis and citation cards. Used by the workspace and the compact popovers. */
export function AnswerView({ a, compact = false, chat = false }: { a: Answer; compact?: boolean; chat?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(!chat);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const cite = (id: string) => {
    setOpen(id);
    setShowSources(true);
    setTimeout(() => refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  };
  return (
    <div className="space-y-3">
      {a.insufficient ? (
        <Banner tone="warn">Not enough evidence in your knowledge base to answer this about you.</Banner>
      ) : null}
      <Markdown text={a.answer} onCite={cite} />
      {a.notices.map((n) => (
        <Banner key={n} tone="warn">{n}</Banner>
      ))}
      {a.analysis && (a.analysis.required.length > 0 || a.analysis.gaps.length > 0) && (
        <div className="rounded-md border border-border bg-secondary/50 p-3 text-xs">
          <p className="mb-1.5 font-semibold uppercase tracking-wide text-muted-foreground">Skill check (from the job text and your evidence)</p>
          <div className="flex flex-wrap gap-1.5">
            {a.analysis.matched.map((m) => (
              <Badge key={m.skill} variant="outline" title={LEVEL_INFO[m.level]?.hint} className={cn(m.level === "demonstrated" ? "border-success/40 text-success" : "border-warning/40 text-warning")}>
                {m.skill} · {LEVEL_INFO[m.level]?.label ?? m.level}
              </Badge>
            ))}
            {a.analysis.gaps.map((g) => (
              <Badge key={g} variant="destructive" title="Asked for by the job; no evidence found">{g} · no evidence</Badge>
            ))}
          </div>
        </div>
      )}
      {a.citations.length > 0 && (
        <div className="space-y-2">
          {chat ? (
            <button type="button" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border/70 px-3 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <FileTextIcon className="size-3.5" /> Sources ({a.citations.length})
              <ChevronDownIcon className={cn("size-3.5 transition-transform", showSources && "rotate-180")} />
            </button>
          ) : (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources used ({a.citations.length} of {a.consulted} consulted)</p>
          )}
          {showSources && <ul className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
            {a.citations.map((c) => (
              <li key={c.id} ref={(el) => { refs.current[c.id] = el; }} className={cn("rounded-md border bg-card p-2.5 text-xs", open === c.id ? "border-brand-violet/60 ring-1 ring-brand-violet/30" : "border-border/70")}>
                <div className="flex items-start gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-foreground font-mono text-[10px] font-semibold text-background">{c.id}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate font-medium text-foreground">
                      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      {isHttp(c.url) ? (
                        <a href={c.url!} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{c.title}<span className="sr-only"> (opens in a new tab)</span></a>
                      ) : (
                        <span className="truncate">{c.title}</span>
                      )}
                      {isHttp(c.url) && <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />}
                    </p>
                    <p className="text-muted-foreground">{c.provider} · {c.docType}{c.locator ? ` · ${c.locator}` : ""}</p>
                    {c.source && (
                      <p className={cn("text-[11px]", c.source.state === "stale" || c.source.state === "failed" ? "text-warning" : "text-muted-foreground")}>
                        {c.source.label}: {c.source.lastSyncedAt ? `indexed ${relTime(c.source.lastSyncedAt)}` : "not indexed yet"}
                        {c.source.state === "stale" ? " · refresh queued" : c.source.state === "syncing" ? " · refreshing" : c.source.state === "failed" ? " · last refresh failed" : ""}
                      </p>
                    )}
                    {(open === c.id || !compact) && <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-muted-foreground">{c.snippet}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>}
        </div>
      )}
      {!compact ? null : (
        <Link href="/career-ai" className="inline-flex text-xs font-medium text-accent-brand-foreground hover:underline">Open in Atlas</Link>
      )}
    </div>
  );
}
