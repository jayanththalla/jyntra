// Page and component skeletons. Each mirrors the final layout's dimensions so nothing shifts when data arrives.
// Shimmer comes from <Skeleton>; it is switched off for prefers-reduced-motion in globals.css.
import { Skeleton } from "@/components/ui/skeleton";
import { Skeleton as VariantSkeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

const Busy = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
  <div role="status" aria-live="polite" aria-busy="true" className={className}><span className="sr-only">{label}…</span>{children}</div>
);

export function HeroSkeleton() {
  return (
    <div className="hero-zone relative -mx-4 -mt-6 overflow-hidden px-5 pb-16 pt-7 sm:mx-0 sm:mt-0 sm:rounded-3xl sm:px-9 sm:pt-9 sm:pb-20">
      <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <Skeleton className="h-3 w-40 bg-white/25" /><Skeleton className="h-10 w-3/4 max-w-sm bg-white/25 sm:h-12" />
          <Skeleton className="h-4 w-full max-w-md bg-white/20" /><Skeleton className="h-4 w-2/3 max-w-sm bg-white/20" />
          <Skeleton className="mt-2 h-11 w-48 rounded-full bg-white/30" />
        </div>
        <Skeleton className="hidden h-40 w-56 rounded-3xl bg-white/15 sm:block lg:h-48 lg:w-72" />
      </div>
    </div>
  );
}
export function QuickActionSkeleton() { return <div className="tile flex min-h-[8.5rem] flex-col justify-between p-4"><Skeleton className="size-11 rounded-xl" /><div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></div></div>; }
export function MetricSkeleton() { return <div className="space-y-2 pl-4 first:pl-0"><Skeleton className="h-3 w-20" /><Skeleton className="h-8 w-14" /><Skeleton className="h-3 w-24" /></div>; }
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return <div className={cn("divide-y divide-border border-y border-border", className)}>{Array.from({ length: rows }).map((_, i) => <div key={i} className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-4 w-12" /></div>)}</div>;
}
export const RepositoryRowSkeleton = () => <div className="flex items-center gap-3 py-3"><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full max-w-md" /><div className="flex gap-2"><Skeleton className="h-4 w-14" /><Skeleton className="h-4 w-14" /></div></div><Skeleton className="h-8 w-20 rounded-full" /></div>;
export const FundingStorySkeleton = () => <div className="space-y-2 py-4"><Skeleton className="h-3 w-40" /><Skeleton className="h-5 w-11/12" /><Skeleton className="h-5 w-2/3" /><div className="flex gap-2 pt-1"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-20" /></div></div>;

export function DashboardSkeleton() {
  return (
    <Busy label="Loading your dashboard" className="space-y-8">
      <div className="hero-zone relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10 sm:py-10">
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <Skeleton className="h-3 w-40 bg-white/25" /><Skeleton className="h-12 w-3/4 max-w-sm bg-white/25" />
            <Skeleton className="h-4 w-full max-w-md bg-white/20" /><Skeleton className="h-4 w-2/3 max-w-sm bg-white/20" />
            <Skeleton className="mt-3 h-11 w-48 rounded-full bg-white/30" />
          </div>
          <Skeleton className="hidden h-44 w-52 rounded-3xl bg-white/15 sm:block lg:w-60" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[9.5rem] rounded-2xl" />)}</div>
      <Skeleton className="h-24 w-full rounded-2xl" />
      <div className="grid grid-cols-2 divide-x divide-border lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <MetricSkeleton key={i} />)}</div>
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-7"><Skeleton className="h-60 w-full rounded-3xl" /><ListSkeleton rows={4} /></div>
        <div className="space-y-8 lg:col-span-5"><ListSkeleton rows={3} /><ActivityTimelineSkeleton rows={4} /></div>
      </div>
    </Busy>
  );
}

export function InterviewSetupSkeleton() {
  return (
    <Busy label="Loading interview setup" className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-[8.5rem] rounded-2xl" />)}</div>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5"><div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-12 rounded-md" /><Skeleton className="h-12 rounded-md" /></div><Skeleton className="h-12 rounded-md" /><div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div><Skeleton className="h-28 rounded-md" /><Skeleton className="h-11 w-40 rounded-full" /></div>
        <VariantSkeleton variant="interview-progress" count={3} />
      </div>
    </Busy>
  );
}

export function AtlasWorkspaceSkeleton() {
  return (
    <Busy label="Loading Atlas" className="grid min-h-[60vh] gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="hidden space-y-3 lg:block"><Skeleton className="h-10 w-full rounded-xl" />{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
      <div className="flex min-h-0 flex-col gap-4"><div className="flex-1 space-y-4"><Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" /><Skeleton className="h-28 w-full max-w-2xl rounded-2xl" /><Skeleton className="h-16 w-4/5 max-w-xl rounded-2xl" /></div><Skeleton className="h-14 w-full rounded-2xl" /></div>
    </Busy>
  );
}
export function FundingFeedSkeleton() {
  return (
    <div className="space-y-6"><PageHeaderSkeleton /><VariantSkeleton variant="news-grid" count={6} /></div>
  );
}

export function OpenSourceSkeleton() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <Skeleton className="h-[5.25rem] w-full rounded-2xl" />
      <VariantSkeleton variant="card-list" count={5} />
    </div>
  );
}

