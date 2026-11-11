// Funding articles: stored once each, with provenance. Nothing is invented: a missing publication date stays
// NULL, and amount/round/currency are kept only when the headline or summary itself states them.
import { query, withTransaction, type Q } from "@/lib/database";
import { canonicalUrl, safeHttpUrl } from "@/lib/url";
import { fundingStage, parseAmount, parseFundingHeadline } from "@/lib/funding";
import { normalizeName } from "@/lib/deduplication";
import { detectCurrency } from "@/lib/normalize";
import { approxUsd, findNearDuplicate, sameRaise } from "./dedupe";
import { headlineFingerprint, resolveCompanyLinks, type CompanyLinks } from "./company-links";
import { NOT_A_RAISE } from "./feeds";
import { linksFor, companyKey, type CompanyLinks as EnrichedLinks } from "./company-enrich";
import { outletsOf, verificationOf, type Verification } from "./taxonomy";

/** A story is kept only if its own headline/summary states a raise. Applies to EVERY provider, so a search hit is never trusted just for ranking. */
export function isFundingArticle(headline: string, summary?: string | null): boolean {
  const h = headline.replace(/^\[[^\]]+\]\s*/, "");
  return !NOT_A_RAISE.test(h) && !!parseFundingHeadline(h, summary ?? "");
}

export interface ArticleInput {
  url: string;
  headline: string;
  publisher: string;
  summary?: string | null;
  /** The publisher/provider's date text, or null. Parsed here; invalid text becomes null. */
  publishedAt?: string | null;
  provider: "rss" | "tavily" | "google_cse" | "gdelt";
  /** Which connector produced it (lib/news/connectors). Provenance only. */
  connector?: string;
  /** True when the item comes from a company press-release / investor announcement feed: the announcement itself. */
  official?: boolean;
  /** When a DISCOVERY provider first saw the URL. Provenance only: never shown as a publication date. */
  seenAt?: string | null;
}

export type Freshness = "fresh" | "recent" | "older" | "undated";

export interface Article {
  id: number;
  url: string;
  headline: string;
  publisher: string;
  summary: string | null;
  published_at: string | null;
  company_name: string | null;
  startup_id: number | null;
  funding_amount: string | null;
  funding_currency: string | null;
  funding_round: string | null;
  investors: string[];
  announcement_kind: "confirmed" | "planned" | "rumored";
  also_reported: { publisher: string; url: string }[];
  provider: string;
  first_ingested_at: string;
  last_checked_at: string;
  freshness: Freshness;
  /** Company links with an explicit verified/unverified label. Absent links are simply not shown. */
  links: CompanyLinks;
  /** Active roles we have listed for the matched company. A funding story is NOT evidence of an opening; this is a separate fact. */
  listed_roles: number;
  /** Where the date came from: the publisher, or nowhere (null). */
  date_source: string | null;
  /** The story comes from an official announcement feed (company or investor). */
  official?: boolean;
  /** Verified official website / LinkedIn / careers links WITH provenance (lib/news/company-enrich.ts). Absent = not checked or nothing verified. */
  enriched?: EnrichedLinks;
  /** Corroboration, derived from announcement_kind and how many different publishers carry the story. See taxonomy.ts. */
  verification: Verification;
  /** Different publishers carrying this story (1 = only the one we stored). */
  outlets: number;
  /** Taxonomy ids (lib/news/taxonomy.ts). Null = unknown, never a guess. */
  city: string | null;
  city_source: string | null;
  sector: string | null;
  sector_source: string | null;
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  const t = d.getTime();
  // Reject unparsable dates and anything implausible (before 2000 or more than a day in the future).
  if (Number.isNaN(t) || d.getFullYear() < 2000 || t > Date.now() + 86_400_000) return null;
  return d.toISOString();
}

export function freshnessOf(publishedAt: string | null, now = Date.now()): Freshness {
  if (!publishedAt) return "undated";
  const days = (now - new Date(publishedAt).getTime()) / 86_400_000;
  return days <= 7 ? "fresh" : days <= 30 ? "recent" : "older";
}

export interface UpsertArticlesResult {
  inserted: number;
  updated: number;
  nearDuplicates: number;
  skipped: number;
}

