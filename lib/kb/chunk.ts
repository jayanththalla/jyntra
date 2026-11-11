// Splits documents into retrievable chunks that keep a locator (line range or heading).
export interface Chunk {
  idx: number;
  locator: string;
  content: string;
}

const MAX = 1400;
const OVERLAP = 120;

/** Markdown/prose: split on headings and paragraphs; code: windows of lines. */
export function chunkText(text: string, kind: "prose" | "code" = "prose"): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  return kind === "code" ? chunkCode(clean) : chunkProse(clean);
}

function chunkCode(text: string): Chunk[] {
  const lines = text.split("\n");
  const out: Chunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let size = 0;
    while (end < lines.length && (size + lines[end].length + 1 <= MAX || end === start)) size += lines[end++].length + 1;
    out.push({ idx: out.length, locator: `L${start + 1}-L${end}`, content: lines.slice(start, end).join("\n") });
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - 4); // 4 lines of overlap
  }
  return out;
}

function chunkProse(text: string): Chunk[] {
  const sections: { heading: string; body: string }[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };
  for (const line of text.split("\n")) {
    const h = line.match(/^#{1,4}\s+(.+)$/);
    if (h) {
      flush();
      heading = h[1].trim().slice(0, 80);
    } else buf.push(line);
  }
  flush();
  const out: Chunk[] = [];
  for (const s of sections) {
    const paras = s.body.split(/\n{2,}/);
    let cur = "";
    const push = () => {
      if (cur.trim()) out.push({ idx: out.length, locator: s.heading ? `section: ${s.heading}` : "start", content: (s.heading ? `${s.heading}\n` : "") + cur.trim() });
      cur = "";
    };
    for (const p of paras) {
      if (p.length > MAX) {
        push();
        for (let i = 0; i < p.length; i += MAX - OVERLAP) {
          cur = p.slice(i, i + MAX);
          push();
        }
        continue;
      }
      if (cur.length + p.length + 2 > MAX) push();
      cur += (cur ? "\n\n" : "") + p;
    }
    push();
  }
  return out;
}
