"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { StartupAvatar } from "@/components/StartupAvatar";
import {
  CalendarIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  PlusIcon,
  MoreHorizontalIcon,
  Trash2Icon,
  RotateCwIcon,
} from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Row {
  id: number;
  startup_id: number | null;
  startup_name: string;
  website: string | null;
  job_id: number | null;
  job_title: string | null;
  job_url: string | null;
  careers_url: string | null;
  status: string;
  applied_at: string | null;
  application_url: string | null;
  notes: string | null;
  outcome: string | null;
}

/* ------------------------------------------------------------------ */
/*  Kanban columns                                                     */
/* ------------------------------------------------------------------ */

const COLUMNS: { key: string; label: string; statuses: string[]; accent: string }[] = [
  { key: "saved",     label: "Saved",        statuses: ["Saved", "Not Applied"], accent: "bg-blue-500" },
  { key: "applied",   label: "Applied",      statuses: ["Applied", "To Verify"], accent: "bg-amber-500" },
  { key: "interview", label: "Interviewing", statuses: ["Interview"],            accent: "bg-purple-500" },
  { key: "offer",     label: "Offer",        statuses: ["Offer"],               accent: "bg-emerald-500" },
  { key: "closed",    label: "Closed",       statuses: ["Rejected", "Not Interested"], accent: "bg-zinc-400" },
];

/** The canonical status stored when a card is moved to a column. */
const COLUMN_STATUS: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  closed: "Rejected",
};

/* ------------------------------------------------------------------ */
/*  Drag-and-drop helpers                                              */
/* ------------------------------------------------------------------ */

/** Data transferred during a drag: just the application ID. */
const DND_TYPE = "application/x-kanban-id";

/* ------------------------------------------------------------------ */
/*  Compact Kanban card                                                */
/* ------------------------------------------------------------------ */

