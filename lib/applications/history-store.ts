// Persistence for the historical import. EVERY function takes userId and filters on it; ids from the client are never trusted.
import { query, withTransaction } from "@/lib/database";
import { classify, dedupeBatch, mergePatch, toCandidate, type Candidate, type ExistingApp, type RawCandidate } from "./history";

const COLS = "id, batch, company, role, contact_email, job_url, region, source, verification, match_kind, match_application_id, state, application_id, created_at, updated_at";

export async function existingApps(userId: number, q = query): Promise<ExistingApp[]> {
  return q<ExistingApp>(
    `SELECT a.id, COALESCE(s.name, a.company_name) AS company, COALESCE(a.role_title, j.job_title) AS role, COALESCE(j.job_url, a.application_url) AS "jobUrl"
     FROM applications a LEFT JOIN startups s ON s.id = a.startup_id LEFT JOIN jobs j ON j.id = a.job_id WHERE a.user_id = $1`,
    [userId]
  );
}

export const listCandidates = (userId: number, state?: string) =>
  query(`SELECT ${COLS} FROM application_import_candidates WHERE user_id = $1 AND ($2::text IS NULL OR state = $2) ORDER BY id LIMIT 500`, [userId, state ?? null]);

/** Puts records into review. Creates NO application. Records already pending, or whose key matches an existing application exactly, are reported. */
export async function stage(userId: number, raws: RawCandidate[], batch = "manual") {
  const { candidates, invalid, repeated } = dedupeBatch(raws.slice(0, 200));
  return withTransaction(async (q) => {
    const existing = await existingApps(userId, q);
    const staged: any[] = [];
    const alreadyPending: string[] = [];
    for (const c of candidates) {
      const m = classify(c, existing);
      const rows = await q(
        `INSERT INTO application_import_candidates (user_id, batch, company, role, contact_email, job_url, region, dedupe_key, match_kind, match_application_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (user_id, dedupe_key) WHERE state = 'pending' DO NOTHING RETURNING ${COLS}`,
        [userId, batch.slice(0, 60), c.company, c.role, c.contactEmail, c.jobUrl, c.region, c.dedupeKey, m.kind, m.matchId]
      );
      rows[0] ? staged.push(rows[0]) : alreadyPending.push(c.company);
    }
    await q("INSERT INTO application_audit (user_id, action, detail) VALUES ($1,'import_staged',$2)", [userId, `${staged.length} staged, ${alreadyPending.length} already pending`]);
    return { staged, alreadyPending, invalid, repeatedInBatch: repeated };
  });
}

/** Edit a pending candidate. Dedupe state is recomputed from the edited values. */
export async function editCandidate(userId: number, id: number, p: { company?: string; role?: string | null; contact?: string | null; jobUrl?: string | null }) {
  return withTransaction(async (q) => {
    const [cur] = await q("SELECT * FROM application_import_candidates WHERE id = $1 AND user_id = $2 AND state = 'pending' FOR UPDATE", [id, userId]);
    if (!cur) return null;
    const c = toCandidate({
      company: p.company ?? cur.company,
      role: p.role === undefined ? cur.role : p.role,
      contact: p.contact === undefined ? cur.contact_email : p.contact,
      jobUrl: p.jobUrl === undefined ? cur.job_url : p.jobUrl,
      region: cur.region,
    });
    if (!c) return "invalid" as const;
    const clash = await q("SELECT 1 FROM application_import_candidates WHERE user_id = $1 AND dedupe_key = $2 AND state = 'pending' AND id <> $3", [userId, c.dedupeKey, id]);
    if (clash.length) return "clash" as const;
    const m = classify(c, await existingApps(userId, q));
    const [row] = await q(
      `UPDATE application_import_candidates SET company=$3, role=$4, contact_email=$5, job_url=$6, dedupe_key=$7, match_kind=$8, match_application_id=$9, updated_at=now()
       WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`,
      [id, userId, c.company, c.role, c.contactEmail, c.jobUrl, c.dedupeKey, m.kind, m.matchId]
    );
    return row;
  });
}

