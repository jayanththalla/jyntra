// One conversation -> many formats. Every format is built from the same normalised message list, so they cannot drift apart.
// Pure and deterministic: nothing is executed, all HTML is escaped first, links must be http(s).

export interface ExportCitation { id: string; title: string; url: string | null }
export interface ExportMessage { role: "user" | "assistant"; content: string; citations?: ExportCitation[]; at?: string | null }
export interface ExportOptions { format: ExportFormat; title?: string; timestamps?: boolean; citations?: boolean; codeBlocks?: boolean; now?: Date }
export type ExportFormat = "md" | "txt" | "html" | "json";
export const EXPORT_FORMATS: Record<ExportFormat, { label: string; mime: string }> = {
  md: { label: "Markdown (.md)", mime: "text/markdown;charset=utf-8" },
  txt: { label: "Plain text (.txt)", mime: "text/plain;charset=utf-8" },
  html: { label: "Web page (.html)", mime: "text/html;charset=utf-8" },
  json: { label: "JSON (.json)", mime: "application/json;charset=utf-8" },
};

const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\/[^\s<>"']+$/i.test(u) ? u : null);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Lowercase, ASCII-safe, no path characters. Unicode-only titles fall back to "chat". */
export function safeFilename(title: string, ext: string, now = new Date()): string {
  const slug = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chat";
  return `career-gpt-${slug}-${now.toISOString().slice(0, 10)}.${ext}`;
}

function stripCode(md: string): string {
  return md.replace(/```[\s\S]*?```/g, "_[code block omitted]_");
}
function prep(m: ExportMessage, o: ExportOptions): ExportMessage {
  let content = (m.content ?? "").replace(/\r\n/g, "\n").trim();
  if (o.codeBlocks === false) content = stripCode(content);
  return { ...m, content, citations: o.citations === false ? [] : (m.citations ?? []).filter((c) => c && c.id) };
}
const label = (m: ExportMessage) => (m.role === "user" ? "You" : "Atlas");
const when = (m: ExportMessage, o: ExportOptions) => (o.timestamps && m.at ? ` (${m.at})` : "");

export function toMarkdown(msgs: ExportMessage[], o: ExportOptions): string {
  const title = o.title?.trim() || "Atlas conversation";
  const out = [`# ${title}`, `_Exported ${(o.now ?? new Date()).toISOString()}_`];
  for (const raw of msgs) {
    const m = prep(raw, o);
    if (!m.content) continue;
    out.push(`## ${label(m)}${when(m, o)}`, m.content);
    if (m.citations?.length) out.push("**Sources**\n" + m.citations.map((c) => `- [${c.id}] ${safeUrl(c.url) ? `[${c.title}](${c.url})` : c.title}`).join("\n"));
  }
  return out.join("\n\n") + "\n";
}

export function toText(msgs: ExportMessage[], o: ExportOptions): string {
  const title = o.title?.trim() || "Atlas conversation";
  const plain = (s: string) => s.replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)").replace(/^```\w*\n?|\n?```$/gm, "");
  const out = [title, "=".repeat(Math.min(title.length, 60)), `Exported ${(o.now ?? new Date()).toISOString()}`, ""];
  for (const raw of msgs) {
    const m = prep(raw, o);
    if (!m.content) continue;
    out.push(`${label(m).toUpperCase()}${when(m, o)}:`, plain(m.content));
    if (m.citations?.length) out.push("Sources:", ...m.citations.map((c) => `  [${c.id}] ${c.title}${safeUrl(c.url) ? ` - ${c.url}` : ""}`));
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // The URL was already escaped; only http(s) links become anchors.
  return t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => `<a href="${url}" rel="noopener noreferrer nofollow">${text}</a>`);
}
function mdToHtml(md: string): string {
  const lines = md.split("\n"), out: string[] = [];
  let i = 0, list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; close(); out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`); continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l), b = /^\s*[-*]\s+(.*)$/.exec(l), n = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    if (h) { close(); const lv = Math.min(6, h[1].length + 2); out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); }
    else if (b || n) { const want = b ? "ul" : "ol"; if (list !== want) { close(); out.push(`<${want}>`); list = want; } out.push(`<li>${inline((b ?? n)![1])}</li>`); }
    else if (!l.trim()) close();
    else { close(); out.push(`<p>${inline(l)}</p>`); }
    i++;
  }
  close();
  return out.join("\n");
}

export function toHtml(msgs: ExportMessage[], o: ExportOptions): string {
  const title = o.title?.trim() || "Atlas conversation";
  const body = msgs.map((raw) => {
    const m = prep(raw, o);
    if (!m.content) return "";
    const src = m.citations?.length ? `<p class="src"><strong>Sources</strong></p><ul class="src">${m.citations.map((c) => `<li>[${esc(c.id)}] ${safeUrl(c.url) ? `<a href="${esc(safeUrl(c.url)!)}" rel="noopener noreferrer nofollow">${esc(c.title)}</a>` : esc(c.title)}</li>`).join("")}</ul>` : "";
    return `<section class="${m.role}"><h2>${label(m)}${esc(when(m, o))}</h2>${mdToHtml(m.content)}${src}</section>`;
  }).join("\n");
  // No scripts, and a CSP that forbids them, so the file stays inert wherever it is opened.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(title)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1a2e}h1{font-size:1.6rem}section{border-top:1px solid #ddd;padding-top:.5rem;margin-top:1.5rem}section.user h2{color:#6d28d9}pre{background:#f4f4f8;padding:.75rem;overflow:auto;border-radius:6px;white-space:pre}code{font-family:ui-monospace,monospace;font-size:.9em}a{color:#4f46e5;overflow-wrap:anywhere}.meta,.src{color:#555;font-size:.85rem}</style></head><body><h1>${esc(title)}</h1><p class="meta">Exported ${esc((o.now ?? new Date()).toISOString())}</p>
${body}</body></html>`;
}

export function toJson(msgs: ExportMessage[], o: ExportOptions): string {
  return JSON.stringify({
    title: o.title?.trim() || "Atlas conversation",
    exported_at: (o.now ?? new Date()).toISOString(),
    messages: msgs.map((raw) => prep(raw, o)).filter((m) => m.content).map((m) => ({
      role: m.role, content: m.content, ...(o.timestamps && m.at ? { at: m.at } : {}),
      ...(o.citations === false ? {} : { citations: (m.citations ?? []).map((c) => ({ id: c.id, title: c.title, url: safeUrl(c.url) })) }),
    })),
  }, null, 2) + "\n";
}

export function buildExport(msgs: ExportMessage[], o: ExportOptions): { filename: string; mime: string; content: string } {
  const f = EXPORT_FORMATS[o.format] ? o.format : "md";
  const content = f === "md" ? toMarkdown(msgs, o) : f === "txt" ? toText(msgs, o) : f === "html" ? toHtml(msgs, o) : toJson(msgs, o);
  return { filename: safeFilename(o.title?.trim() || "conversation", f, o.now), mime: EXPORT_FORMATS[f].mime, content };
}
