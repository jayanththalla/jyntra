"use client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ExternalLinkIcon, MapPinIcon } from "@/components/icons";
import { CITY_BY_ID, SECTOR_BY_ID } from "@/lib/news/taxonomy";
import { cn } from "@/lib/utils";
import { AnalysisPanel } from "./AnalysisPanel";
import { VerificationBadge, verificationBar } from "./VerificationBadge";
import { fmtDate, type Article } from "./types";

const tag = "inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-card px-2 font-mono text-[11px] text-foreground/80 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring";

export function StoryCard({ a, compact, featured = false, onCity, onSector }: { a: Article; compact: boolean; featured?: boolean; onCity: (id: string) => void; onSector: (id: string) => void }) {
  const city = a.city ? CITY_BY_ID.get(a.city) : null;
  const sector = a.sector ? SECTOR_BY_ID.get(a.sector) : null;
  return (
    <li className={cn("relative flex flex-col border-b border-border py-5 pl-4", featured && "border-b-0 py-6 pl-5")}>
      <span aria-hidden className={cn("absolute inset-y-5 left-0 w-[3px]", verificationBar(a.verification))} />

      <div className="mb-2 flex items-center justify-between gap-2">
        <VerificationBadge status={a.verification} outlets={a.outlets} />
        <time dateTime={a.published_at ?? undefined} className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {fmtDate(a.published_at) ?? "No date given"}
        </time>
      </div>

      <a href={a.url} target="_blank" rel="noopener noreferrer" className={cn("display line-clamp-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring", featured ? "text-[1.75rem] sm:text-[2.25rem]" : "text-[19px] leading-snug")}>
        {a.headline}
      </a>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{a.publisher}</p>

      {(a.funding_amount || a.funding_round) && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {a.funding_amount && <span className={cn("font-mono font-semibold tabular-nums leading-none", featured ? "text-2xl" : "text-base")}>{a.funding_amount}</span>}
          {a.funding_round && <span className="text-xs text-muted-foreground">{a.funding_round}</span>}
          <span className="text-[11px] text-muted-foreground/80">from the headline</span>
        </p>
      )}

      {(city || sector) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {city && (
            <button type="button" className={cn(tag, "hover:border-foreground")} onClick={() => onCity(city.id)} title={a.city_source === "company_record" ? "City from the company record" : "City stated in the story"}>
              <MapPinIcon className="size-3" aria-hidden />
              {city.label}
              <span className="sr-only">: show only this city</span>
            </button>
          )}
          {sector && (
            <button type="button" className={cn(tag, "hover:border-foreground")} onClick={() => onSector(sector.id)} title={a.sector_source === "ai" ? "Sector classified by an AI model from the headline" : "Sector matched from words in the story"}>
              {sector.label}
              {a.sector_source === "ai" && <span className="text-[10px] text-accent-brand-foreground">AI</span>}
              <span className="sr-only">: show only this sector</span>
            </button>
          )}
        </div>
      )}

      {a.investors.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Investors named: {a.investors.slice(0, 4).join(", ")}</p>}
      {a.also_reported.length > 0 && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Also reported by{" "}
          {a.also_reported.slice(0, 3).map((r, i) => (
            <span key={r.url}>
              {i > 0 && ", "}
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-accent-brand-foreground hover:underline">
                {r.publisher}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </span>
          ))}
        </p>
      )}
      {!compact && a.summary && <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{a.summary}</p>}

      {!compact && (a.links.website || a.links.careers || a.links.linkedin) && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label={`${a.company_name ?? "Company"} links`}>
          {(
            [
              ["Official site", a.links.website],
              ["Careers page", a.links.careers],
              ["LinkedIn", a.links.linkedin],
            ] as const
          ).map(([label, l]) =>
            l ? (
              <li key={label}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.status === "verified" ? `Verified: ${l.basis}` : `Unverified: ${l.basis}`} className="inline-flex items-center gap-1 text-accent-brand-foreground hover:underline">
                  {label}
                  {l.status === "unverified" && <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">unverified</Badge>}
                  <ExternalLinkIcon className="size-3" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ) : null
          )}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-3 text-xs">
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-accent-brand-foreground hover:underline">
          Open article <ExternalLinkIcon className="size-3" />
          <span className="sr-only"> at {a.publisher} (opens in a new tab)</span>
        </a>
        <span className="flex flex-wrap items-center gap-3">
          {a.startup_id && a.listed_roles > 0 && (
            <Link href={`/startups/${a.startup_id}`} className="font-medium text-accent-brand-foreground hover:underline">
              {a.listed_roles} listed role{a.listed_roles === 1 ? "" : "s"}
            </Link>
          )}
          {a.startup_id && a.announcement_kind === "confirmed" && (
            <Link href={`/outreach/${a.startup_id}`} className="font-medium text-accent-brand-foreground hover:underline">
              Draft outreach
            </Link>
          )}
        </span>
      </div>

      {!compact && <AnalysisPanel article={a} />}
    </li>
  );
}