export function DiscoverSkeleton() {
  return (
    <Busy label="Loading Discover" className="space-y-5">
      <Skeleton className="h-10 w-1/3" /><Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
    </Busy>
  );
}

/* ───── component skeletons ───── */
export const TextSkeleton = ({ lines = 3, className }: { lines?: number; className?: string }) => <div className={cn("space-y-2", className)}>{Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />)}</div>;
export const ButtonSkeleton = ({ className }: { className?: string }) => <Skeleton className={cn("h-10 w-28 rounded-xl", className)} />;
export const AvatarSkeleton = ({ size = "size-10" }: { size?: string }) => <Skeleton className={cn("rounded-full", size)} />;
export const SearchSkeleton = () => <Skeleton className="h-11 w-full rounded-xl" />;
export const IllustrationSkeleton = ({ className }: { className?: string }) => <Skeleton className={cn("h-32 w-44 rounded-3xl", className)} />;
export const PageHeaderSkeleton = () => (
  <div className="flex items-center justify-between gap-4 rounded-3xl bg-indigo-soft px-5 py-5 sm:px-8 sm:py-7">
    <div className="min-w-0 flex-1 space-y-3"><Skeleton className="h-3 w-24 bg-indigo/15" /><Skeleton className="h-9 w-2/3 max-w-md bg-indigo/15" /><Skeleton className="h-4 w-full max-w-lg bg-indigo/10" /></div>
    <IllustrationSkeleton className="hidden bg-indigo/10 sm:block" />
  </div>
);
export const CardSkeletonBlock = ({ className }: { className?: string }) => <div className={cn("tile space-y-3 p-4", className)}><Skeleton className="h-4 w-1/3" /><TextSkeleton lines={2} /><Skeleton className="h-8 w-24 rounded-xl" /></div>;
export function ChartSkeleton({ className }: { className?: string }) {
  return <div className={cn("flex h-36 items-end gap-2 border-b border-border", className)}>{[40, 62, 48, 80, 70, 92].map((h, i) => <Skeleton key={i} className="flex-1 rounded-b-none rounded-t-md" style={{ height: `${h}%` }} />)}</div>;
}
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return <div className="overflow-x-auto"><div className="min-w-[28rem] divide-y divide-border border-y border-border">{Array.from({ length: rows }).map((_, r) => <div key={r} className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>{Array.from({ length: cols }).map((__, c) => <Skeleton key={c} className="h-4 w-4/5" />)}</div>)}</div></div>;
}
export const ActivityTimelineSkeleton = ({ rows = 4 }: { rows?: number }) => <ul className="space-y-4">{Array.from({ length: rows }).map((_, i) => <li key={i} className="flex gap-3"><Skeleton className="size-8 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/3" /></div></li>)}</ul>;
export const DialogSkeleton = () => <div className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card p-6"><Skeleton className="h-6 w-1/2" /><TextSkeleton lines={3} /><SearchSkeleton /><div className="flex justify-end gap-2"><ButtonSkeleton className="w-20" /><ButtonSkeleton /></div></div>;