function KanbanCard({
  row,
  onMove,
  onRemove,
}: {
  row: Row;
  onMove: (id: number, status: string) => void;
  onRemove: (row: Row) => void;
}) {
  const link = row.application_url ?? row.job_url ?? row.careers_url;
  const appliedDays = row.applied_at
    ? Math.floor((Date.now() - new Date(row.applied_at).getTime()) / 86_400_000)
    : null;

  const [dragging, setDragging] = useState(false);

  function onDragStart(e: React.DragEvent) {
    e.dataTransfer.setData(DND_TYPE, String(row.id));
    e.dataTransfer.effectAllowed = "move";
    // Small delay so the browser captures the element before we fade it
    requestAnimationFrame(() => setDragging(true));
  }

  function onDragEnd() {
    setDragging(false);
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-all hover:shadow-md active:cursor-grabbing",
        dragging && "opacity-40 ring-2 ring-primary/30"
      )}
    >
      {/* Header: avatar + name + menu */}
      <div className="flex items-start gap-2.5">
        <StartupAvatar name={row.startup_name} size="sm" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/applications/${row.id}`}
            className="block truncate text-[13px] font-semibold leading-tight hover:underline"
            draggable={false}
          >
            {row.startup_name}
          </Link>
          {row.job_title && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.job_title}</p>
          )}
        </div>

        {/* Quick-action menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              aria-label="Actions"
              draggable={false}
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link href={`/applications/${row.id}`}>View details</Link>
            </DropdownMenuItem>
            {link && (
              <DropdownMenuItem asChild>
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon className="mr-2 size-3.5" /> Open posting
                </a>
              </DropdownMenuItem>
            )}
            {row.startup_id && (
              <DropdownMenuItem asChild>
                <Link href={`/outreach/${row.startup_id}?style=follow_up${row.job_id ? `&jobId=${row.job_id}` : ""}`}>
                  <RotateCwIcon className="mr-2 size-3.5" /> Follow up
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs font-medium text-muted-foreground" disabled>
              Move to…
            </DropdownMenuItem>
            {COLUMNS.map((col) =>
              !col.statuses.includes(row.status) ? (
                <DropdownMenuItem key={col.key} onClick={() => onMove(row.id, COLUMN_STATUS[col.key])}>
                  <span className={cn("mr-2 inline-block size-2 rounded-full", col.accent)} />
                  {col.label}
                </DropdownMenuItem>
              ) : null
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onRemove(row)}>
              <Trash2Icon className="mr-2 size-3.5" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Meta line */}
      {row.applied_at && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarIcon className="size-3" />
          {new Date(row.applied_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          {appliedDays !== null && appliedDays >= 7 && (
            <span className="ml-auto rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              {appliedDays}d ago
            </span>
          )}
        </div>
      )}

      {row.notes && (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{row.notes}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Column                                                             */
/* ------------------------------------------------------------------ */

function KanbanColumn({
  col,
  rows,
  onMove,
  onRemove,
}: {
  col: (typeof COLUMNS)[number];
  rows: Row[];
  onMove: (id: number, status: string) => void;
  onRemove: (row: Row) => void;
}) {
  const [over, setOver] = useState(false);
  const dragCounter = useRef(0);

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    setOver(true);
  }

  function onDragLeave() {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setOver(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setOver(false);
    const id = Number(e.dataTransfer.getData(DND_TYPE));
    if (id) onMove(id, COLUMN_STATUS[col.key]);
  }

  return (
    <div
      className={cn(
        "flex w-[272px] shrink-0 flex-col rounded-xl transition-colors sm:w-auto sm:min-w-[240px] sm:flex-1",
        over ? "bg-primary/5 ring-2 ring-primary/20" : "bg-muted/40"
      )}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <span className={cn("size-2 rounded-full", col.accent)} />
        <span className="text-[13px] font-semibold">{col.label}</span>
        <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {rows.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3" style={{ maxHeight: "calc(100dvh - 14rem)" }}>
        {rows.length === 0 && (
          <div className={cn(
            "flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-xs text-muted-foreground/60 transition-colors",
            over ? "border-primary/30 bg-primary/5" : "border-transparent"
          )}>
            {over ? "Drop here" : "No items"}
          </div>
        )}
        {rows.map((r) => (
          <KanbanCard key={r.id} row={r} onMove={onMove} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Board                                                              */
/* ------------------------------------------------------------------ */

function KanbanBoard() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const { ok, status, data, error } = await api("/api/applications");
    if (status === 401) return router.replace("/onboarding");
    if (!ok) return setError(error);
    setError(null);
    setRows(data.applications ?? []);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback(async (id: number, p: Partial<Row>) => {
    // Optimistic update: move card instantly in the UI
    setRows((prev) =>
      prev?.map((r) => (r.id === id ? { ...r, ...p } : r)) ?? null
    );
    const { ok, error } = await api(`/api/applications/${id}`, { method: "PATCH", ...jsonBody(p) });
    if (!ok) {
      setError(error);
      load(); // revert on failure
    }
  }, [load]);

  async function remove(r: Row) {
    setRemoveTarget(null);
    const { ok, error } = await api(`/api/applications/${r.id}`, { method: "DELETE" });
    if (!ok) setError(error);
    else load();
  }

  const onMove = useCallback(
    (id: number, status: string) => {
      patch(id, { status } as Partial<Row>);
    },
    [patch]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const col of COLUMNS) map.set(col.key, []);
    for (const r of rows ?? []) {
      const col = COLUMNS.find((c) => c.statuses.includes(r.status));
      if (col) map.get(col.key)!.push(r);
    }
    return map;
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag cards between columns to update status. Click a card to see details.
          </p>
        </div>
        <Link href="/discover" className={buttonVariants({ size: "sm" })}>
          <PlusIcon className="mr-1.5 size-3.5" /> Find jobs
        </Link>
      </div>

      {error && (
        <Banner
          tone="error"
          action={
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          }
          onDismiss={() => setError(null)}
        >
          {error}
        </Banner>
      )}

      {!rows && !error && <PageSkeleton variant="list" count={4} />}

      {rows && rows.length === 0 && (
        <EmptyState
          icon={ClipboardListIcon}
          title="Nothing saved yet"
          actions={
            <Link href="/discover" className={buttonVariants()}>
              Discover jobs
            </Link>
          }
        >
          Tap <b className="font-semibold">Save</b> on a startup or job you like. It shows up here so you can track it through every stage.
        </EmptyState>
      )}

      {/* Kanban board */}
      {rows && rows.length > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              col={col}
              rows={grouped.get(col.key) ?? []}
              onMove={onMove}
              onRemove={setRemoveTarget}
            />
          ))}
        </div>
      )}

      {/* Confirm remove dialog */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from your list?</DialogTitle>
            <DialogDescription>
              {removeTarget?.job_title ?? removeTarget?.startup_name} will be taken off your board. Messages you already sent aren&apos;t unsent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" onClick={() => removeTarget && remove(removeTarget)}>
              <Trash2Icon /> Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="list" count={4} />}>
      <KanbanBoard />
    </Suspense>
  );
}
