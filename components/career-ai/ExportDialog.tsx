"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buildExport, EXPORT_FORMATS, type ExportFormat, type ExportMessage } from "@/lib/career/export";
import type { ChatTurn } from "./types";

export function turnsToMessages(turns: ChatTurn[]): ExportMessage[] {
  const out: ExportMessage[] = [];
  for (const t of turns) {
    if (!t.result) continue;
    if (t.question) out.push({ role: "user", content: t.question });
    out.push({ role: "assistant", content: t.result.answer, citations: (t.result.citations ?? []).map((c) => ({ id: c.id, title: c.title, url: c.url })) });
  }
  return out;
}

function save(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** PDF without a server library: the same sanitised HTML is printed from a hidden frame, so the text stays selectable and any language renders. Choose "Save as PDF" in the print dialog. */
function printPdf(html: string, done: () => void) {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  f.srcdoc = html.replace("</style>", "@page{margin:18mm}pre{white-space:pre-wrap}section{break-inside:auto}h2{break-after:avoid}</style>");
  f.onload = () => { try { f.contentWindow?.focus(); f.contentWindow?.print(); } finally { setTimeout(() => f.remove(), 60_000); } };
  document.body.appendChild(f);
  done();
}

/** Exports the whole chat, or one answer, from the same pipeline in lib/career/export.ts. Files are built in the browser from what is already on screen. */
export function ExportDialog({ open, onClose, messages, defaultTitle, scope }: { open: boolean; onClose: () => void; messages: ExportMessage[]; defaultTitle: string; scope: "conversation" | "response" }) {
  const [format, setFormat] = useState<ExportFormat | "pdf">("pdf");
  const [title, setTitle] = useState(defaultTitle);
  const [citations, setCitations] = useState(true);
  const [code, setCode] = useState(true);
  useEffect(() => { if (open) setTitle(defaultTitle); }, [open, defaultTitle]);
  function go() {
    if (format === "pdf") return printPdf(buildExport(messages, { format: "html", title, citations, codeBlocks: code }).content, onClose);
    const r = buildExport(messages, { format, title, citations, codeBlocks: code });
    save(r.filename, r.mime, r.content);
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Export {scope === "response" ? "this response" : "conversation"}</DialogTitle><DialogDescription>{messages.length} message{messages.length === 1 ? "" : "s"}. Hidden instructions, keys and internal traces are never included.</DialogDescription></DialogHeader>
        <label className="space-y-1 text-sm">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
        <label className="space-y-1 text-sm">Format
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat | "pdf")} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
            <option value="pdf">PDF (.pdf, via your browser&apos;s print dialog)</option>
            {Object.entries(EXPORT_FORMATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={citations} onChange={(e) => setCitations(e.target.checked)} className="size-4" /> Include source citations</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={code} onChange={(e) => setCode(e.target.checked)} className="size-4" /> Include code blocks</label>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={messages.length === 0}>Download</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