export async function upsertArticles(items: ArticleInput[]): Promise<UpsertArticlesResult> {
  const out: UpsertArticlesResult = { inserted: 0, updated: 0, nearDuplicates: 0, skipped: 0 };
  if (!items.length) return out;
  await withTransaction(async (q: Q) => {
    await q("SELECT pg_advisory_xact_lock(hashtext('articles'))"); // one writer at a time
    const recent = await q<{ id: number; headline: string; company_name: string | null; funding_currency: string | null; amount_value: string | null; funding_round: string | null; published_at: string | null; announcement_kind: string; publisher: string }>(
      "SELECT id, headline, company_name, funding_currency, amount_value, funding_round, published_at, announcement_kind, publisher FROM funding_articles WHERE first_ingested_at > now() - interval '90 days' ORDER BY id DESC LIMIT 1500"
    );
    for (const it of items) {
      const safeUrl = safeHttpUrl(it.url);
      const canon = safeUrl ? canonicalUrl(safeUrl) : null;
      const headline = it.headline.replace(/\s+/g, " ").trim();
      if (!canon || !headline) {
        out.skipped++;
        continue;
      }
      const parsed = parseFundingHeadline(headline, it.summary ?? "");
      const company = parsed?.company ?? null;
      const fingerprint = headlineFingerprint(headline);

      const [same] = await q<{ id: number }>("SELECT id FROM funding_articles WHERE canonical_url = $1", [canon]);
      if (!same && fingerprint) {
        // Identical story text under a different URL (syndication, AMP/mobile copies, other outlets): one card, remember the other link.
        const [fp] = await q<{ id: number; publisher: string }>("SELECT id, publisher FROM funding_articles WHERE content_fingerprint = $1 ORDER BY id LIMIT 1", [fingerprint]);
        if (fp) {
          await q(
            `UPDATE funding_articles SET last_checked_at = now(),
               also_reported = CASE WHEN publisher = $2 OR also_reported @> $3::jsonb THEN also_reported ELSE also_reported || $3::jsonb END
             WHERE id = $1`,
            [fp.id, it.publisher.slice(0, 80), JSON.stringify([{ publisher: it.publisher.slice(0, 80), url: safeUrl }])]
          );
          await q(
            "INSERT INTO duplicate_candidates (kind, ref_a, ref_b, reason) VALUES ('article',$1,$2,'identical headline text (fingerprint); kept the first copy') ON CONFLICT DO NOTHING",
            [String(fp.id), canon.slice(0, 500)]
          );
          if (it.official) await q("UPDATE funding_articles SET verification_status = 'official' WHERE id = $1", [fp.id]);
          out.nearDuplicates++;
          continue;
        }
      }
      if (!same) {
        // Different URL: is it the same story in another outlet? Only when clearly so.
        const dup = findNearDuplicate({ headline, company_name: company }, recent);
        if (dup) {
          await q("UPDATE funding_articles SET last_checked_at = now() WHERE id = $1", [dup.id]);
          await q(
            "INSERT INTO duplicate_candidates (kind, ref_a, ref_b, reason) VALUES ('article',$1,$2,'near-identical headline; kept the first copy') ON CONFLICT DO NOTHING",
            [String(dup.id), canon.slice(0, 500)]
          );
          if (it.official) await q("UPDATE funding_articles SET verification_status = 'official' WHERE id = $1", [dup.id]);
          out.nearDuplicates++;
          continue;
        }
      }

      const pa = parseAmount(parsed?.amount ?? null);
      const publishedIso = parseDate(it.publishedAt);
      const facts = { company, usd: approxUsd(pa?.value, pa?.currency), stage: fundingStage(parsed?.round ?? null), at: publishedIso };
      if (!same && company) {
        // The same raise written up by another outlet (different headline): keep one card and remember who else covered it.
        const twin = recent.find((e) => sameRaise(facts, { company: e.company_name, usd: approxUsd(e.amount_value ? Number(e.amount_value) : null, e.funding_currency), stage: fundingStage(e.funding_round), at: e.published_at }));
        if (twin) {
          const upgrade = parsed?.kind === "confirmed" && twin.announcement_kind !== "confirmed";
          await q(
            `UPDATE funding_articles SET last_checked_at = now(),
               also_reported = CASE WHEN publisher = $3 OR also_reported @> $4::jsonb THEN also_reported ELSE also_reported || $4::jsonb END,
               investors = CASE WHEN cardinality(investors) = 0 THEN $5::text[] ELSE investors END,
               announcement_kind = CASE WHEN $6::boolean THEN 'confirmed' ELSE announcement_kind END
             WHERE id = $1 AND $2::text IS NOT NULL`,
            [twin.id, safeUrl, it.publisher.slice(0, 80), JSON.stringify([{ publisher: it.publisher.slice(0, 80), url: safeUrl }]), parsed?.investors ?? [], upgrade]
          );
          if (it.official) await q("UPDATE funding_articles SET verification_status = 'official' WHERE id = $1", [twin.id]);
          out.nearDuplicates++;
          continue;
        }
      }

      const matches = company ? await q<{ id: number }>("SELECT id FROM startups WHERE normalized_name = $1 LIMIT 2", [normalizeName(company)]) : [];
      const startupId = matches.length === 1 ? matches[0].id : null; // ambiguous or unknown → not linked

      const rows = await q<{ id: number; inserted: boolean }>(
        `INSERT INTO funding_articles (canonical_url, url, headline, publisher, summary, published_at, company_name, startup_id,
                                       funding_amount, funding_currency, funding_round, provider, investors, announcement_kind, amount_value,
                                       content_fingerprint, provider_seen_at, date_source, source_connector, verification_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (canonical_url) DO UPDATE SET
           last_checked_at = now(),
           published_at = COALESCE(funding_articles.published_at, EXCLUDED.published_at),
           date_source = COALESCE(funding_articles.date_source, EXCLUDED.date_source),
           content_fingerprint = COALESCE(funding_articles.content_fingerprint, EXCLUDED.content_fingerprint),
           summary = COALESCE(funding_articles.summary, EXCLUDED.summary),
           verification_status = CASE WHEN EXCLUDED.verification_status = 'official' THEN 'official' ELSE funding_articles.verification_status END,
           startup_id = COALESCE(funding_articles.startup_id, EXCLUDED.startup_id)
         RETURNING id, (xmax = 0) AS inserted`,
        [
          canon, safeUrl, headline.slice(0, 300), it.publisher.slice(0, 80), it.summary ? it.summary.slice(0, 600) : null,
          parseDate(it.publishedAt), company, startupId, parsed?.amount ?? null, detectCurrency(parsed?.amount ?? null), parsed?.round ?? null, it.provider,
          parsed?.investors ?? [], parsed?.kind ?? "confirmed", pa?.value ?? null,
          fingerprint, it.seenAt ? parseDate(it.seenAt) : null, publishedIso ? "publisher" : null,
          it.connector ?? null, it.official ? "official" : null,
        ]
      );
      if (rows[0].inserted) {
        out.inserted++;
        recent.unshift({ id: rows[0].id, headline, company_name: company, funding_currency: detectCurrency(parsed?.amount ?? null), amount_value: pa ? String(pa.value) : null, funding_round: parsed?.round ?? null, published_at: publishedIso, announcement_kind: parsed?.kind ?? "confirmed", publisher: it.publisher });
      } else out.updated++;
    }
  });
  return out;
}

