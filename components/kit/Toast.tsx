"use client";
// Small toast system: one live region, auto-dismiss, keyboard-dismissible, calm motion (off for reduced motion).
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, XIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";
interface ToastItem { id: number; text: string; tone: Tone }
const Ctx = createContext<{ toast: (text: string, tone?: Tone) => void }>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const n = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((text: string, tone: Tone = "success") => {
    const id = ++n.current;
    setItems((l) => [...l.slice(-2), { id, text, tone }]);
    setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
  }, [dismiss]);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6">
        {items.map((t) => (
          <div key={t.id} className={cn("page-enter pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm shadow-lg", t.tone === "error" ? "border-destructive/50" : "border-border")}>
            <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full text-white", t.tone === "error" ? "bg-destructive" : t.tone === "info" ? "bg-primary" : "bg-success")}>{t.tone === "error" ? <XIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}</span>
            <span className="min-w-0 flex-1">{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><XIcon className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
