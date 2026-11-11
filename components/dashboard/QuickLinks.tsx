"use client";
import { useEffect, useState } from "react";
import { QuickAction } from "@/components/kit/QuickAction";
import { Stagger, StaggerItem } from "@/components/kit/Motion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckIcon, PencilIcon } from "@/components/icons";

interface LinkDef { id: string; href: string; art: string; title: string; caption: string }
// No "Start AI Interview" here: the dashboard hero already owns that action, so it is never shown twice.
// No "Profile": the account menu in the top bar is the single place for it.
const ALL: LinkDef[] = [
  { id: "atlas", href: "/career-ai", art: "/illustrations/3d/chat.png", title: "Explore Atlas", caption: "Ask questions answered from your own documents" },
  { id: "oss", href: "/open-source", art: "/illustrations/3d/heart.png", title: "Discover Open Source", caption: "Beginner issues matched to your skills" },
  { id: "news", href: "/news", art: "/illustrations/3d/coin.png", title: "Read Funding News", caption: "Recent rounds, with the source of each" },
  { id: "discover", href: "/discover", art: "/illustrations/3d/search.png", title: "Find jobs", caption: "Openings checked against their original listings" },
  { id: "applications", href: "/applications", art: "/illustrations/3d/folder.png", title: "My applications", caption: "Status, outreach and follow-ups in one place" },
];
const DEFAULT = ["atlas", "oss", "news", "discover"];
const KEY = "jyntra.quicklinks.v2";
const MAX = 4;

/** Quick actions the person can choose. The choice is remembered on this device only (localStorage), so it never needs an account. */
export function QuickLinks() {
  const [ids, setIds] = useState<string[]>(DEFAULT);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (Array.isArray(saved)) { const ok = saved.filter((x) => ALL.some((l) => l.id === x)).slice(0, MAX); if (ok.length) setIds(ok); }
    } catch { /* storage blocked: keep the defaults */ }
  }, []);
  function toggle(id: string) {
    setIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX ? [...cur, id] : cur;
      if (!next.length) return cur;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  const shown = ids.map((id) => ALL.find((l) => l.id === id)!).filter(Boolean);
  return (
    <div>
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Quick actions">
        {shown.map((l) => <StaggerItem key={l.id}><QuickAction href={l.href} art={l.art} title={l.title} caption={l.caption} /></StaggerItem>)}
      </Stagger>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>{editing ? <CheckIcon /> : <PencilIcon />}{editing ? "Done" : "Edit shortcuts"}</Button>
      </div>
      {editing && (
        <fieldset className="tile mt-2 grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">Choose up to {MAX} shortcuts</legend>
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">Pick up to {MAX}. Saved on this device.</p>
          {ALL.map((l) => {
            const on = ids.includes(l.id);
            return (
              <label key={l.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-sm hover:bg-secondary/60">
                <Checkbox checked={on} disabled={!on && ids.length >= MAX} onCheckedChange={() => toggle(l.id)} aria-label={l.title} />
                {l.title}
              </label>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}
