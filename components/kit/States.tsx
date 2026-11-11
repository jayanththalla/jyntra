"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircleIcon, RotateCcwIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Skeleton that mirrors a page: `rows` ruled lines under a title. Announced politely to screen readers. */
export function LoadingState({ rows = 4, className, label = "Loading" }: { rows?: number; className?: string; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("space-y-4", className)}>
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-9 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      <div className="space-y-3 pt-4">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
    </div>
  );
}

/** A failed request: says what happened and offers a retry. Never silent, never a permanent spinner. */
export function ErrorState({ title = "Something went wrong", children, onRetry }: { title?: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <AlertCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {children && <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>}
      </div>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}><RotateCcwIcon />Retry</Button>}
    </div>
  );
}
