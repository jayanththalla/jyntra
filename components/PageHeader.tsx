import type { ReactNode } from "react";

/**
 * Page header on a soft indigo panel: small caps eyebrow, bold heading, subtitle, actions (stacked on phones).
 * Optional `art` is one of the local illustrations in /public/illustrations; it is decorative and hidden on small phones.
 */
export function PageHeader({ title, subtitle, actions, eyebrow, art }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; art?: string }) {
  return (
    <header className="rise-in relative flex items-center justify-between gap-4 overflow-hidden rounded-3xl bg-indigo-soft px-5 py-5 sm:px-8 sm:py-7">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full border border-indigo/15" />
      <div className="relative min-w-0 flex-1">
        {eyebrow && <p className="eyebrow mb-2 !text-indigo">{eyebrow}</p>}
        <h1 className="display text-balance text-[1.75rem] sm:text-[2.25rem]">{title}</h1>
        {subtitle && <div className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{subtitle}</div>}
        {actions && <div className="mt-4 flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {art && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" width={320} height={320} className="relative hidden h-32 w-auto shrink-0 sm:block lg:h-40" />
      )}
    </header>
  );
}
