"use client";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/SelectField";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [10, 20, 30] as const;

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  // Generate visible page numbers
  const pages: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("ellipsis");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("ellipsis");
    pages.push(totalPages);
  }

  if (total === 0) return null;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
      {/* Page info & size selector */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          Showing <b className="font-semibold text-foreground">{start}–{end}</b> of{" "}
          <b className="font-semibold text-foreground">{total}</b>
        </span>
        <span className="text-muted-foreground/50">·</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs">Per page</span>
          <SelectField
            aria-label="Items per page"
            value={String(pageSize)}
            onValueChange={(v) => {
              onPageSizeChange(Number(v));
              onPageChange(1);
            }}
            options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            className="w-18"
          />
        </div>
      </div>

      {/* Page numbers */}
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={!canPrev} aria-label="Previous page">
          <ArrowLeftIcon className="size-4" />
        </Button>

        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e-${i}`} className="flex size-8 items-center justify-center text-sm text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? "default" : "ghost"}
              size="icon-sm"
              onClick={() => onPageChange(p)}
              aria-current={p === page ? "page" : undefined}
              className={cn(
                "tabular-nums",
                p === page && "bg-brand-gradient text-white hover:opacity-90"
              )}
            >
              {p}
            </Button>
          )
        )}

        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={!canNext} aria-label="Next page">
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
