// Answer-quality stage: runs on every generated answer before it is shown. Deterministic: it repairs what can be repaired
// (duplicate blocks, unclosed fences, leaked internals, secrets) and reports what it cannot (figures not found in the sources).
import { redactSecrets } from "./safety";

export interface QualityResult { text: string; issues: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function dedupeBlocks(text: string): { text: string; removed: number } {
  const blocks = text.split(/\n{2,}/);
  const seen = new Set<string>();
  let removed = 0;
  const out: string[] = [];
  for (const b of blocks) {
    const k = norm(b);
    // Headings and paragraphs repeated word for word; table/code blocks are kept (rows legitimately look alike).
    const exempt = /^\s*(\||```)/.test(b) || k.length < 4;
    if (!exempt && seen.has(k)) { removed++; continue; }
    if (!exempt) seen.add(k);
    out.push(b);
  }
  // The same heading printed twice in a row ("My projects" / "My projects").
  const lines = out.join("\n\n").split("\n");
  const res: string[] = [];
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l) && res.length) { const prev = [...res].reverse().find((x) => x.trim()); if (prev && norm(prev) === norm(l)) { removed++; continue; } }
    res.push(l);
  }
  return { text: res.join("\n"), removed };
}

const LEAK = /(<\/?(evidence|facts|conversation|candidate_job|untrusted)[^>]*>|\bSOURCE_ID\b|\b(system|developer) (prompt|instructions?)\b\s*[:=]|(GROQ|GEMINI|OPENAI|DATABASE|SESSION|JYNTRA)[A-Z_]*(KEY|SECRET|URL|TOKEN)\s*=)/i;

export function refineAnswer(raw: string, o: { corpus?: string } = {}): QualityResult {
  const issues: string[] = [];
  let text = raw;
  const sec = redactSecrets(text);
  if (sec.redactions) { text = sec.text; issues.push("A secret-like value was removed from the answer."); }
  const kept = text.split("\n").filter((l) => !LEAK.test(l));
  if (kept.length !== text.split("\n").length) { text = kept.join("\n"); issues.push("Internal prompt text was removed from the answer."); }
  const d = dedupeBlocks(text);
  if (d.removed) { text = d.text; issues.push(`${d.removed} repeated heading${d.removed > 1 ? "s or paragraphs were" : " or paragraph was"} removed.`); }
  if ((text.match(/```/g) ?? []).length % 2 === 1) text += "\n```";
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text && !/[.!?)\]|`*:_>\d]$/.test(text) && text.split(/\s+/).length > 12) issues.push("The answer may be cut off mid-sentence. Regenerate it if it looks incomplete.");
  if (o.corpus) {
    const hay = o.corpus.toLowerCase().replace(/\s+/g, " ");
    const figs = [...new Set((text.match(/\b\d+(?:\.\d+)?\s?(?:%|x\b|ms\b|k\+?|m\+?\b|users\b|requests\b|rps\b)/gi) ?? []).map((f) => f.toLowerCase().replace(/\s+/g, " ")))].filter((f) => !hay.includes(f) && !hay.includes(f.replace(" ", "")));
    if (figs.length) issues.push(`These figures aren't in your sources, so treat them as unverified: ${figs.slice(0, 5).join(", ")}.`);
  }
  return { text, issues };
}
