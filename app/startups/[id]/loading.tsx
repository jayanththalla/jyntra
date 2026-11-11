import { PageSkeleton } from "@/components/PageSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Route-level fallback: a header placeholder, then the shared body skeleton. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <PageSkeleton variant="cards" count={4} />
    </div>
  );
}
