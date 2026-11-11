"use client";
// Safe markdown renderer: headings, paragraphs, nested lists, tables, quotes, rules, bold/italic, inline code, code fences with copy,
// http(s) links, and source pills for [S1] / [S1, S2] / [S1][S2]. Everything is a React text node: no HTML is ever injected.
import { Fragment, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";

const CITE = String.raw`\[(?:S|P)\d+(?:\s*[,;]\s*(?:S|P)\d+)*\]`;

function pill(id: string, k: string, onCite?: (id: string) => void) {
  return (
    <button key={k} type="button" onClick={() => onCite?.(id)} aria-label={`Show source ${id}`} title={`Source ${id}: click to see where this came from`}
      className="relative -top-0.5 mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-violet/15 px-1.5 align-baseline text-[10px] font-semibold leading-none text-accent-brand-foreground outline-none hover:bg-brand-violet/30 focus-visible:ring-2 focus-visible:ring-ring">
      {id.replace(/^[SP]/, "")}
    </button>
  );
}

function inline(text: string, onCite?: (id: string) => void, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(String.raw`(\*\*[^*]+\*\*|__[^_]+__|` + "`[^`]+`" + String.raw`|${CITE}|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|(?<![*\w])\*[^*\s][^*]*\*(?![*\w]))`, "g");
  let last = 0, n = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    const k = `${key}-${n++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) out.push(<strong key={k} className="font-semibold">{inline(tok.slice(2, -2), onCite, k)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[S") || tok.startsWith("[P")) tok.slice(1, -1).split(/\s*[,;]\s*/).forEach((id, j) => out.push(pill(id, `${k}-${j}`, onCite)));
    else if (tok.startsWith("[")) {
      const l = tok.match(/^\[([^\]]+)\]\((.+)\)$/)!;
      out.push(<a key={k} href={l[2]} target="_blank" rel="noopener noreferrer" className="text-accent-brand-foreground underline underline-offset-2 hover:opacity-80">{l[1]}<span className="sr-only"> (opens in a new tab)</span></a>);
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ code }: { code: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-border/70 bg-muted/60">
      <button type="button" aria-label="Copy code" onClick={async () => { try { await navigator.clipboard.writeText(code); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked */ } }}
        className="absolute right-1.5 top-1.5 inline-flex size-8 items-center justify-center rounded-md bg-background/80 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {ok ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      </button>
      <pre className="overflow-x-auto p-3 pr-12 text-xs leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

interface Item { indent: number; ordered: boolean; text: string; children: Item[]; num?: number }
const LI = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;

function buildTree(rows: { indent: number; ordered: boolean; text: string; num?: number }[]): Item[] {
  const root: Item[] = [];
  const stack: { indent: number; list: Item[] }[] = [{ indent: -1, list: root }];
  for (const r of rows) {
    while (stack.length > 1 && r.indent <= stack[stack.length - 1].indent) stack.pop();
    const item: Item = { ...r, children: [] };
    const top = stack[stack.length - 1];
    // a deeper line has already been placed under the previous item's children list (it sits on top of the stack)
    top.list.push(item);
    stack.push({ indent: r.indent, list: item.children });
  }
  return root;
}

function List({ items, onCite, k }: { items: Item[]; onCite?: (id: string) => void; k: string }) {
  const ordered = items[0]?.ordered;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag {...(ordered && items[0]?.num && items[0].num > 1 ? { start: items[0].num } : {})} className={`my-2 space-y-1.5 pl-6 marker:text-muted-foreground ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((it, j) => (
        <li key={j} className="pl-0.5">
          {inline(it.text, onCite, `${k}-${j}`)}
          {it.children.length > 0 && <List items={it.children} onCite={onCite} k={`${k}-${j}`} />}
        </li>
      ))}
    </Tag>
  );
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text, onCite }: { text: string; onCite?: (id: string) => void }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      // The fence may be indented under a list item; remove that indent from the code lines.
      const pad = line.match(/^\s*/)![0].length;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++].replace(new RegExp(`^\\s{0,${pad}}`), ""));
      i++;
      blocks.push(<CodeBlock key={k++} code={buf.join("\n")} />);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={k++} className="my-4 border-border/60" />); i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl <= 2 ? "mb-2 mt-6 text-lg font-semibold tracking-tight first:mt-0" : lvl === 3 ? "mb-1.5 mt-5 text-base font-semibold first:mt-0" : "mb-1 mt-4 text-[15px] font-semibold first:mt-0";
      blocks.push(<h4 key={k++} className={cls}>{inline(h[2], onCite, `h${k}`)}</h4>);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={k++} className="my-3 border-l-2 border-brand-violet/50 pl-3 text-muted-foreground">{inline(buf.join(" "), onCite, `q${k}`)}</blockquote>);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="my-3 overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-muted/60"><tr>{head.map((c, j) => <th key={j} className="px-3 py-2 font-semibold">{inline(c, onCite, `th${k}-${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, a) => <tr key={a} className="border-t border-border/60">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{inline(c, onCite, `td${k}-${a}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (LI.test(line)) {
      const rows: { indent: number; ordered: boolean; text: string; num?: number }[] = [];
      while (i < lines.length) {
        if (/^\s*```/.test(lines[i])) break; // a code block ends the list; it renders next, then a new list resumes
        const m = lines[i].match(LI);
        if (m) rows.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), text: m[3], num: /\d/.test(m[2]) ? parseInt(m[2], 10) : undefined });
        else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && rows.length) rows[rows.length - 1].text += " " + lines[i].trim(); // wrapped continuation
        else if (!lines[i].trim() && i + 1 < lines.length && LI.test(lines[i + 1])) { /* blank line inside one list */ }
        else break;
        i++;
      }
      blocks.push(<List key={k++} items={buildTree(rows)} onCite={onCite} k={`ul${k}`} />);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```|^#{1,6}\s|^\s*>\s?|^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) && !LI.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={k++} className="my-3 first:mt-0 last:mb-0">
        {para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p, onCite, `p${k}-${j}`)}</Fragment>)}
      </p>
    );
  }
  return <div className="text-[15px] leading-7 break-words [overflow-wrap:anywhere]">{blocks}</div>;
}