export interface ListFilters {
  q?: string;
  publisher?: string;
  /** "confirmed" hides planned ("in talks") and unconfirmed ("reportedly") stories. */
  kind?: "confirmed";
  days?: number;
  /** Case-insensitive exact match on the stored round label (e.g. "Seed", "Series A"). */
  round?: string;
  /** Only stories about a company that currently has open roles in our database. */
  hiring?: boolean;
  /** Case-insensitive exact match on one named investor in the story's stored investor list. */
  investor?: string;
  /** verified = completed raise from 2+ publishers; single_source = completed, one publisher; unconfirmed = talks/reports. */
  verification?: Verification;
  /** City taxonomy id, or "unknown" for stories with no city. */
  city?: string;
  /** Sector taxonomy id. */
  sector?: string;
  sort?: "recent" | "amount";
  /** One story by id. */
  id?: number;
  limit?: number;
  offset?: number;
}

/** Distinct publishers (other than the stored one) that carry the same story. */
const OTHER_OUTLETS = "(SELECT count(DISTINCT lower(e->>'publisher')) FROM jsonb_array_elements(a.also_reported) e WHERE lower(e->>'publisher') <> lower(a.publisher))";
const VERIFICATION_WHERE: Record<Verification, string> = {
  verified: `a.announcement_kind = 'confirmed' AND ${OTHER_OUTLETS} >= 1`,
  single_source: `a.announcement_kind = 'confirmed' AND ${OTHER_OUTLETS} = 0`,
  unconfirmed: "a.announcement_kind <> 'confirmed'",
};

export interface Facets { cities: { id: string; count: number }[]; sectors: { id: string; count: number }[] }

