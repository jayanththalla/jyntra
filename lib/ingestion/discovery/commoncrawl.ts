// Incremental board discovery from the Common Crawl URL index (public CDX API). Technique (JSON-lines output, block paging with
// pageSize=1, persisted page cursor, skipping Workday impl* sandbox tenants) follows jobscraper_hourly `src/discover.ts` (MIT).
// Hits are CANDIDATES only: every one is validated against its real ATS endpoint before it can become a source.
import { httpRequest } from "../http";
import { detectAts } from "../providers/detect";
import { addCandidate, getState, putState } from "./candidates";

export const CC_COLLINFO = "https://index.commoncrawl.org/collinfo.json";
export const CC_PATTERNS = ["boards.greenhouse.io/*", "job-boards.greenhouse.io/*", "jobs.lever.co/*", "jobs.ashbyhq.com/*", "*.myworkdayjobs.com"];
const NOT_A_COMPANY = /^(embed|api|v1|assets|static|images|css|js|robots\.txt|sitemap\.xml|favicon\.ico|_next|jobs|job|apply)$/i;

export interface CcCursor { crawlId: string | null; patternIndex: number; page: number; completedCrawls: string[]; updatedAt?: string }

/** JSON-lines (not an array). Bad lines are skipped. */
export function parseCcLines(body: string, cap = 250_000): { url: string }[] {
  const out: { url: string }[] = [];
  for (const line of body.split("\n")) {
    if (!line || out.length >= cap) continue;
    try { const o = JSON.parse(line); if (o && typeof o.url === "string") out.push({ url: o.url }); } catch { /* skip */ }
  }
  return out;
}

/** Turns a crawled URL into a candidate, or null (sandbox tenant, plumbing path, unrecognised). */
export function candidateFromCcUrl(url: string) {
  if (/\.impl[-\w]*\.myworkdayjobs\.com/i.test(url)) return null;
  const d = detectAts(url);
  if (!d) return null;
  const first = d.boardSlug ?? d.tenant;
  if (!first || NOT_A_COMPANY.test(first)) return null;
  if (d.provider !== "greenhouse" && d.provider !== "lever" && d.provider !== "ashby" && d.provider !== "workday") return null;
  return d;
}

export async function discoverFromCommonCrawl(o: { maxBlocks?: number; fetchText?: (u: string) => Promise<string> } = {}): Promise<{ crawlId: string | null; blocks: number; rows: number; added: number; known: number; exhaustedCrawl: boolean; cursor: CcCursor }> {
  const get = o.fetchText ?? (async (u: string) => (await httpRequest(u, { timeoutMs: 120_000, maxBytes: 40_000_000 })).text);
  const cur: CcCursor = { crawlId: null, patternIndex: 0, page: 0, completedCrawls: [], ...(await getState<CcCursor>("commoncrawl")) };
  let crawlId = cur.crawlId;
  if (!crawlId) {
    const list = JSON.parse(await get(CC_COLLINFO)) as { id: string }[];
    crawlId = list.map((c) => c.id).find((id) => !cur.completedCrawls.includes(id)) ?? null; // newest crawl not yet fully scanned
    if (!crawlId) return { crawlId: null, blocks: 0, rows: 0, added: 0, known: 0, exhaustedCrawl: false, cursor: cur };
    Object.assign(cur, { crawlId, patternIndex: 0, page: 0 });
  }
  let blocks = 0, rows = 0, added = 0, known = 0, exhausted = false;
  const max = o.maxBlocks ?? 5;
  while (blocks < max) {
    const pattern = CC_PATTERNS[cur.patternIndex]!;
    const body = await get(`https://index.commoncrawl.org/${crawlId}-index?url=${encodeURIComponent(pattern)}&output=json&fl=url&filter=status:200&page=${cur.page}&pageSize=1`).catch(() => "");
    const hits = parseCcLines(body);
    blocks++;
    if (!hits.length) { // pattern exhausted → next pattern; all patterns exhausted → crawl complete
      cur.patternIndex++; cur.page = 0;
      if (cur.patternIndex >= CC_PATTERNS.length) { exhausted = true; cur.completedCrawls.push(crawlId); cur.crawlId = null; cur.patternIndex = 0; break; }
      continue;
    }
    for (const h of hits) {
      rows++;
      const d = candidateFromCcUrl(h.url);
      if (!d) continue;
      const r = await addCandidate({ name: d.boardSlug ?? d.tenant!, provider: d.provider, boardSlug: d.boardSlug, tenant: d.tenant, host: d.host, careerSite: d.careerSite, origin: `commoncrawl:${crawlId}`, originRef: h.url.slice(0, 200) });
      r.isNew ? added++ : known++;
    }
    cur.page++;
  }
  cur.updatedAt = new Date().toISOString();
  await putState("commoncrawl", cur);
  return { crawlId, blocks, rows, added, known, exhaustedCrawl: exhausted, cursor: cur };
}
