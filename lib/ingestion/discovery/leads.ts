// Company leads from directories (T-Hub, Startup Telangana, Mapping HYD exports, open startup lists, funding feeds).
// They are not job APIs: a lead only gives a company name + website, which the pipeline then resolves to a real ATS board.
import { addCandidate } from "./candidates";
import { validateApplicationUrl } from "@/lib/company-jobs/urls";

export interface Lead { name: string; website?: string | null }

/** CSV (name,website[,...]), JSON array, or "Name | https://site" lines. */
export function parseLeads(raw: string): Lead[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const j = JSON.parse(t);
      const arr: any[] = Array.isArray(j) ? j : Array.isArray(j.companies) ? j.companies : [];
      return arr.map((x) => ({ name: String(x.name ?? x.company ?? "").trim(), website: x.website ?? x.url ?? x.domain ?? null })).filter((x) => x.name);
    } catch { return []; }
  }
  const out: Lead[] = [];
  for (const line of t.split(/\r?\n/)) {
    const cols = line.includes("|") ? line.split("|") : line.split(",");
    const name = cols[0]?.replace(/^"|"$/g, "").trim();
    if (!name || /^name$/i.test(name)) continue;
    out.push({ name, website: cols[1]?.replace(/^"|"$/g, "").trim() || null });
  }
  return out;
}

export function normalizeWebsite(w: string | null | undefined): string | null {
  if (!w) return null;
  const s = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return validateApplicationUrl(s.replace(/^http:\/\//i, "https://"));
}

export async function importLeads(leads: Lead[], origin: string): Promise<{ seen: number; added: number }> {
  let added = 0;
  for (const l of leads) {
    const r = await addCandidate({ name: l.name, websiteUrl: normalizeWebsite(l.website), origin });
    if (r.isNew) added++;
  }
  return { seen: leads.length, added };
}
