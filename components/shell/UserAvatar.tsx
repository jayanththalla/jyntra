import { cn } from "@/lib/utils";

/** Initials in a square mark (not a round photo placeholder): consistent with the editorial look. */
export function UserAvatar({ name, className }: { name?: string | null; className?: string }) {
  const initials = (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "J";
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-[11px] font-semibold text-background", className)}>
      {initials}
    </span>
  );
}