/* ───── page skeletons ───── */
export function InterviewWorkspaceSkeleton() {
  return (
    <Busy label="Loading interview" className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-20 rounded-full" /></div>
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="tile space-y-3 p-6"><Skeleton className="h-3 w-24" /><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-4/5" /></div>
      <Skeleton className="h-44 w-full rounded-2xl" />
      <div className="flex justify-end"><ButtonSkeleton className="w-36" /></div>
    </Busy>
  );
}
export function InterviewResultSkeleton() {
  return (
    <Busy label="Loading your report" className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]"><div className="tile flex flex-col items-center gap-3 p-6"><Skeleton className="size-32 rounded-full" /><Skeleton className="h-4 w-24" /></div><div className="tile space-y-4 p-6">{[0, 1, 2].map((i) => <div key={i} className="space-y-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-2.5 w-full rounded-full" /></div>)}</div></div>
      <div className="grid gap-4 sm:grid-cols-2"><CardSkeletonBlock /><CardSkeletonBlock /></div>
      <ListSkeleton rows={3} />
    </Busy>
  );
}
export function AtlasSourcesSkeleton() { return <Busy label="Loading sources" className="space-y-2"><SearchSkeleton />{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3"><Skeleton className="size-9 rounded-lg" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/3" /></div></div>)}</Busy>; }
export function AtlasConversationSkeleton() { return <Busy label="Loading conversation" className="space-y-4"><Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" /><div className="space-y-2"><TextSkeleton lines={4} className="max-w-2xl" /><div className="flex gap-2"><Skeleton className="h-6 w-20 rounded-full" /><Skeleton className="h-6 w-24 rounded-full" /></div></div></Busy>; }
export function RepositoryDetailSkeleton() { return <Busy label="Loading repository" className="space-y-6"><PageHeaderSkeleton /><div className="grid gap-6 lg:grid-cols-[1fr_20rem]"><div className="space-y-4"><TextSkeleton lines={5} /><ListSkeleton rows={4} /></div><div className="space-y-3"><CardSkeletonBlock /><CardSkeletonBlock /></div></div></Busy>; }
export function FundingDetailSkeleton() { return <Busy label="Loading story" className="mx-auto max-w-3xl space-y-5"><Skeleton className="h-4 w-40" /><Skeleton className="h-9 w-11/12" /><Skeleton className="h-9 w-2/3" /><div className="flex gap-2"><Skeleton className="h-6 w-20 rounded-full" /><Skeleton className="h-6 w-24 rounded-full" /></div><TextSkeleton lines={6} /><ChartSkeleton /></Busy>; }
export function ProfileSkeleton() { return <Busy label="Loading profile" className="space-y-6"><div className="flex items-center gap-4"><AvatarSkeleton size="size-20" /><div className="flex-1 space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-64 max-w-full" /></div></div><Skeleton className="h-2.5 w-full rounded-full" /><div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <CardSkeletonBlock key={i} />)}</div></Busy>; }
export function SettingsSkeleton() { return <Busy label="Loading settings" className="space-y-6"><PageHeaderSkeleton /><div className="grid gap-6 lg:grid-cols-[14rem_1fr]"><div className="hidden space-y-2 lg:block">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div><div className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="tile space-y-3 p-5"><Skeleton className="h-5 w-40" /><Skeleton className="h-11 w-full rounded-xl" /><Skeleton className="h-11 w-full rounded-xl" /></div>)}</div></div></Busy>; }
