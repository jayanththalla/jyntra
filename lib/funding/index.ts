// Funding + startup-age helpers.
import { settings } from "@/config/settings";
import type { FundingStatus } from "@/lib/types";

export function fundingStatus(lastFundingDate: string | Date | null, fundingRound: string | null, now = new Date()): FundingStatus {
  if (!lastFundingDate) {
    // No exact date: only call it "older" when the round itself names an earlier year (e.g. "YC Winter 2021").
    const y = fundingRound?.match(/\b(20\d{2})\b/);
    return y && parseInt(y[1], 10) < now.getFullYear() ? "older" : "unknown";
  }
  const d = new Date(lastFundingDate);
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  const [a, b, c] = settings.fundingBuckets;
  if (days <= a) return "funded_30";
  if (days <= b) return "funded_90";
  if (days <= c) return "funded_180";
  return "older";
}

export const FUNDING_LABELS: Record<FundingStatus, string> = {
  funded_30: "Funded <30 days",
  funded_90: "Funded <90 days",
  funded_180: "Funded <180 days",
  older: "Older funding",
  unknown: "Unknown",
};

export function isNewStartup(foundedYear: number | null): boolean | null {
  return foundedYear == null ? null : foundedYear >= settings.newStartupFoundedYear;
}

export function ageBucket(foundedYear: number | null, now = new Date()): "new" | "early" | "growing" | "established" | "unknown" {
  if (foundedYear == null) return "unknown";
  if (foundedYear >= settings.newStartupFoundedYear) return "new";
  if (foundedYear >= settings.newStartupFoundedYear - settings.earlyStageYears) return "early";
  if (foundedYear >= now.getFullYear() - settings.growingYears) return "growing";
  return "established";
}

/** Demo Day month of each YC batch: when YC's investment becomes public. */
const YC_DEMO_DAY_MONTH: Record<string, number> = { winter: 3, spring: 6, summer: 9, fall: 12 };

/**
 * "Y Combinator Spring 2026" → "2026-06-01" (approximate Demo Day). Used as the funding date when a YC
 * company has no dated funding news, so recent batches count as recently funded.
 */
export function ycBatchFundingDate(round: string | null | undefined): string | null {
  const m = round?.match(/Y\s?Combinator\s+(Winter|Spring|Summer|Fall)\s+(20\d{2})/i);
  if (!m) return null;
  const month = YC_DEMO_DAY_MONTH[m[1].toLowerCase()];
  return `${m[2]}-${String(month).padStart(2, "0")}-01`;
}

