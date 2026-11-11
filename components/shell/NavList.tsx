"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { NAV } from "@/lib/nav";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Which primary destination owns this path. Outreach drafts and startup pages are reached from Discover. */
export function isActive(path: string, href: string) {
  if (href === "/discover") return path === href || path.startsWith("/startups/") || path.startsWith("/outreach/");
  if (href === "/settings") return path === href || path.startsWith("/settings/");
  return path === href || path.startsWith(href + "/");
}

export function NavList({ collapsed = false, onNavigate, idPrefix = "nav" }: { collapsed?: boolean; onNavigate?: () => void; idPrefix?: string }) {
  const path = usePathname() ?? "";
  const reduce = useReducedMotion();
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2.5 py-3">
      <ul className="flex flex-col gap-0.5">
        {NAV.map((n, idx) => {
          const on = isActive(path, n.href);
          const link = (
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={on ? "page" : undefined}
              aria-label={collapsed ? n.label : undefined}
              className={cn(
                "group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                on ? "text-foreground" : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                collapsed && "justify-center px-0"
              )}
            >
              {on && (
                <motion.span
                  layoutId={`${idPrefix}-active`}
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                  className="absolute inset-0 rounded-md border border-border bg-background"
                  aria-hidden
                >
                  <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-accent-brand" />
                </motion.span>
              )}
              <n.icon className={cn("relative size-[17px] shrink-0", on && "text-accent-brand-foreground")} strokeWidth={on ? 2.1 : 1.7} />
              {!collapsed && <span className="relative truncate">{n.label}</span>}
              {!collapsed && <span className="relative ml-auto font-mono text-[10px] text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{idx + 1}</span>}
            </Link>
          );
          return (
            <li key={n.href}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{n.label}</TooltipContent>
                </Tooltip>
              ) : link}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
