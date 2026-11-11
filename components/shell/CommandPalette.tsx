"use client";
// Cmd/Ctrl+K palette. Every entry is a real route or a real action; nothing here is decorative.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SearchIcon, SunIcon, MoonIcon, MonitorIcon, LogOutIcon, ArrowRightIcon, type IconComponent } from "@/components/icons";
import { NAV, EXTRA } from "@/lib/nav";
import { setTheme, type ThemeMode } from "@/components/ThemeToggle";
import { useShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

type Cmd = { id: string; label: string; hint?: string; group: "Go to" | "Actions"; icon: IconComponent; keywords?: string[]; run: () => void };

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Global shortcut. Also "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(!paletteOpen); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => { if (paletteOpen) { setQ(""); setI(0); } }, [paletteOpen]);

  const cmds = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => { setPaletteOpen(false); router.push(href); };
    const theme = (m: ThemeMode) => () => { setTheme(m); setPaletteOpen(false); };
    return [
      ...NAV.map((n) => ({ id: n.href, label: n.label, hint: n.hint, group: "Go to" as const, icon: n.icon, keywords: n.keywords, run: go(n.href) })),
      ...EXTRA.map((n) => ({ id: n.href, label: n.label, hint: n.hint, group: "Go to" as const, icon: n.icon, keywords: n.keywords, run: go(n.href) })),
      { id: "theme-light", label: "Light theme", group: "Actions", icon: SunIcon, keywords: ["appearance"], run: theme("light") },
      { id: "theme-dark", label: "Dark theme", group: "Actions", icon: MoonIcon, keywords: ["appearance"], run: theme("dark") },
      { id: "theme-system", label: "Match system theme", group: "Actions", icon: MonitorIcon, keywords: ["appearance", "auto"], run: theme("system") },
      { id: "signout", label: "Sign out of this device", group: "Actions", icon: LogOutIcon, keywords: ["logout", "log out"], run: async () => { setPaletteOpen(false); try { await fetch("/api/me", { method: "DELETE" }); } catch {} window.location.href = "/login"; } },
    ];
  }, [router, setPaletteOpen]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cmds;
    return cmds.filter((c) => [c.label, c.hint ?? "", ...(c.keywords ?? [])].join(" ").toLowerCase().includes(t));
  }, [cmds, q]);

  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: "nearest" }); }, [i]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(shown.length - 1, v + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); shown[i]?.run(); }
  };

  let lastGroup = "";
  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent showCloseButton={false} className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-lg border border-foreground/80 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to search pages and actions. Use the arrow keys and Enter.</DialogDescription>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={shown[i] ? `cmd-${shown[i].id}` : undefined}
            placeholder="Jump to a page or run an action…" aria-label="Search commands"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">esc</kbd>
        </div>
        <ul id="cmd-list" ref={listRef} role="listbox" className="scroll-thin max-h-[min(24rem,60dvh)] overflow-y-auto p-1.5">
          {shown.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</li>}
          {shown.map((c, idx) => {
            const head = c.group !== lastGroup ? ((lastGroup = c.group), c.group) : null;
            return (
              <li key={c.id} role="presentation">
                {head && <p className="eyebrow px-3 pb-1 pt-2.5">{head}</p>}
                <button
                  id={`cmd-${c.id}`} role="option" aria-selected={idx === i} data-idx={idx} type="button"
                  onMouseMove={() => setI(idx)} onClick={c.run}
                  className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm", idx === i ? "bg-secondary text-foreground" : "text-foreground/90")}
                >
                  <c.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{c.label}</span>
                  {c.hint && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{c.hint}</span>}
                  {idx === i && <ArrowRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-border bg-secondary/50 px-4 py-2 font-mono text-[10px] text-muted-foreground">
          <span>↑↓ navigate</span><span>↵ select</span><span className="ml-auto">⌘K / Ctrl K</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