/** "Y Combinator Summer 2026" → "Summer 2026"; null if the round isn't a YC batch. */
export function ycBatchName(round: string | null | undefined): string | null {
  const m = round?.match(/Y\s?Combinator\s+(Winter|Spring|Summer|Fall)\s+(20\d{2})/i);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` : null;
}

/**
 * YC batches the app covers: every batch of the current year (Winter → Fall), plus any batch whose
 * Demo Day falls within settings.addFundedWithinDays (so last year's Fall batch still counts in January).
 */
export function isRecentYcBatch(round: string | null | undefined, now = new Date()): boolean {
  const date = ycBatchFundingDate(round);
  if (!date) return false;
  if (Number(date.slice(0, 4)) === now.getFullYear()) return true;
  return (now.getTime() - new Date(date).getTime()) / 86_400_000 <= settings.addFundedWithinDays;
}

/** YC batch ("Winter 2021", "Fall 2025") → year. YC invests at the batch, so the year is a verified funding fact. */
export function ycBatchYear(batch: string | null | undefined): number | null {
  const m = batch?.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

// ---------- amounts, stages and announcement types ----------

export type Currency = "INR" | "USD" | "EUR" | "GBP";

export interface ParsedAmount {
  /** In whole units of `currency` (₹100 Cr → 1_000_000_000). */
  value: number;
  currency: Currency | null;
}

const UNIT: [RegExp, number][] = [
  [/^(cr|crore|crores|crs)$/, 1e7],
  [/^(lakh|lakhs|lac|lacs)$/, 1e5],
  [/^(bn|billion|b)$/, 1e9],
  [/^(mn|million|m|mln)$/, 1e6],
  [/^(k|thousand)$/, 1e3],
];

/** "₹100 Cr", "$42M", "Rs 90 crore", "USD 1.2 billion", "€3 Mn" → value + currency. Null if unreadable. */
export function parseAmount(text: string | null | undefined): ParsedAmount | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, "").trim();
  // "$50-60 Mn" / "Rs 40 to 50 Cr": a range is stored as its midpoint, with the unit that follows the second number.
  const range = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/);
  const num = range ?? t.match(/(\d+(?:\.\d+)?)/);
  if (!num) return null;
  let value = range ? (parseFloat(range[1]) + parseFloat(range[2])) / 2 : parseFloat(num[1]);
  const unit = t.slice((num.index ?? 0) + num[0].length).trim().match(/^[a-z]+/)?.[0] ?? "";
  const mult = UNIT.find(([re]) => re.test(unit))?.[1] ?? 1;
  value *= mult;
  let currency: Currency | null = null;
  if (/₹|\brs\.?|\binr\b|rupees?|\bcr(ore)?s?\b|\blakhs?\b/.test(t)) currency = "INR";
  else if (/\$|\busd\b|dollars?/.test(t)) currency = "USD";
  else if (/€|\beur\b|euros?/.test(t)) currency = "EUR";
  else if (/£|\bgbp\b|pounds?/.test(t)) currency = "GBP";
  if (!isFinite(value) || value <= 0) return null;
  return { value, currency };
}

/** Converts to USD with rates expressed as "1 USD = rate[currency]". Null when the rate is unknown. */
export function toUsd(amount: ParsedAmount | null, rates: Partial<Record<Currency, number>> | null): number | null {
  if (!amount?.currency) return null;
  if (amount.currency === "USD") return Math.round(amount.value);
  const rate = rates?.[amount.currency];
  return rate ? Math.round(amount.value / rate) : null;
}

export type FundingStage = "pre_seed" | "seed" | "series_a" | "series_b_plus" | "accelerator" | "debt" | "other";

export const STAGE_LABELS: Record<FundingStage, string> = {
  pre_seed: "Pre-seed",
  seed: "Seed",
  series_a: "Series A",
  series_b_plus: "Series B and later",
  accelerator: "Accelerator",
  debt: "Debt",
  other: "Other",
};

/** Normalised stage from a round label. Null when the round isn't stated. */
export function fundingStage(round: string | null | undefined): FundingStage | null {
  if (!round) return null;
  const r = round.toLowerCase();
  if (/y\s?combinator|accelerator|techstars|antler/.test(r)) return "accelerator";
  if (/pre-?seed/.test(r)) return "pre_seed";
  if (/pre-?series a/.test(r)) return "seed";
  if (/\bseed\b|\bangel\b/.test(r)) return "seed";
  if (/series a\b/.test(r)) return "series_a";
  if (/series [b-z]|pre-?series [b-z]|growth|late[- ]stage|pre-?ipo/.test(r)) return "series_b_plus";
  if (/debt|venture debt/.test(r)) return "debt";
  return "other";
}

export type AnnouncementKind = "confirmed" | "planned" | "rumored";

export const KIND_LABELS: Record<AnnouncementKind, string> = {
  confirmed: "Confirmed announcement",
  planned: "Planned / in progress",
  rumored: "Reported, unconfirmed",
};

const PLANNED = /\b(in talks to raise|looking to raise|plans? to raise|planning to raise|set to raise|to raise|eyes|seeks?|seeking|in advanced talks|in early talks|aims? to raise|mulls?)\b/i;
const RUMORED = /\b(reportedly|sources say|according to sources|people familiar|is said to|said to be|report says|rumou?red)\b/i;

/** Whether a headline/summary reports a completed raise, a planned one, or an unconfirmed report. */
export function announcementKind(title: string, summary = ""): AnnouncementKind {
  if (RUMORED.test(title) || RUMORED.test(summary.slice(0, 200))) return "rumored";
  if (PLANNED.test(title)) return "planned";
  return "confirmed";
}

// ---------- combining reports from several outlets ----------

export interface FundingReport {
  source: string; // outlet, e.g. "Inc42", "YC directory"
  url: string;
  date: string | null; // article publish date (≈ announcement date)
  amount: string | null; // verbatim
  round: string | null;
  investors: string[];
  kind: AnnouncementKind;
  currency: Currency | null;
  amount_value: number | null;
  amount_usd: number | null;
}

export interface ConsolidatedFunding {
  primary: FundingReport | null;
  /** Earliest confirmed report of the same round: the original announcement date. */
  announcement_date: string | null;
  /** A second, independent outlet confirming the same round. */
  verification_url: string | null;
  conflicts: string[];
}

const KIND_RANK: Record<AnnouncementKind, number> = { confirmed: 2, planned: 1, rumored: 0 };

function effectiveDate(r: FundingReport): string {
  return r.date ?? ycBatchFundingDate(r.round) ?? "";
}

function sameRound(a: FundingReport, b: FundingReport): boolean {
  const sa = fundingStage(a.round);
  const sb = fundingStage(b.round);
  if (sa && sb && sa !== sb) return false;
  if (a.amount_usd && b.amount_usd) return Math.abs(a.amount_usd - b.amount_usd) / Math.max(a.amount_usd, b.amount_usd) <= 0.15;
  const near = !a.date || !b.date || Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) <= 45 * 86_400_000;
  return near && (!!sa && sa === sb);
}

const fmtUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);

/**
 * Picks the main funding round from every report seen: confirmed beats planned/rumored, then the newest.
 * Also finds the original announcement date, an independent confirming source, and conflicts
 * (same round reported with a different amount, stage or date).
 */
export function consolidateFunding(reports: FundingReport[]): ConsolidatedFunding {
  if (!reports.length) return { primary: null, announcement_date: null, verification_url: null, conflicts: [] };
  const sorted = [...reports].sort(
    (a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || effectiveDate(b).localeCompare(effectiveDate(a))
  );
  const primary = sorted[0];
  const same = reports.filter((r) => r !== primary && r.kind === "confirmed" && sameRound(primary, r));
  const dates = [primary, ...same].map((r) => r.date).filter((d): d is string => !!d).sort();
  const verification = same.find((r) => r.source !== primary.source && r.url !== primary.url) ?? null;

  const conflicts: string[] = [];
  if (primary.kind === "confirmed") {
    // Other confirmed reports within 45 days that disagree on the facts.
    for (const r of reports) {
      if (r === primary || r.kind !== "confirmed" || !r.date || !primary.date) continue;
      if (Math.abs(new Date(r.date).getTime() - new Date(primary.date).getTime()) > 45 * 86_400_000) continue;
      if (r.amount_usd && primary.amount_usd && Math.abs(r.amount_usd - primary.amount_usd) / Math.max(r.amount_usd, primary.amount_usd) > 0.15)
        conflicts.push(`Amount: ${r.source} reports ${r.amount ?? fmtUsd(r.amount_usd)}, ${primary.source} reports ${primary.amount ?? fmtUsd(primary.amount_usd)}`);
      const sr = fundingStage(r.round);
      const sp = fundingStage(primary.round);
      if (sr && sp && sr !== sp && sr !== "other" && sp !== "other")
        conflicts.push(`Round: ${r.source} says ${r.round}, ${primary.source} says ${primary.round}`);
    }
  }
  return {
    primary,
    announcement_date: dates[0] ?? primary.date,
    verification_url: verification?.url ?? null,
    conflicts: [...new Set(conflicts)],
  };
}

// ---------- funding headline parsing (deterministic) ----------

const VERB = /\b(raises?|raised|secures?|secured|bags?|bagged|nets?|netted|gets?|lands?|closes?|closed|announces?|announced|completes?|completed|picks up|mops up|announces?|announced|completes?|completed|receives?|scoops? up|garners?|attracts?|pockets?|pulls in|in talks to raise|looking to raise|plans? to raise|set to raise|to raise|eyes)\b/i;
const AMOUNT =
  /((?:₹|rs\.?|inr|\$|usd|us\$|€|£)\s?[\d.,]+\s?(?:-|–|to)\s?[\d.,]+\s?(?:cr(?:ore)?s?|lakh|lakhs|mn|million|m|bn|billion|k)|(?:₹|rs\.?|inr|\$|usd|us\$|€|£)\s?[\d.,]+\s?(?:cr(?:ore)?s?|lakh|lakhs|mn|million|m|bn|billion|k)?|[\d.,]+\s?(?:cr(?:ore)?s?|lakh|mn|million|bn|billion)\b(?:\s?(?:usd|inr|dollars|rupees))?)/i;
const ROUND = /\b(pre-?seed|seed|pre-?series [a-f]|series [a-f]\d?|angel|bridge|growth|debt|venture debt|pre-?ipo)\b/i;

/** An IPO as the NEWS ("IPO opens", "files for IPO", "market debut"), as opposed to a private raise that merely mentions one ("ahead of IPO", "pre-IPO round"). */
export const IPO_EVENT = /\bipo[- ]?(opens?|subscri\w*|price|prices|listing|allot\w*|gmp|date|day|bound listing|to raise|launch\w*|files?|filing|anchor)\b|\b(files?|filed|filing) (for |its )?(an? )?ipo\b|\bipo (issue|offer)\b|\bmarket debut\b|\banchor (investors?|book)\b/i;

/** Words that describe a company instead of naming it ("Foodtech major Rebel Foods", "AI startup Lyzr"). Stripped from the front only. */
const SECTOR = /^(fintech|edtech|healthtech|foodtech|agritech|agtech|proptech|insurtech|cleantech|climatetech|deeptech|spacetech|legaltech|hrtech|martech|regtech|biotech|medtech|traveltech|mobility|ai|genai|d2c|b2b|b2c|saas|ev|iot|crypto|web3|logistics|quick-commerce|e-commerce|ecommerce|major|giant|leader|pioneer|unicorn|soonicorn|decacorn|lender|neobank|aggregator|upstart|conglomerate|retailer|chain|startup|startups|platform|company|firm|maker|provider|player|brand|app|marketplace|venture)$/i;
function cleanCompany(raw: string): string {
  let c = raw.trim().replace(/^.*?:\s*/, "").replace(/^[\w\s-]*-based\s+/i, "").replace(/^.*?-backed\s+/i, "").replace(/^[\w\s.&]+?\s+parent\s+/i, "")
    .replace(/^[A-Z][\w.&]*(?:\s+[A-Z][\w.&]*)?['’]s\s+(?=[A-Z])/, "").replace(/['’]s$/, "");
  const words = c.split(/\s+/);
  while (words.length > 1 && SECTOR.test(words[0])) words.shift();
  return words.join(" ").trim();
}

export interface ParsedFunding {
  company: string;
  amount: string | null;
  round: string | null;
  investors: string[];
  /** Where the *company* is based, only from text describing the company itself. */
  locationHint: string | null;
  kind: AnnouncementKind;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns null unless the headline explicitly says a company raised money. */
const INVESTOR_VERB = /^(.{2,70}?)\s+(leads?|led|invests?|backs?|bets|infuses|pumps|funds|co-leads)\b(.*)$/i;
const SMALL_ROUND_WORD = /(fund|round|series|seed|investment|capital|cr\b|crore|mn|million|\$|₹)/i;

/** "Accel leads $20 Mn Series A in AI startup Lyzr", "Peak XV backs Chennai-based Kovai.co with $10 Mn": the investor is the subject. */
function parseInvestorFirst(t: string, summary: string): ParsedFunding | null {
  const m = t.match(INVESTOR_VERB);
  if (!m) return null;
  const rest = m[3];
  const amount = rest.match(AMOUNT)?.[1]?.trim() ?? null;
  if (!amount || !SMALL_ROUND_WORD.test(rest)) return null;
  const parsed = parseAmount(amount);
  if (parsed && parsed.value < (parsed.currency === "INR" ? 1e5 : 1e4)) return null;
  // The company is what follows "in/into" (after the amount), or what sits between the verb and the amount ("backs X with $10 Mn").
  let seg = "";
  const idx = rest.indexOf(amount) + amount.length;
  const tail = rest.slice(idx);
  const inM = tail.match(/\s(?:in|into)\s+(.+)$/i);
  if (inM) seg = inM[1];
  else {
    const before = rest.slice(0, rest.indexOf(amount)).trim();
    if (before) seg = before;
    else { const w = tail.match(/^\s*(?:with|for)\b/i); if (!w) seg = ""; }
  }
  seg = seg.replace(/\s+(?:with|for|as|at|from|to)(?:\s+.*)?$/i, "").replace(/[.,;:!?]+$/, "");
  const locM = seg.match(/\b([A-Z][a-zA-Z]+(?:[- ][A-Z][a-zA-Z]+)?)-based\b/);
  const company = cleanCompany(seg.replace(/^(?:an?|the)\s+/i, ""));
  if (IPO_EVENT.test(t) || NOT_COMPANY.test(company) || !company || company.split(" ").length > 4 || !/^[A-Z0-9]/.test(company)) return null;
  const round = (t + " " + summary).match(ROUND)?.[1];
  const investors = m[1].split(/,|\band\b|&/).map((x) => x.trim()).filter((x) => x && x.length < 60 && /^[A-Z]/.test(x)).slice(0, 6);
  return { company, amount, round: round ? round.replace(/\b\w/g, (c) => c.toUpperCase()) : null, investors, locationHint: locM?.[1] ?? null, kind: announcementKind(t, summary) };
}
const NOT_COMPANY = /^(how|why|what|this|these|startups?|indian|top|weekly|two|three|four|five|ex-|former|your|our|my|last|final)\b|\b(alumni|team|founders?|engineers|execs?|veterans?|researchers)\b/i;

export function parseFundingHeadline(title: string, summary = ""): ParsedFunding | null {
  const t = title.replace(/\s+/g, " ").trim();
  const v = t.match(VERB);
  if (!v || v.index === undefined) return parseInvestorFirst(t, summary);
  const after = t.slice(v.index + v[0].length);
  const amount = after.match(AMOUNT)?.[1]?.trim() ?? null;
  const roundIn = (after + " " + summary).match(ROUND)?.[1] ?? null;
  if (!amount && !roundIn) return null; // "X raises the bar" etc.
  if (!/fund|round|series|seed|investment|capital|cr\b|crore|mn|million|\$|₹/i.test(after)) return null;

  let company = t.slice(0, v.index).trim();
  // Strip descriptors: "Pune-based AI startup Foo" → "Foo"; "Funding: Foo" → "Foo"
  company = company.replace(/^.*?:\s*/, "");
  const prefix = company;
  const locMatch = prefix.match(/\b([A-Z][a-zA-Z]+(?:[- ][A-Z][a-zA-Z]+)?)-based\b/);
  const nationality = prefix.match(/\b(Indian|India's|US|U\.S\.|American)\b/)?.[1] ?? null;
  // "a16z-backed EliseAI" / "Toothsi parent MakeO" / "Hero Electronix’s Tessolve" / "Foodtech major Rebel Foods" → the company
  company = cleanCompany(company.replace(/^.*\b(startup|platform|company|firm|maker|provider|unicorn|player|brand|app|marketplace|fintech|edtech|healthtech|saas|venture)\s+(?=[A-Z0-9])/i, ""));
  // IPO events, listed-company money and event promos ("secure up to $100 ticket savings") aren't startup rounds.
  if (IPO_EVENT.test(t) || /listing|ticket|savings|discount/i.test(t)) return null;
  const parsedAmount = parseAmount(amount);
  if (parsedAmount && parsedAmount.value < (parsedAmount.currency === "INR" ? 1e5 : 1e4)) return null;
  if (
    !company ||
    company.split(" ").length > 4 ||
    /^(how|why|what|this|these|startups?|indian|top|weekly|two|three|four|five|ex-|former|your|our|my|last|final)\b/i.test(company) ||
    /\b(alumni|team|founders?|engineers|execs?|veterans?|researchers)\b/i.test(company) ||
    !/^[A-Z0-9]/.test(company)
  )
    return null; // a description of people, not a verifiable company name

  const investors: string[] = [];
  // Headline first, then the summary on its own: joining them would let a headline that ends without a full stop run on into the summary's first sentence.
  const LED = /\b(?:led by|from|backed by|participation (?:of|from))\s+([^.;]+)/i;
  const led = after.match(LED) ?? summary.match(LED);
  if (led) {
    for (const part of led[1].split(/,|\band\b|\bothers\b/)) {
      const name = part.replace(/\b(existing investors?|others?|among|with|participation.*)$/i, "").trim();
      if (name && name.length < 60 && /[A-Z]/.test(name[0]) && !/^(Series|Seed|its|the round)/i.test(name)) investors.push(name);
    }
  }
  // In the summary, "-based" counts only when it directly describes this company
  // ("Bengaluru-based fintech startup Foo"), not an investor ("Mumbai-based VC firm Bar").
  const summaryLoc = summary.match(
    new RegExp(`\\b([A-Z][a-zA-Z]+(?:[- ][A-Z][a-zA-Z]+)?)-based\\s+(?:[\\w-]+\\s+){0,5}?${escapeRe(company)}\\b`)
  )?.[1];
  const locationHint =
    locMatch?.[1] ?? (nationality ? (/indian|india/i.test(nationality) ? "India" : "United States") : null) ?? summaryLoc ?? null;
  return {
    company,
    amount,
    round: roundIn ? roundIn.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    investors: investors.slice(0, 6),
    locationHint,
    kind: announcementKind(t, summary),
  };
}
