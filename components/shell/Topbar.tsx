"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MenuIcon, SearchIcon, LogOutIcon, UserRoundIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserAvatar } from "@/components/shell/UserAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Sidebar";
import { useShell } from "@/components/AppShell";
import { crumbs } from "@/lib/nav";

export function Topbar() {
  const path = usePathname() ?? "";
  const { setMobileOpen, setPaletteOpen, user } = useShell();
  const [mounted, setMounted] = useState(false); // Radix menus mint ids; mount them client-side only so SSR HTML always matches
  const [mac, setMac] = useState(false);
  useEffect(() => { setMounted(true); setMac(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);
  const parents = crumbs(path).slice(0, -1);

  async function signOut() {
    try { await fetch("/api/me", { method: "DELETE" }); } catch {}
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background px-3 pt-[env(safe-area-inset-top)] sm:px-6">
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><MenuIcon className="size-5" /></Button>
      <div className="sm:hidden"><Wordmark collapsed /></div>

      {parents.length > 0 && <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
        <ol className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {parents.map((c, idx) => (
            <li key={c.href} className="flex min-w-0 items-center gap-1.5">
              {idx > 0 && <span aria-hidden>/</span>}
              <Link href={c.href} className="truncate hover:text-foreground">{c.label}</Link>
            </li>
          ))}
        </ol>
      </nav>}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button" onClick={() => setPaletteOpen(true)} aria-label="Search and commands"
          className="hidden h-9 w-64 items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:border-foreground focus-visible:ring-2 focus-visible:ring-ring md:flex"
        >
          <SearchIcon className="size-4" /><span className="flex-1">Search or jump to…</span>
          <kbd className="rounded border border-border px-1.5 font-mono text-[10px]">{mac ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search and commands"><SearchIcon className="size-[18px]" /></Button>
        <ThemeToggle />
        {mounted && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Account menu" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"><UserAvatar name={user?.profile?.name} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm font-medium">{user?.profile?.name || "Your profile"}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">{user?.email || (user ? "Signed in on this device" : "Not signed in")}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href="/settings"><UserRoundIcon className="size-4" />Profile &amp; settings</Link></DropdownMenuItem>
              <DropdownMenuItem onSelect={signOut}><LogOutIcon className="size-4" />Sign out of this device</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
