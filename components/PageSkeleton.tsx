import { Skeleton, type SkeletonVariant } from "@/components/Skeleton";

/** Back-compat wrapper for older call sites. New code uses <Skeleton variant=… /> directly. No banner, no "getting ready" text. */
type Legacy = "cards" | "list" | "stats" | "table" | "form";
const MAP: Record<Legacy, SkeletonVariant> = { cards: "startup-cards", list: "list", stats: "list", table: "table", form: "form" };
export function PageSkeleton({ variant = "cards", count }: { variant?: Legacy; count?: number; stats?: boolean }) {
  return <Skeleton variant={MAP[variant]} count={count} />;
}
