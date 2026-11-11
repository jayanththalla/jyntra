"use client";
import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

export type ThemeMode = "system" | "light" | "dark";
export const THEME_KEY = "dsf.theme";

/** Runs in <head> before first paint so the page never flashes the wrong theme. */
export const themeBootScript = `(function(){try{var m=localStorage.getItem('${THEME_KEY}')||'light';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

const THEME_EVENT = "dsf-theme";

/** Persist + apply a theme from anywhere (the toggle, the command palette). The toggle listens and stays in sync. */
export function setTheme(mode: ThemeMode) {
  try { localStorage.setItem(THEME_KEY, mode); } catch {}
  apply(mode);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: mode }));
}

function apply(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const OPTIONS = [
  { mode: "light", label: "Light", icon: SunIcon },
  { mode: "dark", label: "Dark", icon: MoonIcon },
  { mode: "system", label: "System", icon: MonitorIcon },
] as const;

/** Light / Dark / System. "System" follows the device setting, live. */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false); // don't touch the theme until the saved choice is read

  useEffect(() => {
    let saved: ThemeMode = "light";
    try {
      saved = (localStorage.getItem(THEME_KEY) as ThemeMode) || "light";
    } catch {}
    setMode(saved);
    setReady(true);
    const onTheme = (e: Event) => setMode((e as CustomEvent<ThemeMode>).detail);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);

  useEffect(() => {
    if (!ready) return;
    apply(mode);
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode, ready]);

  function choose(next: ThemeMode) {
    setMode(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  // One button that cycles Light → Dark → System. Deliberately no popover: Radix generates element ids
  // that were mismatching between server and client HTML (React hydration error #418, ~1 in 3 loads).
  const idx = OPTIONS.findIndex((o) => o.mode === mode);
  const next = OPTIONS[(idx + 1) % OPTIONS.length];
  const Current = OPTIONS[idx].icon;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => choose(next.mode)}
      aria-label={`Theme: ${OPTIONS[idx].label}. Switch to ${next.label}`}
      title={`Theme: ${OPTIONS[idx].label} (click for ${next.label})`}
    >
      <Current />
    </Button>
  );
}
