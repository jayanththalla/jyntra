"use client";
import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon, CancelIcon, ClockIcon, InfoIcon, Loader2Icon } from "@/components/icons";

const TONES = {
  info: { icon: InfoIcon, variant: "default" as const },
  warn: { icon: ClockIcon, variant: "warning" as const },
  error: { icon: AlertCircleIcon, variant: "destructive" as const },
  progress: { icon: Loader2Icon, variant: "default" as const },
};

/** One status message (info / warning / error / progress) with an optional action and dismiss button. */
export function Banner({ tone = "info", children, action, onDismiss }: { tone?: keyof typeof TONES; children: ReactNode; action?: ReactNode; onDismiss?: () => void }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <Alert variant={t.variant} role={tone === "error" ? "alert" : "status"} className="items-center gap-y-2 py-3 sm:pr-4">
      <Icon className={tone === "progress" ? "animate-spin" : undefined} />
      <AlertDescription className="min-w-0 text-foreground">{children}</AlertDescription>
      {(action || onDismiss) && (
        <div className="col-start-2 mt-1 flex items-center gap-2 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          {action}
          {onDismiss && (
            <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss">
              <CancelIcon />
            </Button>
          )}
        </div>
      )}
    </Alert>
  );
}
export { AlertAction };
