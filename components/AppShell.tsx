"use client";
import { useState, useEffect, createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import { ToastProvider } from "@/components/kit/Toast";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./shell/Topbar";
import { BottomNav } from "./shell/BottomNav";
import { CommandPalette } from "./shell/CommandPalette";
import { api } from "./api";
import { cn } from "@/lib/utils";

export interface ShellUser { id: number; email?: string | null; profile?: { name?: string } & Record<string, any> }
interface ShellContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  user: ShellUser | null;
}

const noop = () => {};
const ShellContext = createContext<ShellContextType>({ collapsed: false, setCollapsed: noop, toggle: noop, mobileOpen: false, setMobileOpen: noop, paletteOpen: false, setPaletteOpen: noop, user: null });
export const useShell = () => useContext(ShellContext);

const SIDEBAR_KEY = "dsf.sidebar.collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const landing = path === "/"; // the public landing page has its own header and footer: no sidebar, no padding
  const bare = path.startsWith("/onboarding") || path === "/login" || path === "/demo"; // public / first-run screens: no app chrome
  // The Atlas chat is an app-like screen: it fills the window below the top bar and scrolls only inside its own panels.
  const fill = path === "/career-ai";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [user, setUser] = useState<ShellUser | null>(null);
  const chrome = !bare && !landing;
  const focusMode = path === "/mock-interview/formal" || path === "/mock-interview/voice"; // active interview: no tab bar, nothing to leave by accident

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1"); } catch {}
  }, []);
  useEffect(() => { setMobileOpen(false); }, [path]);
  // Who is signed in, for the sidebar and account menu. A 401 simply means "guest"; nothing else depends on this call.
  useEffect(() => {
    if (!chrome) return;
    let live = true;
    api("/api/me").then((r) => { if (live && r.ok && r.data?.user) setUser(r.data.user); });
    return () => { live = false; };
  }, [chrome]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch {}
  };

  return (
    // reducedMotion="user": every Motion animation in the app respects the OS "reduce motion" setting.
    <MotionConfig reducedMotion="user">
      <ToastProvider>
      <ShellContext.Provider value={{ collapsed, setCollapsed, toggle, mobileOpen, setMobileOpen, paletteOpen, setPaletteOpen, user }}>
        <div className="min-h-screen bg-background text-foreground">
          {chrome && <Sidebar />}
          <div className={cn("transition-[padding] duration-200", chrome && (collapsed ? "sm:pl-[60px]" : "sm:pl-[232px]"))}>
            {chrome && <Topbar />}
            <main id="main" className={cn("page-enter", fill ? "h-[calc(100dvh-3.5rem-3.5rem)] overflow-hidden sm:h-[calc(100dvh-3.5rem)]" : "min-h-screen", chrome && !fill && "min-h-[calc(100dvh-3.5rem)]", chrome && !focusMode && !fill && "pb-16 sm:pb-0")}>
              <div className={cn(landing ? "" : "mx-auto max-w-[1200px] px-4 sm:px-6", fill ? "flex h-full flex-col py-3 sm:py-4" : landing ? "" : "py-6 sm:py-9")}>
                {children}
              </div>
            </main>
          </div>
          {chrome && !focusMode && <BottomNav />}
          {chrome && <CommandPalette />}
        </div>
      </ShellContext.Provider>
      </ToastProvider>
    </MotionConfig>
  );
}