export async function listArticles(f: ListFilters): Promise<{ articles: Article[]; total: number; publishers: string[]; rounds: string[]; investors: string[]; facets: Facets; last_checked_at: string | null }> {
  const where: string[] = [];
  const p: unknown[] = [];
  if (f.id) {
    p.push(f.id);
    where.push(`a.id = $${p.length}`);
  }
  if (f.publisher) {
    p.push(f.publisher);
    where.push(`a.publisher = $${p.length}`);
  }
  if (f.kind === "confirmed") where.push("a.announcement_kind = 'confirmed'");
  if (f.verification && VERIFICATION_WHERE[f.verification]) where.push(VERIFICATION_WHERE[f.verification]);
  if (f.city) {
    if (f.city === "unknown") where.push("a.city IS NULL");
    else { p.push(f.city); where.push(`a.city = $${p.length}`); }
  }
  if (f.sector) {
    p.push(f.sector);
    where.push(`a.sector = $${p.length}`);
  }
  if (f.days) {
    // Articles with no publication date can't be shown to be inside a date window, so they are excluded from it.
    p.push(f.days);
    where.push(`a.published_at >= now() - make_interval(days => $${p.length}::int)`);
  }
  if (f.round) {
    p.push(f.round);
    where.push(`lower(a.funding_round) = lower($${p.length})`);
  }
  if (f.investor) {
    p.push(f.investor);
    where.push(`EXISTS (SELECT 1 FROM unnest(a.investors) inv WHERE lower(inv) = lower($${p.length}))`);
  }
  if (f.hiring) where.push("a.startup_id IN (SELECT startup_id FROM jobs WHERE is_active AND startup_id IS NOT NULL)");
  if (f.q) {
    p.push(`%${f.q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(a.headline ILIKE $${p.length} OR a.company_name ILIKE $${p.length})`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(f.limit ?? 20, 1), 50);
  type Row = Omit<Article, "freshness" | "links" | "listed_roles" | "verification" | "outlets"> & { c_website: string | null; c_careers: string | null; c_linkedin: string | null; c_source: string | null; c_seen: string[] | null; roles: string | null };
  const rows = await query<Row>(
    `SELECT a.id, a.url, a.headline, a.publisher, a.summary, a.published_at, a.company_name, a.startup_id, a.funding_amount, a.funding_currency,
            a.funding_round, a.investors, a.announcement_kind, a.also_reported, a.provider, a.first_ingested_at, a.last_checked_at, a.date_source,
            a.city, a.city_source, a.sector, a.sector_source, a.verification_status,
            s.website AS c_website, s.careers_url AS c_careers, s.linkedin_url AS c_linkedin, s.source AS c_source, s.sources_seen AS c_seen,
            (SELECT count(*) FROM jobs j WHERE j.startup_id = s.id AND j.is_active) AS roles
     FROM funding_articles a LEFT JOIN startups s ON s.id = a.startup_id ${w}
     ORDER BY ${f.sort === "amount" ? "a.amount_value DESC NULLS LAST, " : ""}a.published_at DESC NULLS LAST, a.first_ingested_at DESC
     LIMIT ${limit} OFFSET ${Math.max(f.offset ?? 0, 0)}`,
    p
  );
  const enrichedMap = await linksFor(rows.map((r) => r.company_name ?? "")).catch(() => new Map<string, EnrichedLinks>());
  const [meta] = await query<{ total: string }>(`SELECT count(*) AS total FROM funding_articles a ${w}`, p);
  const [{ last }] = await query<{ last: string | null }>("SELECT max(last_checked_at) AS last FROM funding_articles");
  const pubs = await query<{ publisher: string }>("SELECT DISTINCT publisher FROM funding_articles ORDER BY 1");
  const invs = await query<{ i: string }>("SELECT inv i FROM funding_articles, unnest(investors) inv GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 15");
  const rnds = await query<{ r: string }>("SELECT funding_round r FROM funding_articles WHERE funding_round IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 12");
  const cityF = await query<{ id: string; n: string }>("SELECT city id, count(*) n FROM funding_articles WHERE city IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1");
  const sectorF = await query<{ id: string; n: string }>("SELECT sector id, count(*) n FROM funding_articles WHERE sector IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1");
  return {
    articles: rows.map(({ c_website, c_careers, c_linkedin, c_source, c_seen, roles, ...r }) => {
      const outlets = outletsOf(r.publisher, r.also_reported);
      const { verification_status, ...rest } = r as typeof r & { verification_status?: string | null };
      return {
        ...rest,
        official: verification_status === "official",
        ...(r.company_name && enrichedMap.get(companyKey(r.company_name)) ? { enriched: enrichedMap.get(companyKey(r.company_name)) } : {}),
        outlets,
        verification: verificationOf(r.announcement_kind, outlets),
        freshness: freshnessOf(r.published_at),
        links: r.startup_id ? resolveCompanyLinks({ website: c_website, careers_url: c_careers, linkedin_url: c_linkedin, source: c_source ?? "", sources_seen: c_seen }) : {},
        listed_roles: Number(roles ?? 0),
      };
    }),
    total: Number(meta.total),
    publishers: pubs.map((x) => x.publisher),
    rounds: rnds.map((x) => x.r),
    investors: invs.map((x) => x.i),
    facets: { cities: cityF.map((x) => ({ id: x.id, count: Number(x.n) })), sectors: sectorF.map((x) => ({ id: x.id, count: Number(x.n) })) },
    last_checked_at: last ? new Date(last).toISOString() : null,
  };
}
