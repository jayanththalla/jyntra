"use client";
import { useCallback, useEffect, useState } from "react";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "@/components/icons";
import { dueState } from "@/lib/career/reminders";

interface Reminder { id: number; title: string; note: string; due_at: string; timezone: string; done_at: string | null; company: string | null; role: string | null; application_id: number | null }
interface App { id: number; startup_name: string; job_title: string | null }

/** Value for <input type="datetime-local"> = local wall-clock time, tomorrow 09:00 by default. */
function defaultDue() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const STATE_STYLE = { overdue: "text-destructive", today: "text-warning", upcoming: "text-muted-foreground", done: "text-muted-foreground" } as const;

export function RemindersWorkspace() {
  const [items, setItems] = useState<Reminder[] | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(defaultDue);
  const [appId, setAppId] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ reminders: Reminder[] }>("/api/career/reminders");
    if (r.ok) { setItems(r.data.reminders); setErr(null); } else setErr(r.error ?? "Could not load reminders.");
  }, []);
  useEffect(() => {
    void load();
    api<{ applications: App[] }>("/api/applications").then((r) => r.ok && setApps(r.data.applications ?? []));
    const pre = new URLSearchParams(window.location.search).get("application");
    if (pre) setAppId(pre);
  }, [load]);
  // Pre-fill a sensible title once applications are known.
  useEffect(() => {
    if (!appId || title) return;
    const a = apps.find((x) => String(x.id) === appId);
    if (a) setTitle(`Follow up with ${a.startup_name}`);
  }, [appId, apps, title]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const when = new Date(due);
    if (!title.trim() || Number.isNaN(when.getTime())) return setErr("Add a title and a valid date and time.");
    setBusy(true);
    const r = await api("/api/career/reminders", { method: "POST", ...jsonBody({ title, note, due_at: when.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, application_id: appId ? Number(appId) : undefined }) });
    setBusy(false);
    if (!r.ok) return setErr(r.data?.message ?? r.error);
    setTitle(""); setNote(""); setDue(defaultDue()); setAppId(""); setErr(null);
    window.history.replaceState(null, "", window.location.pathname);
    void load();
  }
  async function toggle(r: Reminder) {
    const x = await api(`/api/career/reminders/${r.id}`, { method: "PATCH", ...jsonBody({ done: !r.done_at }) });
    if (!x.ok) return setErr(x.error);
    void load();
  }
  async function del(r: Reminder) {
    const x = await api(`/api/career/reminders/${r.id}`, { method: "DELETE" });
    if (!x.ok) return setErr(x.error);
    void load();
  }

  const open = (items ?? []).filter((r) => !r.done_at);
  const done = (items ?? []).filter((r) => r.done_at);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
      <form onSubmit={add} className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-4" aria-label="New reminder">
        <h2 className="text-sm font-semibold">New reminder</h2>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Follow up with the recruiter" aria-label="Reminder title" maxLength={160} />
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date and time" className="h-10 rounded-lg border border-input bg-background px-2 text-sm" />
          <select aria-label="Related application" value={appId} onChange={(e) => setAppId(e.target.value)} className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
            <option value="">Not linked to an application</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.startup_name}{a.job_title ? ` · ${a.job_title}` : ""}</option>)}
          </select>
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="Optional note" rows={2} maxLength={2000} className="w-full resize-y rounded-lg border border-input bg-background p-2 text-sm" />
        <Button type="submit" disabled={busy || !title.trim()} className="h-10"><PlusIcon /> Add reminder</Button>
      </form>

      {items === null ? <Skeleton className="h-24 rounded-xl" /> : open.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No open reminders.</p>
      ) : (
        <ul className="space-y-2" aria-label="Open reminders">{open.map((r) => <Row key={r.id} r={r} onToggle={toggle} onDel={del} />)}</ul>
      )}

      {done.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" className="h-9" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>{showDone ? "Hide" : "Show"} completed ({done.length})</Button>
          {showDone && <ul className="mt-2 space-y-2" aria-label="Completed reminders">{done.map((r) => <Row key={r.id} r={r} onToggle={toggle} onDel={del} />)}</ul>}
        </div>
      )}
    </div>
  );
}

function Row({ r, onToggle, onDel }: { r: Reminder; onToggle: (r: Reminder) => void; onDel: (r: Reminder) => void }) {
  const st = dueState(r.due_at, r.done_at, new Date(), r.timezone);
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(r.due_at));
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
      <div className="min-w-0 flex-1">
        <p className={`font-medium [overflow-wrap:anywhere] ${r.done_at ? "line-through opacity-60" : ""}`}>{r.title}</p>
        <p className={`text-xs ${STATE_STYLE[st]}`}>{st === "overdue" ? "Overdue · " : st === "today" ? "Today · " : ""}{when}{r.company ? ` · ${r.company}${r.role ? `, ${r.role}` : ""}` : ""}</p>
        {r.note && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">{r.note}</p>}
      </div>
      <Button size="icon" variant="ghost" className="size-10 shrink-0" aria-label={r.done_at ? "Reopen reminder" : "Mark reminder done"} onClick={() => onToggle(r)}>{r.done_at ? <RotateCcwIcon /> : <CheckIcon />}</Button>
      <Button size="icon" variant="ghost" className="size-10 shrink-0 text-destructive" aria-label="Delete reminder" onClick={() => onDel(r)}><Trash2Icon /></Button>
    </li>
  );
}
