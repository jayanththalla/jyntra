// How current each indexed source is, and what to do about it. Atlas always answers from the latest SUCCESSFUL index; it never claims
// that an external source is instantly in sync. Freshness is reported per source with its own last-sync time.
//
//   fresh    last successful sync is recent and no newer change has been observed
//   stale    the index is old, or a probe saw a change newer than the last sync (a refresh is queued)
//   syncing  a refresh is running now
//   failed   the last sync failed (the previous successful index is still used, and its age is shown)
//   never    connected but not synced yet
//   manual   uploads, notes and pasted text have no external source to fall behind
import { query } from "@/lib/database";
import { getConnector } from "./connectors";
import { decryptSecret } from "./crypto";
import { syncSource } from "./sync";
import type { Provider } from "./types";

export type FreshState = "fresh" | "stale" | "syncing" | "failed" | "never" | "manual";

/** Age after which an automatically-synced provider is considered behind. Manual providers have none. */
export const STALE_AFTER_MS: Partial<Record<Provider, number>> = {
  github: 6 * 3_600_000,
  codeforces: 12 * 3_600_000,
  gdocs: 24 * 3_600_000,
  portfolio: 24 * 3_600_000,
};
export const PROBE_MIN_GAP_MS = 10 * 60_000; // never probe one source more often than this
export const RETRY_FAILED_AFTER_MS = 30 * 60_000; // a failed sync is retried automatically no sooner than this

export interface SourceRow {
  id: number;
  provider: string;
  label: string;
  status: string;
  last_synced_at: string | null;
  last_attempt_at: string | null;
  last_probe_at: string | null;
  update_observed_at: string | null;
  last_error: string | null;
}
export interface SourceFreshness {
  sourceId: number;
  provider: string;
  label: string;
  state: FreshState;
  lastSyncedAt: string | null;
  /** short, user-facing sentence; null when everything is fine */
  notice: string | null;
}

