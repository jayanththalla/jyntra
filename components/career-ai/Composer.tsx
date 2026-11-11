"use client";
import { useLayoutEffect, useRef } from "react";
import { MODE_OPTIONS } from "./types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowUpIcon, CheckIcon, ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Rounded, auto-growing composer. Enter sends, Shift+Enter adds a line, the button turns into Stop while an answer is being generated. */
export function Composer({ value, onChange, onSend, onStop, busy, mode, onMode, inputRef }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  mode: string;
  onMode: (m: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const local = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? local;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, ref]);
  const label = MODE_OPTIONS.find(([v]) => v === mode)?.[1] ?? "Auto";
  const canSend = !!value.trim() && !busy;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSend) onSend(); }}
      className="rounded-3xl border border-border bg-card p-2 shadow-lg shadow-black/5 focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/20"
    >
      <label htmlFor="kb-q" className="sr-only">Your question</label>
      <textarea
        id="kb-q"
        ref={ref}
        rows={1}
        value={value}
        maxLength={12000}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) onSend(); }
        }}
        placeholder="Ask about your projects, paste a job description, or prep for an interview…"
        className="block max-h-[200px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Mode: ${label}`} className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {label} <ChevronDownIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="min-w-52">
            {MODE_OPTIONS.map(([v, l]) => (
              <DropdownMenuItem key={v} onSelect={() => onMode(v)} className="min-h-10 justify-between">
                {l} {v === mode && <CheckIcon className="size-4 text-accent-brand-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop generating" className="inline-flex size-10 items-center justify-center rounded-full bg-foreground text-background outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="size-3.5 rounded-sm bg-current" />
          </button>
        ) : (
          <button type="submit" disabled={!canSend} aria-label="Send" className={cn("inline-flex size-10 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", canSend ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            <ArrowUpIcon className="size-5" />
          </button>
        )}
      </div>
    </form>
  );
}
