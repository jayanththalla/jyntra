import type { ReactNode } from "react";
import { AlertCircleIcon, BookmarkIcon, BriefcaseBusinessIcon, ClipboardListIcon, MicIcon, NewspaperIcon, SearchIcon, TargetIcon, type IconComponent } from "@/components/icons";

// Original Jyntra artwork (scripts/art/gen-illustrations.py). When a call site passes only an icon, the closest illustration is used.
const ART_BY_ICON = new Map<IconComponent, string>([
  [SearchIcon, "/illustrations/3d/search.png"],
  [NewspaperIcon, "/illustrations/3d/wallet.png"],
  [TargetIcon, "/illustrations/3d/mic.png"],
  [MicIcon, "/illustrations/3d/mic.png"],
  [BookmarkIcon, "/illustrations/3d/tack.png"],
  [ClipboardListIcon, "/illustrations/3d/folder.png"],
  [BriefcaseBusinessIcon, "/illustrations/3d/chart.png"],
  [AlertCircleIcon, "/illustrations/status/error.svg"],
]);
const LEGACY: Record<string, string> = { "/illustrations/interview.svg": "/illustrations/3d/mic.png", "/illustrations/search.svg": "/illustrations/3d/search.png", "/illustrations/funding.svg": "/illustrations/3d/coin.png", "/illustrations/documents.svg": "/illustrations/3d/folder.png" };

/** Zero-result state: illustration on a soft panel, bold title, short help text, next actions. */
export function EmptyState({ icon: Icon, title, children, actions, art }: { icon: IconComponent; title: string; children?: ReactNode; actions?: ReactNode; art?: string }) {
  const src = (art && (LEGACY[art] ?? art)) || ART_BY_ICON.get(Icon);
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-card px-6 py-8 text-center shadow-[var(--shadow-tile)]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={320} height={320} className="h-32 w-auto sm:h-40" loading="lazy" />
      ) : (
        <span className="flex size-12 items-center justify-center rounded-2xl bg-indigo-soft text-indigo"><Icon className="size-6" /></span>
      )}
      <h3 className="font-heading text-xl font-extrabold tracking-tight">{title}</h3>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
