// Scheduled sync of city company boards. Pulls each company's public ATS feed, keeps the jobs located in the board's
// city, and stores them with their real application links. A failed request marks the company stale and keeps its
// last good jobs; it never counts as "the jobs closed".
import { errorCategory } from "@/lib/http";
import { query } from "@/lib/database";
import { withAdvisoryLock } from "@/lib/refresh/lock";
import { atsBoardUrl } from "@/sources/jobs/ats";
import { jobsFromPublicAts } from "./alt-sources";
import type { CompanyJobRecord } from "./adapter";
import { companySlugFor, loadBoards, matchesCity, type BoardEntry } from "./boards";
import { markCompanyJobsStale, persistCompanyJobs, recordCompanyFetch, saveSyncRun, upsertCompanyProfile } from "./store";

export type BoardFetcher = (b: BoardEntry, companySlug: string) => Promise<CompanyJobRecord[]>;
const defaultFetcher: BoardFetcher = (b, slug) => jobsFromPublicAts({ vendor: b.ats, slug: b.slug }, slug, 0.5); // 30 min cache: board syncs must see new postings

export interface BoardSyncStats {
  kind: "boards";
  boards: number;
  boardsOk: number;
  jobsFetched: number;
  inserted: number;
  updated: number;
  recovered: number;
  missingApplicationLinks: number;
  invalidLinks: number;
  failures: Record<string, number>;
  httpStatus: Record<string, number>;
  lastSuccessAt: string | null;
  overlappingSkipped: boolean;
}

const empty = (): BoardSyncStats => ({ kind: "boards", boards: 0, boardsOk: 0, jobsFetched: 0, inserted: 0, updated: 0, recovered: 0, missingApplicationLinks: 0, invalidLinks: 0, failures: {}, httpStatus: {}, lastSuccessAt: null, overlappingSkipped: false });

export function boardConcurrency(env = process.env) {
  const n = Number(env.COMPANY_BOARDS_CONCURRENCY ?? 3);
  return Number.isFinite(n) ? Math.min(8, Math.max(1, Math.floor(n))) : 3;
}

export async function syncBoard(b: BoardEntry, fetcher: BoardFetcher = defaultFetcher) {
  const slug = companySlugFor(b);
  const source = `ats:${b.ats}`;
  await upsertCompanyProfile(slug, b.name, { website: b.website ?? null, careers_url: atsBoardUrl({ vendor: b.ats, slug: b.slug }) });
  await query("UPDATE company_profiles SET city=$2 WHERE slug=$1", [slug, b.city]);
  let all: CompanyJobRecord[];
  try {
    all = await fetcher(b, slug);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 0;
    const category = errorCategory(e);
    await markCompanyJobsStale(slug, source);
    await recordCompanyFetch(slug, { ok: false, stale: true, error: (e as Error).message.slice(0, 200), category, httpStatus: status || null });
    return { ok: false as const, category, status };
  }
  const jobs = all.filter((j) => matchesCity(j.location, b.city));
  const r = await persistCompanyJobs(slug, jobs, { complete: true, source });
  await recordCompanyFetch(slug, { ok: true, stale: false, error: null, category: null, httpStatus: 200 });
  return { ok: true as const, fetched: jobs.length, missing: jobs.filter((j) => !j.applicationUrl).length, ...r };
}

export async function syncBoards(opts: { boards?: BoardEntry[]; fetcher?: BoardFetcher } = {}): Promise<{ ran: boolean; stats: BoardSyncStats }> {
  const stats = empty();
  const locked = await withAdvisoryLock("company-boards-sync", async () => {
    const boards = opts.boards ?? loadBoards();
    stats.boards = boards.length;
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(boardConcurrency(), boards.length) }, async () => {
        while (i < boards.length) {
          const b = boards[i++];
          const r = await syncBoard(b, opts.fetcher);
          if (r.ok) {
            stats.boardsOk++;
            stats.jobsFetched += r.fetched;
            stats.inserted += r.inserted;
            stats.updated += r.updated;
            stats.recovered += r.recovered;
            stats.missingApplicationLinks += r.missing;
            stats.lastSuccessAt = new Date().toISOString();
            stats.httpStatus["2xx"] = (stats.httpStatus["2xx"] ?? 0) + 1;
          } else {
            stats.failures[r.category] = (stats.failures[r.category] ?? 0) + 1;
            const k = r.status >= 500 ? "5xx" : r.status >= 400 ? "4xx" : "other";
            stats.httpStatus[k] = (stats.httpStatus[k] ?? 0) + 1;
          }
        }
      })
    );
    await saveSyncRun(stats).catch(() => {});
    return stats;
  });
  if (!locked.ran) {
    stats.overlappingSkipped = true;
    return { ran: false, stats };
  }
  return { ran: true, stats: locked.value };
}

const g = globalThis as unknown as { __boardSync?: boolean };
export function startBoardSync(): boolean {
  if (g.__boardSync) return false;
  g.__boardSync = true;
  syncBoards()
    .catch((e) => console.error("[company-boards] sync failed", (e as Error).message))
    .finally(() => { g.__boardSync = false; });
  return true;
}
