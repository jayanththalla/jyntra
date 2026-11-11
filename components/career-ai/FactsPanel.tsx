"use client";
import { useCallback, useEffect, useState } from "react";
import { ListSkeleton } from "@/components/skeletons";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, PlusIcon, Trash2Icon } from "@/components/icons";

export interface Fact { id: number; category: string; text: string; origin: "user_confirmed" | "ai_suggested" }
export const FACT_CATEGORIES: [string, string][] = [["general", "General"], ["salary", "Salary expectation"], ["notice_period", "Notice period"], ["availability", "Availability"], ["work_authorization", "Work authorization"], ["relocation", "Relocation"], ["preference", "Preference"], ["achievement", "Achievement"]];

/** Facts the candidate chose to keep. Only confirmed ones are used as facts when writing answers and emails. */
export function FactsPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [cat, setCat] = useState("general");
  const load = useCallback(async () => {
    const r = await api<{ facts: Fact[] }>("/api/career/facts");
    if (r.ok) setFacts(r.data.facts); else setErr(r.error);
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  async function add() {
    const r = await api("/api/career/facts", { method: "POST", ...jsonBody({ text, category: cat }) });
    if (!r.ok) return setErr(r.error);
    setText(""); setErr(null); void load();
  }
  async function confirm(id: number) { const r = await api(`/api/career/facts/${id}`, { method: "PATCH", ...jsonBody({ confirm: true }) }); if (!r.ok) setErr(r.error); void load(); }
  async function del(id: number) { const r = await api(`/api/career/facts/${id}`, { method: "DELETE" }); if (!r.ok) setErr(r.error); void load(); }
  const label = (c: string) => FACT_CATEGORIES.find(([v]) => v === c)?.[1] ?? c;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Short facts only you can confirm (notice period, salary expectation…). Confirmed facts are used verbatim in answers and emails. Facts kept from an AI answer stay unused until you confirm them.</p>
      {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
      <div className="space-y-2">
        <select aria-label="Fact category" value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
          {FACT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="e.g. 30 days notice" aria-label="New fact" onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void add(); }} />
          <Button onClick={add} disabled={!text.trim()} aria-label="Add fact" className="h-10"><PlusIcon /></Button>
        </div>
      </div>
      {facts === null ? <ListSkeleton rows={3} /> : facts.length === 0 ? <p className="text-sm text-muted-foreground">No saved facts yet.</p> : (
        <ul className="space-y-2">{facts.map((f) => (
          <li key={f.id} className="rounded-lg border border-border/70 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label(f.category)} · {f.origin === "user_confirmed" ? "confirmed" : "AI suggestion, unused"}</p><p className="mt-0.5 [overflow-wrap:anywhere]">{f.text}</p></div>
              <div className="flex shrink-0">
                {f.origin === "ai_suggested" && <Button size="icon-sm" variant="ghost" aria-label="Confirm this fact" onClick={() => confirm(f.id)}><CheckIcon /></Button>}
                <Button size="icon-sm" variant="ghost" aria-label="Delete fact" onClick={() => del(f.id)}><Trash2Icon /></Button>
              </div>
            </div>
          </li>))}</ul>
      )}
    </div>
  );
}
