// Runs one source's synchronisation: authorise -> fetch -> normalise -> store -> record status.
// Safe against concurrent runs (advisory lock + status check), cancellable, and never marks a failed sync healthy.
import { query } from "@/lib/database";
import { decryptSecret } from "./crypto";
import { getConnector } from "./connectors";
import { audit, getSource, rebuildEntities, storeDocuments } from "./store";
import { DEFAULT_LIMITS, SourceError, type SyncContext } from "./types";

export interface SyncOutcome {
  ok: boolean;
  skipped?: "already_running" | "not_found" | "disconnected";
  error?: string;
  stats?: Record<string, number>;
  warnings?: string[];
}

const SAFE_MESSAGE: Record<string, string> = {
  unauthorized: "Access was denied. Reconnect this source.",
  revoked: "Access was revoked. Reconnect this source.",
  rate_limited: "The provider's rate limit was reached. Try again later.",
  not_found: "The account or resource wasn't found, or isn't accessible.",
  unavailable: "The provider couldn't be reached. Try again later.",
  invalid: "The source settings are invalid.",
};

export async function syncSource(userId: number, sourceId: number, deps: { fetchImpl?: typeof fetch; limits?: Partial<SyncContext["limits"]> } = {}): Promise<SyncOutcome> {
  const src = await getSource(userId, sourceId);
  if (!src) return { ok: false, skipped: "not_found" };
  if (src.status === "disconnected") return { ok: false, skipped: "disconnected" };
  // Claim the run: only one sync per source at a time (a stale 'syncing' older than 15 minutes is taken over).
  const claimed = await query(
    `UPDATE kb_sources SET status = 'syncing', cancel_requested = false, last_attempt_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status <> 'disconnected' AND (status <> 'syncing' OR last_attempt_at < now() - interval '15 minutes') RETURNING id`,
    [sourceId, userId]
  );
  if (!claimed.length) return { ok: false, skipped: "already_running" };

  const connector = getConnector(src.provider);
  const warnings: string[] = [];
  try {
    if (!connector) throw new SourceError("invalid", "Unsupported provider");
    let token: string | null = null;
    if (src.credentials_enc) {
      try {
        token = decryptSecret(src.credentials_enc);
      } catch {
        throw new SourceError("revoked", "Stored credential can't be read");
      }
    }
    const cancelled = async () => {
      const [r] = await query<{ cancel_requested: boolean; status: string }>("SELECT cancel_requested, status FROM kb_sources WHERE id = $1 AND user_id = $2", [sourceId, userId]);
      return !r || r.cancel_requested || r.status === "disconnected";
    };
    let cancelFlag = false;
    const poll = setInterval(async () => {
      cancelFlag = await cancelled().catch(() => false);
    }, 2000);
    try {
      const ctx: SyncContext = {
        userId, sourceId, config: src.config, token,
        fetchImpl: deps.fetchImpl ?? fetch,
        cancelled: () => cancelFlag,
        log: () => {},
        limits: { ...DEFAULT_LIMITS, ...deps.limits },
      };
      const result = await connector.sync(ctx);
      warnings.push(...result.warnings);
      if (cancelFlag || (await cancelled())) {
        await query("UPDATE kb_sources SET status = CASE WHEN status = 'disconnected' THEN status ELSE 'connected' END, last_error = 'Sync cancelled', updated_at = now() WHERE id = $1 AND user_id = $2", [sourceId, userId]);
        return { ok: false, error: "cancelled", warnings };
      }
      const stats = await storeDocuments(userId, sourceId, src.provider, result.docs, { complete: result.complete });
      await rebuildEntities(userId);
      await query(
        `UPDATE kb_sources SET status = 'connected', last_synced_at = now(), last_error = $3, last_stats = $4, updated_at = now() WHERE id = $1 AND user_id = $2`,
        [sourceId, userId, warnings.length ? warnings.join(" ").slice(0, 900) : null, JSON.stringify({ ...stats, complete: result.complete })]
      );
      await audit(userId, "sync_ok", sourceId, `+${stats.added} ~${stats.updated} =${stats.unchanged} -${stats.removed}`);
      return { ok: true, stats: stats as unknown as Record<string, number>, warnings };
    } finally {
      clearInterval(poll);
    }
  } catch (e) {
    const code = e instanceof SourceError ? e.code : "unavailable";
    const msg = SAFE_MESSAGE[code] ?? SAFE_MESSAGE.unavailable;
    if (!(e instanceof SourceError)) console.error("[kb/sync] unexpected:", (e as Error).name, (e as Error).message.slice(0, 120));
    await query(
      `UPDATE kb_sources SET status = $3, last_error = $4, updated_at = now(), credentials_enc = CASE WHEN $3 = 'revoked' THEN NULL ELSE credentials_enc END WHERE id = $1 AND user_id = $2 AND status <> 'disconnected'`,
      [sourceId, userId, code === "revoked" || code === "unauthorized" ? "revoked" : "error", msg]
    );
    await audit(userId, "sync_failed", sourceId, code);
    return { ok: false, error: msg, warnings };
  }
}

/** Fire-and-forget background run in this process (same model as discovery). Errors are recorded on the source. */
export function syncInBackground(userId: number, sourceId: number) {
  void syncSource(userId, sourceId).catch((e) => console.error("[kb/sync] background:", (e as Error).message));
}
