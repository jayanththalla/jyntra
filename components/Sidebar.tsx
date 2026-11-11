"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SidebarLeftIcon } from "@/components/icons";
import { NavList } from "@/components/shell/NavList";
import { useShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

export function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" aria-label="Jyntra home" className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-[5px] bg-accent-brand font-heading text-[17px] font-extrabold leading-none text-white">J</span>
      {!collapsed && <span className="display text-[22px]">Jyntra</span>}
    </Link>
  );
}

export function Sidebar() {
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useShell();
  const path = usePathname() ?? "";
  if (path.startsWith("/onboarding")) return null;
  return (
    <>
      <aside className={cn("fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 sm:flex", collapsed ? "w-[60px]" : "w-[232px]")}>
        <div className={cn("flex h-14 items-center border-b border-sidebar-border px-3.5", collapsed && "justify-center px-0")}>
          <Wordmark collapsed={collapsed} />
        </div>
        <NavList collapsed={collapsed} idPrefix="desk" />
        <div className="space-y-1 border-t border-sidebar-border p-2.5">
          <button
            type="button" onClick={toggle} aria-pressed={collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", collapsed && "justify-center px-0")}
          >
            <SidebarLeftIcon className="size-4" />{!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Mobile: a drawer opened from the top bar. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" showCloseButton className="w-[280px] max-w-[85vw] gap-0 bg-sidebar p-0 sm:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Jump between Jyntra sections</SheetDescription>
          <div className="flex h-14 items-center border-b border-sidebar-border px-4"><Wordmark /></div>
          <NavList onNavigate={() => setMobileOpen(false)} idPrefix="mob" />
        </SheetContent>
      </Sheet>
    </>
  );
}