export async function skipCandidate(userId: number, id: number) {
  const r = await query("UPDATE application_import_candidates SET state='skipped', updated_at=now() WHERE id=$1 AND user_id=$2 AND state='pending' RETURNING id", [id, userId]);
  return r.length > 0;
}

export type ConfirmDecision = { id: number; action: "create" | "merge"; mergeInto?: number; createAnyway?: boolean };
export interface ConfirmResult { id: number; outcome: "created" | "merged" | "needs_decision" | "not_found" | "failed"; applicationId?: number }

/**
 * Confirms reviewed candidates, one transaction per candidate (one failure does not undo the others).
 *  - Created rows get status 'To Verify' / status_certainty 'unknown' / verification 'unverified'. Never 'Applied'.
 *  - A candidate flagged duplicate / possible_duplicate is NOT created unless the user passes createAnyway, or merges into an application they own.
 *  - A merge only fills empty fields on the existing application.
 */
export async function confirm(userId: number, decisions: ConfirmDecision[]): Promise<ConfirmResult[]> {
  const out: ConfirmResult[] = [];
  for (const d of decisions.slice(0, 200)) {
    try {
      out.push(await withTransaction<ConfirmResult>(async (q) => {
        const [cur] = await q("SELECT * FROM application_import_candidates WHERE id = $1 AND user_id = $2 AND state = 'pending' FOR UPDATE", [d.id, userId]);
        if (!cur) return { id: d.id, outcome: "not_found" };
        const c: Candidate = { company: cur.company, role: cur.role, contactEmail: cur.contact_email, jobUrl: cur.job_url, region: cur.region, dedupeKey: cur.dedupe_key };
        if (d.action === "merge") {
          const targetId = d.mergeInto ?? cur.match_application_id;
          const [app] = targetId ? await q("SELECT id, contact_email, role_title, record_source FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE", [targetId, userId]) : [];
          if (!app) return { id: d.id, outcome: "not_found" };
          const p = mergePatch(app, c);
          await q("UPDATE applications SET contact_email=$3, role_title=$4, record_source=$5, updated_at=now() WHERE id=$1 AND user_id=$2", [app.id, userId, p.contact_email, p.role_title, p.record_source]);
          await q("UPDATE application_import_candidates SET state='merged', application_id=$3, updated_at=now() WHERE id=$1 AND user_id=$2", [d.id, userId, app.id]);
          await q("INSERT INTO application_audit (user_id, action, application_id, detail) VALUES ($1,'import_merged',$2,$3)", [userId, app.id, c.company]);
          return { id: d.id, outcome: "merged", applicationId: app.id };
        }
        if (cur.match_kind !== "new" && !d.createAnyway) return { id: d.id, outcome: "needs_decision" };
        // A "create anyway" on an exact duplicate still gets a unique key so the same record can't be imported twice by accident.
        const key = cur.match_kind === "new" ? cur.dedupe_key : `${cur.dedupe_key}#${cur.id}`;
        const [app] = await q(
          `INSERT INTO applications (user_id, startup_id, status, company_name, role_title, contact_email, application_url, record_source, verification_state, status_certainty, import_key, notes)
           VALUES ($1, NULL, 'To Verify', $2, $3, $4, $5, $6, 'unverified', 'unknown', $7, 'Imported from historical records. Whether and when you applied has not been verified.')
           ON CONFLICT (user_id, import_key) WHERE import_key IS NOT NULL DO NOTHING RETURNING id`,
          [userId, c.company, c.role, c.contactEmail, c.jobUrl, cur.source, key]
        );
        if (!app) return { id: d.id, outcome: "needs_decision" };
        await q("UPDATE application_import_candidates SET state='confirmed', application_id=$3, updated_at=now() WHERE id=$1 AND user_id=$2", [d.id, userId, app.id]);
        await q("INSERT INTO application_audit (user_id, action, application_id, detail) VALUES ($1,'import_confirmed',$2,$3)", [userId, app.id, c.company]);
        return { id: d.id, outcome: "created", applicationId: app.id };
      }));
    } catch {
      out.push({ id: d.id, outcome: "failed" });
    }
  }
  return out;
}
