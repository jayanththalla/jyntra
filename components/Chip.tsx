"use client";
import { Toggle } from "@/components/ui/toggle";
import { CheckIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Selectable pill (a shadcn Toggle). Used for filters and onboarding choices; shows a check when on. */
export function Chip({ label, on, onClick, title, size = "sm", className }: { label: string; on: boolean; onClick: () => void; title?: string; size?: "sm" | "default"; className?: string }) {
  return (
    <Toggle
      variant="outline"
      size={size}
      pressed={on}
      onPressedChange={() => onClick()}
      title={title}
      className={cn("rounded-full px-3 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90", className)}
    >
      {on && <CheckIcon className="size-3.5" strokeWidth={2.5} />}
      {label}
    </Toggle>
  );
}
