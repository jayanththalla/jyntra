// Google Docs connector (read-only, no OAuth, no Google account access). The candidate pastes links to Google Docs they have set to
// "Anyone with the link can view" (resume, project write-ups, notes). We build the export URL ourselves from a validated document id,
// on a fixed host, so no user-supplied URL is ever fetched. A private doc redirects to a Google sign-in page: that is reported, never followed.
import { redactSecrets } from "../safety";
import { SourceError, type Connector, type RawDoc, type SyncContext, type SyncResult } from "../types";

const MAX_DOCS = 10;
const MAX_BYTES = 500_000;
const ID = /^[A-Za-z0-9_-]{20,100}$/;

/** Accepts https://docs.google.com/document/d/<id>/... (also /u/0/ forms) and returns the id, or null. */
export function docIdFromUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com" || u.username || u.password) return null;
  const m = u.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
  return m && ID.test(m[1]) ? m[1] : null;
}

export function parseDocLinks(text: string): { ids: string[]; bad: string[] } {
  const parts = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const ids: string[] = [], bad: string[] = [];
  for (const p of parts) { const id = docIdFromUrl(p); if (id) { if (!ids.includes(id)) ids.push(id); } else bad.push(p.slice(0, 60)); }
  return { ids: ids.slice(0, MAX_DOCS), bad };
}

export const gdocsConnector: Connector = {
  provider: "gdocs",
  async sync(ctx: SyncContext): Promise<SyncResult> {
    const ids = Array.isArray(ctx.config.docIds) ? (ctx.config.docIds as unknown[]).filter((x): x is string => typeof x === "string" && ID.test(x)).slice(0, MAX_DOCS) : [];
    if (!ids.length) throw new SourceError("invalid", "Add at least one Google Docs link.");
    const docs: RawDoc[] = [], warnings: string[] = [];
    for (const id of ids) {
      const exportUrl = `https://docs.google.com/document/d/${id}/export?format=txt`;
      let res: Response;
      try {
        res = await ctx.fetchImpl(exportUrl, { redirect: "manual", headers: { Accept: "text/plain", "User-Agent": "Jyntra-KB" }, signal: AbortSignal.timeout(15_000) });
      } catch { warnings.push("A Google Doc could not be reached; it will be retried on the next sync."); continue; }
      if (res.status >= 300 && res.status < 400) { warnings.push("A document isn't shared. In Google Docs choose Share > General access > Anyone with the link > Viewer."); continue; }
      if (res.status === 404) { warnings.push("A Google Doc was not found (deleted or the link is wrong)."); continue; }
      if (res.status === 429) throw new SourceError("rate_limited", "Google is limiting requests. Try again in a few minutes.", 60_000);
      if (!res.ok || !/text\/plain/i.test(res.headers.get("content-type") ?? "")) { warnings.push("A document could not be read as text."); continue; }
      const text = (await res.text()).replace(/^﻿/, "").slice(0, MAX_BYTES).trim();
      if (text.length < 20) { warnings.push("A document had no readable text."); continue; }
      const firstLine = text.split("\n").find((l) => l.trim())?.trim().slice(0, 100) || "Google Doc";
      docs.push({ externalId: `gdoc:${id}`, docType: "doc", title: `Google Doc: ${firstLine}`, url: `https://docs.google.com/document/d/${id}/edit`, content: redactSecrets(text.slice(0, 60_000)).text, metadata: { technologies: [], userProvided: true } });
    }
    if (!docs.length) throw new SourceError("invalid", warnings[0] ?? "No document could be imported.");
    return { docs, complete: docs.length === ids.length, warnings };
  },
};
