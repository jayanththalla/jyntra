import Link from "next/link";
import { ArrowUpRightIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Shortcut card: a 3D illustration, a bold title and one line of help. All cards share one style so no one of them looks "special". */
export function QuickAction({ href, art, title, caption, className }: { href: string; art: string; title: string; caption: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "tile group relative flex min-h-[9.5rem] flex-col justify-end overflow-hidden rounded-2xl p-5 outline-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-indigo active:scale-[.98] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-28 rounded-full bg-indigo-soft transition-transform duration-300 group-hover:scale-125" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art} alt="" width={160} height={160} loading="lazy" className="pointer-events-none absolute right-3 top-3 h-20 w-auto transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110" />
      <span className="relative block font-heading text-[17px] font-bold leading-tight">{title}</span>
      <span className="relative mt-1 block max-w-[88%] text-xs leading-snug text-muted-foreground">{caption}</span>
      <ArrowUpRightIcon className="absolute bottom-4 right-4 size-4 text-muted-foreground opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
    </Link>
  );
}
