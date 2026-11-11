"use client";
import { useState } from "react";
import { api, jsonBody } from "@/components/api";
import { AddSourceDialog } from "./AddSourceDialog";
import { kbErrorMessage, relTime, type Capabilities, type KbSource } from "./types";
import { Banner } from "@/components/Banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Loader2Icon, PlusIcon, RotateCwIcon, Trash2Icon } from "@/components/icons";

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "border-success/40 text-success" },
  syncing: { label: "Syncing…", cls: "bg-secondary text-accent-brand-foreground" },
  pending: { label: "Verifying…", cls: "bg-secondary text-accent-brand-foreground" },
  error: { label: "Last sync failed", cls: "border-destructive/50 text-destructive" },
  revoked: { label: "Access revoked", cls: "border-destructive/50 text-destructive" },
  disconnected: { label: "Disconnected", cls: "text-muted-foreground" },
};
// Mirrors STALE_AFTER_MS in lib/kb/freshness.ts. Manual sources (uploads, notes, pasted text) have nothing external to fall behind.
const STALE_MS: Record<string, number> = { github: 6 * 3_600_000, codeforces: 12 * 3_600_000, gdocs: 24 * 3_600_000, portfolio: 24 * 3_600_000 };
const isStale = (s: KbSource) => !!STALE_MS[s.provider] && s.status === "connected" && !!s.last_synced_at && Date.now() - new Date(s.last_synced_at).getTime() > STALE_MS[s.provider];

export function SourcesPanel({ sources, caps, onChanged }: { sources: KbSource[]; caps: Capabilities | null; onChanged: () => void }) {
  const [add, setAdd] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rm, setRm] = useState<KbSource | null>(null);
  const [purge, setPurge] = useState(true);

  async function act(s: KbSource, action: "sync" | "cancel") {
    setBusy(s.id);
    const r = await api<any>(`/api/kb/sources/${s.id}`, { method: "POST", ...jsonBody({ action }) });
    setBusy(null);
    if (!r.ok) setNote(kbErrorMessage(r.status, r.data?.error, r.error));
    onChanged();
  }
  async function remove() {
    if (!rm) return;
    setBusy(rm.id);
    const r = await api(`/api/kb/sources/${rm.id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) setNote(r.error);
    setRm(null);
    onChanged();
  }

  const visible = sources.filter((s) => s.status !== "disconnected");
  const syncable = visible.filter((s) => s.provider !== "upload" && s.provider !== "notes" && s.status !== "syncing" && s.status !== "pending");
  async function syncAll() {
    setBusy(-1);
    const rs = await Promise.all(syncable.map((s) => api<any>(`/api/kb/sources/${s.id}`, { method: "POST", ...jsonBody({ action: "sync" }) })));
    setBusy(null);
    const bad = rs.find((r) => !r.ok);
    if (bad) setNote(kbErrorMessage(bad.status, bad.data?.error, bad.error));
    onChanged();
  }
  return (
    <section aria-labelledby="src-h" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="src-h" className="text-sm font-semibold">Sources</h2>
        <div className="flex gap-1.5">
          {syncable.length > 1 && <Button size="sm" variant="ghost" className="h-9" onClick={syncAll} disabled={busy === -1}><RotateCwIcon /> Sync all</Button>}
          <Button size="sm" variant="outline" className="h-9" onClick={() => setAdd(true)}><PlusIcon /> Add</Button>
        </div>
      </div>
      {note && <Banner tone="error" onDismiss={() => setNote(null)}>{note}</Banner>}
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Nothing connected yet. Add GitHub, a resume or your coding profile to get started.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => {
            const st = STATUS[s.status] ?? STATUS.error;
            const active = s.status === "syncing" || s.status === "pending";
            return (
              <li key={s.id} className="rounded-2xl border border-border/70 bg-card p-3 transition-shadow hover:shadow-sm">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-xs font-bold uppercase text-accent-brand-foreground">{(s.provider || "?").slice(0, 2)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words text-sm font-semibold leading-snug" title={s.label}>{s.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
                      {active
                        ? `Syncing… ${s.doc_count ?? 0} document${s.doc_count === 1 ? "" : "s"} so far`
                        : `${s.doc_count ?? 0} document${s.doc_count === 1 ? "" : "s"}${s.last_synced_at ? ` · synced ${relTime(s.last_synced_at)}` : s.status === "connected" ? " · not synced yet" : ""}`}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 pl-12">
                  <Badge variant="outline" className={st.cls}>{active && <Loader2Icon className="animate-spin" />}{st.label}</Badge>
                  <div className="flex shrink-0 gap-0.5">
                    {active ? (
                      <Button size="sm" variant="outline" onClick={() => act(s, "cancel")} disabled={busy === s.id}>Cancel</Button>
                    ) : s.provider !== "upload" ? (
                      <Button size="icon-sm" variant={s.status === "error" || s.status === "revoked" || isStale(s) ? "default" : "ghost"} aria-label={`${s.status === "error" || s.status === "revoked" ? "Retry" : "Sync"} ${s.label}`} title="Sync now" onClick={() => act(s, "sync")} disabled={busy === s.id}><RotateCwIcon /></Button>
                    ) : null}
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.label}`} title="Remove" onClick={() => { setRm(s); setPurge(true); }} disabled={busy === s.id}><Trash2Icon /></Button>
                  </div>
                </div>
                {s.last_error && (s.status === "error" || s.status === "revoked") && <p className="mt-2 text-xs text-destructive" role="alert">{s.last_error}</p>}
                {s.last_error && s.status === "connected" && !active && <p className="mt-2 text-xs text-warning" role="status">{s.last_error}</p>}
                {isStale(s) && <p className="mt-2 text-xs text-warning" role="status">Indexed {relTime(s.last_synced_at)}. Answers use this copy and it refreshes automatically when you ask a question; it may miss very recent work.</p>}
                {s.status === "error" && s.last_synced_at && <p className="mt-2 text-xs text-muted-foreground">Answers use the last successful index from {relTime(s.last_synced_at)}.</p>}
              </li>
            );
          })}
        </ul>
      )}
      <AddSourceDialog open={add} onOpenChange={setAdd} caps={caps} onChanged={onChanged} />
      <Dialog open={!!rm} onOpenChange={(o) => !o && setRm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {rm?.label}?</DialogTitle>
            <DialogDescription>Stored credentials are deleted and syncing stops.</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            <span>Also delete everything imported from it, including saved answers and notes that cite it.</span>
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRm(null)}>Keep</Button>
            <Button variant="destructive" onClick={remove} disabled={busy === rm?.id}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
