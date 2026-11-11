"use client";
// Review-and-confirm screen for historical application records. Nothing becomes an application until "Confirm" is pressed,
// and imported records are always saved as "To verify": we do not know that you applied, or when.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, jsonBody } from "@/components/api";
import { ClipboardListIcon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Cand {
  id: number; company: string; role: string | null; contact_email: string | null; job_url: string | null; region: string;
  verification: string; match_kind: "new" | "duplicate" | "possible_duplicate"; match_application_id: number | null; state: string;
}
const KIND: Record<Cand["match_kind"], string> = { new: "New", duplicate: "Looks like a duplicate", possible_duplicate: "Same company, different or missing role" };

export default function ImportPage() {
  const [rows, setRows] = useState<Cand[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ company: "", role: "", contact: "" });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [anyway, setAnyway] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const r = await api<{ candidates: Cand[] }>("/api/applications/history?state=pending");
    if (!r.ok) { setMsg({ tone: "err", text: r.error ?? "Could not load records." }); setRows([]); return; }
    setRows(r.data.candidates);
    setPicked((p) => new Set(r.data.candidates.filter((c) => c.match_kind === "new" && p.has(c.id)).map((c) => c.id)));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function loadSeed() {
    setBusy(true);
    const r = await api<any>("/api/applications/history", { method: "POST", ...jsonBody({ seed: true }) });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "err", text: r.error ?? "Could not load the historical records." });
    setMsg({ tone: "ok", text: `${r.data.staged.length} record(s) added for review${r.data.alreadyPending.length ? `, ${r.data.alreadyPending.length} already in review` : ""}. Nothing has been created yet.` });
    await load();
  }
  async function save(id: number) {
    const r = await api<any>(`/api/applications/history/${id}`, { method: "PATCH", ...jsonBody({ company: draft.company, role: draft.role, contact: draft.contact }) });
    if (!r.ok) return setMsg({ tone: "err", text: r.data?.message ?? r.error ?? "Could not save the edit." });
    setEditing(null); await load();
  }
  async function skip(id: number) {
    const r = await api(`/api/applications/history/${id}`, { method: "DELETE" });
    if (!r.ok) return setMsg({ tone: "err", text: r.error ?? "Could not skip." });
    await load();
  }
  async function confirmSelected(kind: "create" | "merge", ids: number[]) {
    if (!ids.length) return;
    setBusy(true);
    const decisions = ids.map((id) => ({ id, action: kind, createAnyway: anyway.has(id) }));
    const r = await api<{ results: { id: number; outcome: string }[] }>("/api/applications/history/confirm", { method: "POST", ...jsonBody({ decisions }) });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "err", text: r.error ?? "Could not confirm." });
    const n = (o: string) => r.data.results.filter((x) => x.outcome === o).length;
    setMsg({ tone: n("failed") || n("needs_decision") ? "err" : "ok", text: `${n("created")} created, ${n("merged")} merged${n("needs_decision") ? `, ${n("needs_decision")} need a decision (duplicate)` : ""}${n("failed") ? `, ${n("failed")} failed` : ""}.` });
    setPicked(new Set()); await load();
  }
  const toggle = (set: Set<number>, id: number) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };

  if (!rows) return <PageSkeleton variant="cards" count={4} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import application history"
        subtitle="Review historical records before they become applications. They are saved as “To verify”: nothing is marked Applied."
        actions={<>
          <Button variant="outline" onClick={loadSeed} disabled={busy}>Load my historical list</Button>
          <Link href="/applications" className={buttonVariants({ variant: "ghost" })}>Back to applications</Link>
        </>}
      />
      <div role="status" aria-live="polite">
        {msg && <Alert variant={msg.tone === "err" ? "destructive" : "default"}><AlertDescription>{msg.text}</AlertDescription></Alert>}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ClipboardListIcon} title="Nothing to review">Load your historical list to review it. These are past records, not confirmed open vacancies.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || picked.size === 0} onClick={() => confirmSelected("create", [...picked])}>Confirm {picked.size || ""} selected</Button>
            <span className="text-sm text-muted-foreground">Duplicates are never created unless you tick “Create anyway”.</span>
          </div>
          <ul className="grid gap-3" aria-label="Records awaiting review">
            {rows.map((c) => {
              const dup = c.match_kind !== "new";
              return (
                <li key={c.id}>
                  <Card><CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-start gap-3">
                      <input type="checkbox" className="mt-1.5 size-4" aria-label={`Select ${c.company}`} checked={picked.has(c.id)} disabled={dup && !anyway.has(c.id)} onChange={() => setPicked((p) => toggle(p, c.id))} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold [overflow-wrap:anywhere]">{c.company}</p>
                        <p className="text-sm text-muted-foreground">{c.role ?? "Role not provided"} · {c.contact_email ?? "Contact not provided"}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="outline">{c.region === "international" ? "International" : c.region === "india" ? "India" : "Region unspecified"}</Badge>
                          <Badge variant="outline">Unverified · historical</Badge>
                          {dup && <Badge variant="secondary">{KIND[c.match_kind]}</Badge>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setEditing(c.id); setDraft({ company: c.company, role: c.role ?? "", contact: c.contact_email ?? "" }); }}>Edit</Button>
                        {c.match_application_id && <Button size="sm" variant="outline" disabled={busy} onClick={() => confirmSelected("merge", [c.id])}>Merge into existing</Button>}
                        <Button size="sm" variant="ghost" onClick={() => skip(c.id)}>Skip</Button>
                      </div>
                    </div>
                    {dup && (
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={anyway.has(c.id)} onChange={() => setAnyway((s) => toggle(s, c.id))} />Create anyway (this is a distinct application)</label>
                    )}
                    {editing === c.id && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {(["company", "role", "contact"] as const).map((k) => (
                          <div key={k} className="space-y-1"><Label htmlFor={`${k}-${c.id}`} className="text-xs capitalize">{k === "contact" ? "Contact email (leave blank if unknown)" : k}</Label>
                            <Input id={`${k}-${c.id}`} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} /></div>
                        ))}
                        <div className="flex gap-2 sm:col-span-3"><Button size="sm" onClick={() => save(c.id)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
                      </div>
                    )}
                  </CardContent></Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
