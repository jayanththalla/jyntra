"use client";
import { useRef, useState } from "react";
import { api, jsonBody } from "@/components/api";
import { kbErrorMessage, type Capabilities } from "./types";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon } from "@/components/icons";

type Kind = "github" | "upload" | "codeforces" | "leetcode" | "linkedin" | "portfolio" | "notes" | "gdocs";
const KINDS: { id: Kind; label: string }[] = [
  { id: "github", label: "GitHub" },
  { id: "upload", label: "Upload documents" },
  { id: "codeforces", label: "Codeforces" },
  { id: "leetcode", label: "LeetCode" },
  { id: "linkedin", label: "LinkedIn (paste)" },
  { id: "gdocs", label: "Google Doc (public link)" },
  { id: "portfolio", label: "Portfolio page" },
  { id: "notes", label: "Notes" },
];

export function AddSourceDialog({ open, onOpenChange, caps, onChanged, initial }: { open: boolean; onOpenChange: (o: boolean) => void; caps: Capabilities | null; onChanged: () => void; initial?: Kind }) {
  const [kind, setKind] = useState<Kind>(initial ?? "github");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [priv, setPriv] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    setMsg(null);
    if (kind === "upload") {
      const files = Array.from(fileRef.current?.files ?? []);
      if (!files.length) { setBusy(false); setMsg({ tone: "error", text: "Choose at least one file (PDF, DOCX, TXT or MD, up to 5 MB each)." }); return; }
      const fd = new FormData();
      files.slice(0, 5).forEach((x) => fd.append("file", x));
      const r = await api<{ results?: { name: string; ok: boolean; message?: string }[] }>("/api/kb/documents", { method: "POST", body: fd });
      setBusy(false);
      const results = r.data?.results ?? [];
      if (results.some((x) => x.ok)) {
        onChanged();
        const bad = results.filter((x) => !x.ok);
        if (!bad.length) return onOpenChange(false);
        setMsg({ tone: "error", text: `Some files weren't added: ${bad.map((b) => `${b.name} (${b.message ?? "failed"})`).join("; ")}` });
      } else setMsg({ tone: "error", text: results[0]?.message ?? kbErrorMessage(r.status, (r.data as any)?.error, r.error) });
      return;
    }
    const body: Record<string, unknown> = { provider: kind };
    if (kind === "github") Object.assign(body, { login: f.login?.trim(), token: f.token?.trim() || undefined, includePrivate: priv, repos: (f.repos ?? "").split(/[\s,]+/).filter(Boolean) });
    if (kind === "codeforces") body.handle = f.handle?.trim();
    if (kind === "leetcode") Object.assign(body, { importText: f.text, profileUrl: f.url?.trim() });
    if (kind === "linkedin") Object.assign(body, { text: f.text, profileUrl: f.url?.trim() });
    if (kind === "notes") Object.assign(body, { text: f.text, title: f.title?.trim() });
    if (kind === "gdocs") body.links = f.links;
    if (kind === "portfolio") body.url = f.url?.trim();
    const r = await api<any>("/api/kb/sources", { method: "POST", ...jsonBody(body) });
    setBusy(false);
    if (r.ok) {
      onChanged();
      setF({});
      return onOpenChange(false);
    }
    const detail = r.data?.sync?.error ?? r.data?.message ?? null;
    onChanged(); // an inline source may have been created even if its first import failed
    setMsg({ tone: "error", text: kbErrorMessage(r.status, r.data?.error, detail ?? r.error) });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>A source only shows as connected after it has been verified and imported.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Source type">
            {KINDS.map((k) => (
              <Button key={k.id} role="tab" aria-selected={kind === k.id} size="sm" variant={kind === k.id ? "default" : "outline"} onClick={() => { setKind(k.id); setMsg(null); }}>{k.label}</Button>
            ))}
          </div>
          {kind === "github" && (
            <div className="space-y-3">
              {caps?.github_oauth ? (
                <div className="space-y-2 rounded-lg border border-border/70 p-3">
                  <p className="text-sm">Sign in with GitHub to include your account activity.</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <a href={`/api/kb/github/authorize${priv ? "?private=1" : ""}`} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">Continue with GitHub</a>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={priv} onCheckedChange={(v) => setPriv(v === true)} /> Include private repos</label>
                  </div>
                </div>
              ) : (
                <Banner tone="info">GitHub sign-in isn't configured on this server. You can still add a public username{caps?.github_token ? " or a personal access token" : ""}.</Banner>
              )}
              <div className="space-y-1.5"><Label htmlFor="gh-login">Public username</Label><Input id="gh-login" value={f.login ?? ""} onChange={set("login")} placeholder="octocat" autoComplete="off" /></div>
              <div className="space-y-1.5"><Label htmlFor="gh-repos">Only these repos (optional)</Label><Input id="gh-repos" value={f.repos ?? ""} onChange={set("repos")} placeholder="owner/repo, owner/other" /></div>
              {caps?.github_token && (
                <div className="space-y-1.5">
                  <Label htmlFor="gh-token">Personal access token (optional)</Label>
                  <Input id="gh-token" type="password" value={f.token ?? ""} onChange={set("token")} autoComplete="off" />
                  <p className="text-xs text-muted-foreground">Verified first, then stored encrypted on the server. It is never sent back to your browser.</p>
                </div>
              )}
            </div>
          )}
          {kind === "upload" && (
            <div className="space-y-1.5"><Label htmlFor="kb-file">Resume, report or notes</Label><Input id="kb-file" ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown" /><p className="text-xs text-muted-foreground">Up to 5 files, 5 MB each. Secrets are redacted before indexing.</p></div>
          )}
          {kind === "codeforces" && <div className="space-y-1.5"><Label htmlFor="cf">Handle</Label><Input id="cf" value={f.handle ?? ""} onChange={set("handle")} placeholder="tourist" autoComplete="off" /><p className="text-xs text-muted-foreground">Uses the official public API. Solved-problem topics are shown as inferred, not proven, skills.</p></div>}
          {kind === "leetcode" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">LeetCode has no public API we can rely on, so nothing is scraped. Paste a list of solved problems (one per line) and/or your profile link.</p>
              <div className="space-y-1.5"><Label htmlFor="lc-url">Profile link (optional)</Label><Input id="lc-url" value={f.url ?? ""} onChange={set("url")} placeholder="https://leetcode.com/u/you" /></div>
              <div className="space-y-1.5"><Label htmlFor="lc-text">Solved problems</Label><Textarea id="lc-text" rows={6} value={f.text ?? ""} onChange={set("text")} placeholder={"Two Sum | Easy | Array, Hash Table\nLRU Cache | Medium | Design"} /></div>
            </div>
          )}
          {kind === "linkedin" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Copy the text of your LinkedIn profile and paste it here. We never fetch LinkedIn pages. Anything pasted is treated as self-reported.</p>
              <div className="space-y-1.5"><Label htmlFor="li-text">Profile text</Label><Textarea id="li-text" rows={8} value={f.text ?? ""} onChange={set("text")} /></div>
            </div>
          )}
          {kind === "gdocs" && (
            <div className="space-y-1.5"><Label htmlFor="gd">Google Docs links (up to 10)</Label><Textarea id="gd" rows={4} value={f.links ?? ""} onChange={set("links")} placeholder="https://docs.google.com/document/d/…" />
              <p className="text-xs text-muted-foreground">In each doc choose Share, then General access, then &quot;Anyone with the link&quot; as Viewer. Jyntra only reads the text; it never gets access to your Google account.</p></div>
          )}
          {kind === "portfolio" && <div className="space-y-1.5"><Label htmlFor="pf">Page URL</Label><Input id="pf" value={f.url ?? ""} onChange={set("url")} placeholder="https://you.dev" /><p className="text-xs text-muted-foreground">Only this one public page is imported.</p></div>}
          {kind === "notes" && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="n-title">Title</Label><Input id="n-title" value={f.title ?? ""} onChange={set("title")} /></div>
              <div className="space-y-1.5"><Label htmlFor="n-text">Notes</Label><Textarea id="n-text" rows={7} value={f.text ?? ""} onChange={set("text")} /></div>
            </div>
          )}
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {!(kind === "github" && !f.login && !f.token) && (
            <Button onClick={submit} disabled={busy}>{busy && <Loader2Icon className="animate-spin" />} {kind === "upload" ? "Upload" : "Verify & import"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
