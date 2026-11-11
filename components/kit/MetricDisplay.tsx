import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One number with its label. No card: metrics sit on a ruled strip so the page does not become a grid of boxes. */
export function MetricDisplay({ label, value, unit, caption, href, className }: { label: string; value: ReactNode; unit?: string; caption?: ReactNode; href?: string; className?: string }) {
  const body = (
    <div className={cn("flex h-full flex-col gap-1 py-4 pr-4", className)}>
      <p className="eyebrow">{label}</p>
      <p className="display tabular text-[2.25rem] leading-none sm:text-[2.75rem]">{value}{unit && <span className="ml-1 font-sans text-sm font-normal text-muted-foreground">{unit}</span>}</p>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-sm outline-none hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}
