// THE loading component. Usage:  <Skeleton variant="card-list" | "news-grid" | "interview-progress" count={n} />
// Each variant copies the real content's layout (same columns, rows and approximate heights), so nothing jumps when data lands.
// Rules used across the app:
//   1. First load of a page  -> <Skeleton variant=… /> in place of the content (header, sidebar and nav stay visible).
//   2. Any later reload / filter change -> <RefreshShimmer active> over the content that is already there. Never a skeleton again.
//   3. Empty states render only once loading has finished and the real data is empty.
import { Bone } from "@/components/skeletons/bone";
import { cn } from "@/lib/utils";

export type SkeletonVariant = "card-list" | "news-grid" | "interview-progress" | "startup-cards" | "list" | "form" | "table";

const Busy = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
  <div role="status" aria-busy="true" aria-live="polite" className={className}><span className="sr-only">{label}</span>{children}</div>
);

/* ── card-list: Open Source (and any list of repository-style rows) ── */
function RepoRow() {
  return (
    <div className="grid gap-x-8 gap-y-3 border-b border-border py-5 md:grid-cols-2">
      <div className="space-y-2.5">
        <Bone className="h-4 w-2/3" />
        <Bone className="h-3.5 w-full" /><Bone className="h-3.5 w-4/5" />
        <div className="flex gap-3 pt-1"><Bone className="h-3 w-16" /><Bone className="h-3 w-12" /><Bone className="h-3 w-24" /></div>
      </div>
      <div className="space-y-2.5 border-l-2 border-indigo/20 pl-4">
        <Bone className="h-3 w-24" /><Bone className="h-4 w-11/12" /><Bone className="h-3 w-3/4" />
        <div className="flex gap-2 pt-1"><Bone className="h-8 w-36 rounded-full" /><Bone className="h-8 w-28 rounded-full" /></div>
      </div>
    </div>
  );
}
function CardList({ count, toolbar }: { count: number; toolbar: boolean }) {
  return (
    <Busy label="Loading projects" className="space-y-4">
      {toolbar && (
        <div className="space-y-3 border-b border-border pb-4">
          <div className="flex flex-col gap-3 md:flex-row"><Bone className="h-10 flex-1 rounded-md" /><Bone className="h-10 w-full rounded-md md:w-56" /></div>
          <div className="flex flex-wrap gap-2">{[28, 24, 28, 32, 28].map((w, i) => <Bone key={i} className="h-9 rounded-full" style={{ width: `${w * 4}px` }} />)}</div>
        </div>
      )}
      <Bone className="h-4 w-24" />
      <div className="border-t border-foreground/20">{Array.from({ length: count }, (_, i) => <RepoRow key={i} />)}</div>
    </Busy>
  );
}

/* ── news-grid: Funding news (filter bar, one featured story, two columns of stories) ── */
function Story({ tall }: { tall?: boolean }) {
  return (
    <div className="space-y-2.5 border-b border-border py-5">
      <div className="flex justify-between"><Bone className="h-5 w-28 rounded-full" /><Bone className="h-3.5 w-20" /></div>
      <Bone className="h-5 w-11/12" /><Bone className="h-5 w-2/3" />
      <Bone className="h-3 w-40" />
      <div className="flex items-baseline gap-2"><Bone className="h-6 w-28" /><Bone className="h-3 w-24" /></div>
      <Bone className="h-3.5 w-full" /><Bone className={cn("h-3.5", tall ? "w-full" : "w-4/5")} />
      {tall && <Bone className="h-3.5 w-3/5" />}
      <div className="flex justify-between pt-1"><Bone className="h-3.5 w-24" /><Bone className="h-3.5 w-24" /></div>
    </div>
  );
}
function NewsGrid({ count, toolbar }: { count: number; toolbar: boolean }) {
  const half = Math.ceil(count / 2);
  return (
    <Busy label="Loading funding news" className="space-y-3">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2">
          <Bone className="h-9 w-72 rounded-lg" /><Bone className="h-9 w-32 rounded-md" /><Bone className="h-9 w-32 rounded-md" /><Bone className="h-9 w-24 rounded-full" />
        </div>
      )}
      <Bone className="h-3 w-3/4 max-w-xl" />
      <div className="border-l-4 border-indigo/20 pl-4"><div className="space-y-3 py-4">
        <Bone className="h-4 w-24 rounded-full" /><Bone className="h-9 w-11/12" /><Bone className="h-3 w-40" /><Bone className="h-8 w-40" /><Bone className="h-4 w-full max-w-2xl" />
      </div></div>
      <div className="grid gap-x-10 border-t border-foreground/20 lg:grid-cols-2">
        <div>{Array.from({ length: half }, (_, i) => <Story key={i} tall={i % 2 === 0} />)}</div>
        <div className="hidden lg:block">{Array.from({ length: count - half }, (_, i) => <Story key={i} tall={i % 2 === 1} />)}</div>
      </div>
    </Busy>
  );
}

