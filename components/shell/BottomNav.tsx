"use client";
// Phone tab bar: five lowercase tabs, the active one filled and bold. Everything else lives in the "more" drawer (same NAV list).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import { isActive } from "@/components/shell/NavList";
import { MenuIcon } from "@/components/icons";
import { useShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

const TABS = ["/dashboard", "/discover", "/career-ai", "/mock-interview"];
const LABEL: Record<string, string> = { "/dashboard": "home", "/discover": "discover", "/career-ai": "atlas", "/mock-interview": "interview" };

export function BottomNav() {
  const path = usePathname() ?? "";
  const { setMobileOpen } = useShell();
  const items = NAV.filter((n) => TABS.includes(n.href));
  const moreActive = !items.some((n) => isActive(path, n.href));
  const base = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 pb-safe backdrop-blur sm:hidden">
      {items.map((n) => {
        const on = isActive(path, n.href);
        const Icon = n.icon;
        return (
          <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cn(base, on ? "font-bold text-foreground" : "text-muted-foreground")}>
            <span className={cn("flex h-7 w-10 items-center justify-center rounded-full transition-colors", on && "bg-indigo-soft text-indigo")}><Icon className="size-5" strokeWidth={on ? 2.4 : 1.6} /></span>
            {LABEL[n.href]}
          </Link>
        );
      })}
      <button type="button" onClick={() => setMobileOpen(true)} className={cn(base, moreActive ? "font-bold text-foreground" : "text-muted-foreground")} aria-label="More: open navigation">
        <span className={cn("flex h-7 w-10 items-center justify-center rounded-full", moreActive && "bg-indigo-soft text-indigo")}><MenuIcon className="size-5" strokeWidth={moreActive ? 2.4 : 1.6} /></span>
        more
      </button>
    </nav>
  );
}