export const ago = (iso: string, now: number) => {
  const m = Math.max(0, (now - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export function classifyFreshness(s: SourceRow, now = Date.now()): SourceFreshness {
  const base = { sourceId: s.id, provider: s.provider, label: s.label, lastSyncedAt: s.last_synced_at };
  const limit = STALE_AFTER_MS[s.provider as Provider];
  if (s.status === "syncing" || s.status === "pending") return { ...base, state: "syncing", notice: `${s.label} is being refreshed. This answer uses the previous index${s.last_synced_at ? ` (${ago(s.last_synced_at, now)})` : ""}.` };
  if (s.status === "revoked") return { ...base, state: "failed", notice: `Access to ${s.label} was revoked, so it is no longer refreshed. Reconnect it to update.${s.last_synced_at ? ` Using the last index from ${ago(s.last_synced_at, now)}.` : ""}` };
  if (s.status === "error") {
    const prev = s.last_synced_at ? ` Using the last successful index from ${ago(s.last_synced_at, now)}.` : " Nothing from it is indexed yet.";
    return { ...base, state: "failed", notice: `${s.label} could not be refreshed.${prev}` };
  }
  if (!limit) return { ...base, state: "manual", notice: null };
  if (!s.last_synced_at) return { ...base, state: "never", notice: `${s.label} has not been indexed yet.` };
  const age = now - Date.parse(s.last_synced_at);
  const observed = !!s.update_observed_at && Date.parse(s.update_observed_at) > Date.parse(s.last_synced_at);
  if (observed || age > limit) {
    return { ...base, state: "stale", notice: `${s.label} was last indexed ${ago(s.last_synced_at, now)}${observed ? " and has newer changes" : ""}. A refresh is queued; this answer uses the indexed copy.` };
  }
  return { ...base, state: "fresh", notice: null };
}

export interface EnsureDeps {
  now?: () => number;
  /** Starts a background sync (must not block). */
  queueSync: (userId: number, sourceId: number) => void;
  /** Runs a source's cheap probe; throws on provider errors. */
  probe: (src: SourceRow, userId: number) => Promise<{ latestChangeAt: string | null } | null>;
}

const COLS = "id, provider, label, status, last_synced_at, last_attempt_at, last_probe_at, update_observed_at, last_error";

export async function loadSources(userId: number, sourceIds?: number[]): Promise<SourceRow[]> {
  const rows = await query<any>(
    `SELECT ${COLS} FROM kb_sources WHERE user_id = $1 AND status <> 'disconnected' ${sourceIds?.length ? "AND id = ANY($2::int[])" : ""} ORDER BY id`,
    sourceIds?.length ? [userId, sourceIds] : [userId]
  );
  const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
  return rows.map((r) => ({ ...r, last_synced_at: iso(r.last_synced_at), last_attempt_at: iso(r.last_attempt_at), last_probe_at: iso(r.last_probe_at), update_observed_at: iso(r.update_observed_at) }));
}

/**
 * Looks at the user's sources, queues refreshes where the index is behind, and returns each source's freshness AFTER that decision.
 *  - age past the provider's limit            → queue a sync
 *  - a probe sees a change newer than the sync → record the observation, queue a sync
 *  - a failed sync, retried no sooner than RETRY_FAILED_AFTER_MS (revoked access is never retried: it needs the user)
 * Probes are rate limited per source and best-effort: a probe error changes nothing. Syncs themselves are de-duplicated by syncSource's claim.
 */
export async function ensureFresh(userId: number, deps: EnsureDeps, sourceIds?: number[]): Promise<SourceFreshness[]> {
  const now = deps.now ?? Date.now;
  const rows = await loadSources(userId, sourceIds);
  const out: SourceFreshness[] = [];
  await Promise.all(
    rows.map(async (s) => {
      let row = s;
      const t = now();
      const limit = STALE_AFTER_MS[s.provider as Provider];
      let queue = false;
      if (s.status === "connected" && limit) {
        const age = s.last_synced_at ? t - Date.parse(s.last_synced_at) : Infinity;
        if (age > limit) queue = true;
        else if (getConnector(s.provider as Provider)?.probe && (!s.last_probe_at || t - Date.parse(s.last_probe_at) > PROBE_MIN_GAP_MS)) {
          await query("UPDATE kb_sources SET last_probe_at = now() WHERE id = $1 AND user_id = $2", [s.id, userId]).catch(() => {});
          const r = await deps.probe(s, userId).catch(() => null);
          if (r?.latestChangeAt && s.last_synced_at && Date.parse(r.latestChangeAt) > Date.parse(s.last_synced_at)) {
            await query("UPDATE kb_sources SET update_observed_at = now() WHERE id = $1 AND user_id = $2", [s.id, userId]).catch(() => {});
            row = { ...s, update_observed_at: new Date(t).toISOString() };
            queue = true;
          }
        }
      } else if (s.status === "error" && limit !== undefined && (!s.last_attempt_at || t - Date.parse(s.last_attempt_at) > RETRY_FAILED_AFTER_MS)) {
        queue = true;
      }
      const f = classifyFreshness(row, t);
      if (queue) {
        deps.queueSync(userId, s.id);
        // The queued run is not "running" yet in our copy of the row; the notice for a stale source already says a refresh is queued.
        out.push(f.state === "failed" ? { ...f, notice: `${s.label} could not be refreshed last time; trying again now. Using the last successful index${s.last_synced_at ? ` from ${ago(s.last_synced_at, t)}` : ""}.` } : f);
      } else out.push(f);
    })
  );
  return out.sort((a, b) => a.sourceId - b.sourceId);
}

/** Production wiring: real probes (with the user's stored credential, if any) and a fire-and-forget background sync. */
export const defaultEnsureDeps: EnsureDeps = {
  queueSync: (userId, sourceId) => void syncSource(userId, sourceId).catch((e) => console.error("[kb/fresh] queued sync failed:", (e as Error).message)),
  probe: async (src, userId) => {
    const c = getConnector(src.provider as Provider);
    if (!c?.probe) return null;
    const [row] = await query<{ config: any; credentials_enc: string | null }>("SELECT config, credentials_enc FROM kb_sources WHERE id = $1 AND user_id = $2", [src.id, userId]);
    if (!row) return null;
    let token: string | null = null;
    if (row.credentials_enc) {
      try { token = decryptSecret(row.credentials_enc); } catch { return null; }
    }
    return c.probe({ config: row.config, token, fetchImpl: fetch });
  },
};

/** Adds the source's own last-sync time and state to each citation. Only sources owned by the user are ever looked at. */
export function annotateCitations<C extends { documentId: number | null }>(citations: C[], docSource: Map<number, number>, fresh: SourceFreshness[]): (C & { source?: { id: number; label: string; state: FreshState; lastSyncedAt: string | null } })[] {
  const by = new Map(fresh.map((f) => [f.sourceId, f]));
  return citations.map((c) => {
    const sid = c.documentId != null ? docSource.get(c.documentId) : undefined;
    const f = sid != null ? by.get(sid) : undefined;
    return f ? { ...c, source: { id: f.sourceId, label: f.label, state: f.state, lastSyncedAt: f.lastSyncedAt } } : c;
  });
}