/* ── interview-progress: the "Your progress" rail beside the setup form (and the dashboard progress block) ── */
function InterviewProgress({ count }: { count: number }) {
  return (
    <Busy label="Loading your progress" className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {[0, 1].map((i) => <div key={i} className="space-y-2"><Bone className="h-3 w-14" /><Bone className="h-10 w-16" /></div>)}
      </div>
      <div className="divide-y divide-border border-y border-border">
        {Array.from({ length: count }, (_, i) => <div key={i} className="flex items-center gap-3 py-3"><Bone className="h-4 flex-1" /><Bone className="h-4 w-12" /></div>)}
      </div>
      <Bone className="h-3 w-36" />
    </Busy>
  );
}

/* ── startup-cards: Discover / Hyderabad / YC grids ── */
function StartupCards({ count }: { count: number }) {
  return (
    <Busy label="Loading results" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <div className="flex gap-3"><Bone className="size-11 rounded-xl" /><div className="flex-1 space-y-2 pt-1"><Bone className="h-4 w-1/3" /><Bone className="h-3 w-1/2" /></div><Bone className="h-11 w-12 rounded-lg" /></div>
          <div className="flex gap-1.5"><Bone className="h-5 w-16 rounded-full" /><Bone className="h-5 w-14 rounded-full" /><Bone className="h-5 w-20 rounded-full" /></div>
          <Bone className="h-3 w-full" /><Bone className="h-3 w-4/5" /><Bone className="h-16 w-full rounded-xl" />
        </div>
      ))}
    </Busy>
  );
}
function Rows({ count }: { count: number }) {
  return (
    <Busy label="Loading" className="divide-y divide-border border-y border-border">
      {Array.from({ length: count }, (_, i) => <div key={i} className="flex items-center gap-3 py-4"><Bone className="size-10 rounded-lg" /><div className="flex-1 space-y-2"><Bone className="h-4 w-1/3" /><Bone className="h-3 w-3/4" /></div><Bone className="hidden h-8 w-20 sm:block" /></div>)}
    </Busy>
  );
}
function FormBlocks({ count }: { count: number }) {
  return (
    <Busy label="Loading" className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-border bg-card p-5"><Bone className="h-5 w-40" /><Bone className="h-3 w-2/3" /><Bone className="h-10 w-full rounded-md" /><Bone className="h-10 w-full rounded-md" /></div>
      ))}
    </Busy>
  );
}
function Table({ count }: { count: number }) {
  return (
    <Busy label="Loading" className="overflow-hidden rounded-2xl border border-border bg-card">
      {Array.from({ length: count + 1 }, (_, i) => <div key={i} className="flex items-center gap-4 border-b border-border/60 p-3 last:border-0"><Bone className="h-4 w-1/4" /><Bone className="h-4 w-1/6" /><Bone className="h-4 w-1/6" /></div>)}
    </Busy>
  );
}

const DEFAULT_COUNT: Record<SkeletonVariant, number> = { "card-list": 5, "news-grid": 6, "interview-progress": 3, "startup-cards": 6, list: 5, form: 3, table: 6 };

export function Skeleton({ variant, count, toolbar = true }: { variant: SkeletonVariant; count?: number; /** include the filter/search bar placeholder (pages whose real filter bar appears with data) */ toolbar?: boolean }) {
  const n = count ?? DEFAULT_COUNT[variant];
  switch (variant) {
    case "card-list": return <CardList count={n} toolbar={toolbar} />;
    case "news-grid": return <NewsGrid count={n} toolbar={toolbar} />;
    case "interview-progress": return <InterviewProgress count={n} />;
    case "startup-cards": return <StartupCards count={n} />;
    case "list": return <Rows count={n} />;
    case "form": return <FormBlocks count={n} />;
    case "table": return <Table count={n} />;
  }
}

/** Rule 2: once content exists, reloading only washes a light shimmer over it. Wrap the content area, pass `active={loading}`. */
export function RefreshShimmer({ active, className, children }: { active: boolean; className?: string; children: React.ReactNode }) {
  return <div className={cn("refresh-shimmer", className)} data-active={active} aria-busy={active}>{children}</div>;
}
