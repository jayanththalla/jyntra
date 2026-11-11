"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/career-ai", label: "Chat" },
  { href: "/career-ai/workflows", label: "Workflows" },
] as const;

/** Switches between the Atlas workspaces. */
export function CareerNav() {
  const path = usePathname() ?? "";
  if (TABS.length < 2) return null; // a single tab is not a switcher
  return (
    <nav aria-label="Atlas" className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 sm:w-fit">
      {TABS.map((t) => {
        const on = t.href === "/career-ai" ? path === "/career-ai" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
            className={cn("inline-flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:flex-none", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
