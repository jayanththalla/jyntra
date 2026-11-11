import { CircleAlertIcon, CircleCheckIcon, ShieldCheckIcon } from "@/components/icons";
import { VERIFICATION_HELP, VERIFICATION_LABELS, type Verification } from "@/lib/news/taxonomy";
import { cn } from "@/lib/utils";

const STYLE: Record<Verification, { pill: string; bar: string; Icon: typeof ShieldCheckIcon }> = {
  verified: { pill: "bg-success/10 text-success", bar: "bg-success/10", Icon: ShieldCheckIcon },
  single_source: { pill: "bg-muted text-foreground/80", bar: "bg-slate-400 dark:bg-slate-500", Icon: CircleCheckIcon },
  unconfirmed: { pill: "bg-warning/10 text-warning", bar: "bg-warning/10", Icon: CircleAlertIcon },
};

/** Colour bar down the card's left edge: the verification state at a glance. Decorative; the badge carries the text. */
export const verificationBar = (v: Verification) => STYLE[v].bar;

export function VerificationBadge({ status, outlets, className }: { status: Verification; outlets: number; className?: string }) {
  const { pill, Icon } = STYLE[status];
  const detail = status === "verified" ? ` · ${outlets} publishers` : "";
  return (
    <span title={VERIFICATION_HELP[status]} className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium", pill, className)}>
      <Icon className="size-3.5" aria-hidden />
      {VERIFICATION_LABELS[status]}
      {detail}
      <span className="sr-only">. {VERIFICATION_HELP[status]}</span>
    </span>
  );
}
