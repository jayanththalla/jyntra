"use client";
import { useState } from "react";
import { SourcesPanel } from "./SourcesPanel";
import { KnowledgeProfile } from "./KnowledgeProfile";
import { FactsPanel } from "./FactsPanel";
import { Input } from "@/components/ui/input";
import type { Capabilities, KbSource, Summary } from "./types";
import { relTime } from "./types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon, Trash2Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface Conv { id: number; title: string; mode: string; updated_at: string }
export interface Note { id: number; application_id: number | null; kind: string; title: string; content: string; created_at: string }

/** Sources, what the assistant knows, past chats and saved notes. Used in the desktop column and the mobile slide-over. */
export function SidePanel({ sources, caps, sum, convs, notes, activeConv, onChanged, onOpenConv, onDelConv, onDelNote, onNewChat, onWipe, onSearch, onRename, factsKey }: {
  sources: KbSource[]; caps: Capabilities | null; sum: Summary | null; convs: Conv[]; notes: Note[]; activeConv: number | null;
  onChanged: () => void; onOpenConv: (id: number) => void; onDelConv: (id: number) => void; onDelNote: (id: number) => void; onNewChat: () => void; onWipe: () => void; onSearch: (q: string) => void; onRename: (id: number, title: string) => void; factsKey: number;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState("sources");
  const [know, setKnow] = useState(false);
  return (
    <div className="space-y-2">
      {/* Pinned: the tabs stay at the top of whichever column/drawer scrolls, so only the list underneath moves. */}
      <div className="sticky top-0 z-10 -mx-1 bg-background px-1 pb-2 pt-1">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full gap-0.5">
            <TabsTrigger value="sources" className="min-h-9 min-w-0 flex-1 px-1.5 text-xs">Sources</TabsTrigger>
            <TabsTrigger value="chats" className="min-h-9 min-w-0 flex-1 px-1.5 text-xs">Chats{convs.length > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary">{convs.length}</span>}</TabsTrigger>
            <TabsTrigger value="notes" className="min-h-9 min-w-0 flex-1 px-1.5 text-xs">Notes{notes.length > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary">{notes.length}</span>}</TabsTrigger>
            <TabsTrigger value="facts" className="min-h-9 min-w-0 flex-1 px-1.5 text-xs">Facts</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "sources" && (
        <>
          <SourcesPanel sources={sources} caps={caps} onChanged={onChanged} />
          {sum && (
            <Collapsible open={know} onOpenChange={setKnow}>
              <CollapsibleTrigger className="flex min-h-10 w-full items-center justify-between rounded-lg px-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
                What I know about you
                <ChevronDownIcon className={cn("size-4 transition-transform", know && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2"><KnowledgeProfile s={sum} hideTitle /></CollapsibleContent>
            </Collapsible>
          )}
          {sum && <p className="text-xs text-muted-foreground">{sum.totals.documents} documents · {sum.totals.chunks} passages indexed</p>}
          <Button variant="ghost" size="sm" className="h-9 text-destructive" onClick={onWipe}><Trash2Icon /> Delete all my knowledge</Button>
        </>
      )}

      {tab === "chats" && (
        <div className="space-y-2">
          <Button variant="outline" size="sm" className="h-9 w-full" onClick={onNewChat}><PlusIcon /> New chat</Button>
          <Input type="search" aria-label="Search conversations" placeholder="Search chats…" className="h-10" onChange={(e) => onSearch(e.target.value)} />
          {convs.length === 0 ? <p className="text-sm text-muted-foreground">No conversations found.</p> : (
            <ul className="space-y-1">{convs.map((c) => (
              <li key={c.id} className={cn("flex items-center gap-1 rounded-lg p-1 hover:bg-muted/60", activeConv === c.id && "bg-muted")}>
                {editing === c.id ? (
                  <>
                    <Input autoFocus value={draft} maxLength={120} aria-label="Conversation name" className="h-10" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { onRename(c.id, draft); setEditing(null); } if (e.key === "Escape") setEditing(null); }} />
                    <Button size="icon-sm" variant="ghost" aria-label="Save name" disabled={!draft.trim()} onClick={() => { onRename(c.id, draft); setEditing(null); }}><CheckIcon /></Button>
                  </>
                ) : (
                  <>
                    <button className="min-h-10 min-w-0 flex-1 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenConv(c.id)}>
                      <span className="block truncate text-sm">{c.title}</span>
                      <span className="block text-[11px] text-muted-foreground">{relTime(c.updated_at)}</span>
                    </button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Rename conversation ${c.title}`} onClick={() => { setDraft(c.title); setEditing(c.id); }}><PencilIcon /></Button>
                  </>
                )}
                <Button size="icon-sm" variant="ghost" aria-label={`Delete conversation ${c.title}`} onClick={() => onDelConv(c.id)}><Trash2Icon /></Button>
              </li>))}</ul>
          )}
        </div>
      )}

      {tab === "facts" && <FactsPanel refreshKey={factsKey} />}

      {tab === "notes" && (notes.length === 0 ? <p className="text-sm text-muted-foreground">No saved notes yet. Use the save icon under an answer.</p> : (
        <ul className="space-y-2">{notes.map((n) => (
          <li key={n.id} className="rounded-lg border border-border/70 p-3">
            <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{n.title}</p><Button size="icon-sm" variant="ghost" aria-label={`Delete note ${n.title}`} onClick={() => onDelNote(n.id)}><Trash2Icon /></Button></div>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{n.content}</p>
          </li>))}</ul>
      ))}
    </div>
  );
}
