"use client";
// Per-application prep notes (job description, prep, questions, answers). Loaded only when the section is opened.
import { Skeleton } from "@/components/Skeleton";
import { useState } from "react";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "@/components/icons";

interface Note { id: number; kind: string; title: string; content: string }
const KINDS: [string, string][] = [["prep", "Prep"], ["job_description", "Job description"], ["question", "Question"], ["answer", "Answer"], ["interview_note", "Interview note"]];

export function PrepNotes({ applicationId }: { applicationId: number }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: number | null; kind: string; title: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<{ notes: Note[] }>(`/api/kb/notes?application_id=${applicationId}`);
    if (r.ok) { setNotes(r.data.notes); setErr(null); } else setErr(r.error);
  }
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !notes) await load();
  }
  async function save() {
    if (!edit) return;
    setBusy(true);
    const r = edit.id
      ? await api(`/api/kb/notes/${edit.id}`, { method: "PATCH", ...jsonBody({ title: edit.title, content: edit.content }) })
      : await api("/api/kb/notes", { method: "POST", ...jsonBody({ application_id: applicationId, kind: edit.kind, title: edit.title, content: edit.content }) });
    setBusy(false);
    if (!r.ok) return setErr((r.data as any)?.message ?? r.error);
    setEdit(null);
    await load();
  }
  async function del(id: number) {
    const r = await api(`/api/kb/notes/${id}`, { method: "DELETE" });
    if (!r.ok) return setErr(r.error);
    await load();
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="xs" variant="ghost" onClick={toggle} aria-expanded={open}>Prep notes{notes ? ` (${notes.length})` : ""}</Button>
      {open && (
        <div className="space-y-2">
          {err && <Banner tone="error" onDismiss={() => setErr(null)}>{err}</Banner>}
          {!notes && !err && <Skeleton variant="list" count={2} />}
          {notes?.length === 0 && !edit && <p className="text-xs text-muted-foreground">No prep notes yet.</p>}
          {notes?.map((n) => (
            <div key={n.id} className="rounded-lg border border-border/70 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{n.title} <span className="font-normal text-muted-foreground">· {KINDS.find((k) => k[0] === n.kind)?.[1] ?? n.kind}</span></p>
                <span className="flex shrink-0">
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={`Edit ${n.title}`} onClick={() => setEdit({ id: n.id, kind: n.kind, title: n.title, content: n.content })}><PencilIcon /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={`Delete ${n.title}`} onClick={() => del(n.id)}><Trash2Icon /></Button>
                </span>
              </div>
              <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-muted-foreground">{n.content}</p>
            </div>
          ))}
          {edit ? (
            <div className="space-y-2 rounded-lg border border-border p-2">
              {!edit.id && (
                <select aria-label="Note kind" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })} className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm">
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
              <Input aria-label="Note title" placeholder="Title" value={edit.title} maxLength={160} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              <Textarea aria-label="Note content" rows={5} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} />
              <div className="flex gap-2"><Button type="button" size="xs" onClick={save} disabled={busy || !edit.title.trim() || !edit.content.trim()}>Save</Button><Button type="button" size="xs" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
            </div>
          ) : (
            <Button type="button" size="xs" variant="outline" onClick={() => setEdit({ id: null, kind: "prep", title: "", content: "" })}><PlusIcon /> Add note</Button>
          )}
        </div>
      )}
    </div>
  );
}
