// Client-safe, deterministic rules for funding stories: verification status, company city and sector.
// Nothing here calls a database or a model. Every value can be traced to words in the story or a company record.

// ---------- verification ----------

/**
 * What we can honestly say about a story:
 *  - verified:      the story reports a completed raise AND at least two different publishers carry it.
 *  - single_source: a completed raise reported by one publisher so far.
 *  - unconfirmed:   "in talks", "plans to raise" or "reportedly" stories: no completed raise is claimed.
 * "Verified" means corroborated by more than one outlet. It is NOT a check against filings or the company.
 */
export type Verification = "verified" | "single_source" | "unconfirmed";

export const VERIFICATION_LABELS: Record<Verification, string> = {
  verified: "Verified",
  single_source: "Single source",
  unconfirmed: "Unconfirmed",
};

export const VERIFICATION_HELP: Record<Verification, string> = {
  verified: "A completed raise reported by two or more different publishers. We have not checked it against filings or the company.",
  single_source: "A completed raise reported by one publisher so far. Treat the figures as that publisher's claim.",
  unconfirmed: "Reported as planned, in talks or unconfirmed. No completed raise is claimed.",
};

/** Distinct publishers carrying this story (the one we stored plus any others that reported the same round). */
export function outletsOf(publisher: string, alsoReported: { publisher: string }[] = []): number {
  const set = new Set([publisher, ...alsoReported.map((r) => r.publisher)].map((p) => p.trim().toLowerCase()).filter(Boolean));
  return set.size;
}

export function verificationOf(kind: "confirmed" | "planned" | "rumored", outlets: number): Verification {
  if (kind !== "confirmed") return "unconfirmed";
  return outlets >= 2 ? "verified" : "single_source";
}

// ---------- city ----------

export interface CityDef { id: string; label: string; aliases: string[] }

/** Delhi NCR is one filter value: Gurugram, Noida and Delhi are the same startup market. */
export const CITIES: CityDef[] = [
  { id: "bengaluru", label: "Bengaluru", aliases: ["bengaluru", "bangalore", "bengalooru", "bangaluru"] },
  { id: "delhi_ncr", label: "Delhi NCR", aliases: ["delhi", "new delhi", "gurugram", "gurgaon", "noida", "greater noida", "ghaziabad", "faridabad", "delhi ncr", "ncr"] },
  { id: "mumbai", label: "Mumbai", aliases: ["mumbai", "navi mumbai", "thane", "bombay"] },
  { id: "hyderabad", label: "Hyderabad", aliases: ["hyderabad", "secunderabad"] },
  { id: "chennai", label: "Chennai", aliases: ["chennai", "madras"] },
  { id: "pune", label: "Pune", aliases: ["pune"] },
  { id: "kolkata", label: "Kolkata", aliases: ["kolkata", "calcutta"] },
  { id: "ahmedabad", label: "Ahmedabad", aliases: ["ahmedabad"] },
  { id: "kochi", label: "Kochi", aliases: ["kochi", "cochin", "thiruvananthapuram", "trivandrum"] },
  { id: "jaipur", label: "Jaipur", aliases: ["jaipur"] },
  { id: "coimbatore", label: "Coimbatore", aliases: ["coimbatore"] },
  { id: "chandigarh", label: "Chandigarh", aliases: ["chandigarh", "mohali"] },
  { id: "indore", label: "Indore", aliases: ["indore"] },
  { id: "san_francisco", label: "San Francisco", aliases: ["san francisco", "sf", "palo alto", "mountain view", "bay area"] },
  { id: "new_york", label: "New York", aliases: ["new york", "nyc", "brooklyn"] },
  { id: "london", label: "London", aliases: ["london"] },
  { id: "singapore", label: "Singapore", aliases: ["singapore"] },
  { id: "dubai", label: "Dubai", aliases: ["dubai", "abu dhabi"] },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CITY_ALIAS: [string, RegExp][] = CITIES.flatMap((c) =>
  c.aliases.map((a): [string, RegExp] => [c.id, new RegExp(`^${esc(a)}$`, "i")])
);
export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

/** Maps one place word ("Gurgaon", "Bengaluru") to a city id. Anything not in the table is null: we never keep unknown words as cities. */
export function cityId(place: string | null | undefined): string | null {
  const p = (place ?? "").replace(/\s+/g, " ").trim();
  if (!p) return null;
  return CITY_ALIAS.find(([, re]) => re.test(p))?.[0] ?? null;
}

const CITY_WORDS = CITIES.flatMap((c) => c.aliases).filter((a) => a !== "sf" && a !== "ncr").sort((a, b) => b.length - a.length).map(esc).join("|");
// "X is a Pune-based ..." / "based in Pune" / "headquartered in Pune" / "HQ in Pune". Must sit next to the company, checked by the caller.
const BASED_IN = new RegExp(`\\b(?:based|headquartered|headquarters|hq(?:'d)?|located)\\s+(?:out of|in|at)\\s+(${CITY_WORDS})\\b`, "i");

/**
 * The company's own city, only from text that ties a city to the company:
 *  1. a "-based" hint the headline parser already tied to the company ("Pune-based Foo raises…"),
 *  2. a summary sentence that names the company and says "based/headquartered in <city>".
 * A city that merely appears in a headline ("…at a Mumbai event", "Mumbai-based VC backs…") is NOT used.
 */
export function cityFromStory(company: string | null, locationHint: string | null, summary: string | null): string | null {
  const hinted = cityId(locationHint);
  if (hinted) return hinted;
  if (!company || !summary) return null;
  for (const sentence of summary.split(/(?<=[.!?])\s+/)) {
    if (!sentence.toLowerCase().includes(company.toLowerCase())) continue;
    const m = sentence.match(BASED_IN);
    if (!m) continue;
    // "Foo, backed by Mumbai-based fund Bar" puts the city on the investor, not the company: require the city to follow the company.
    if (sentence.toLowerCase().indexOf(company.toLowerCase()) > (m.index ?? 0) + 60) continue;
    const id = cityId(m[1]);
    if (id) return id;
  }
  return null;
}

// ---------- sector ----------

export interface SectorDef { id: string; label: string; re: RegExp }

/**
 * Ordered most specific first: the first sector whose words appear wins. "AI-powered lending app" is fintech;
 * AI is the fallback for stories whose only descriptor is AI. Word boundaries everywhere.
 */
export const SECTORS: SectorDef[] = [
  { id: "fintech", label: "Fintech", re: /\b(fintech|lending|lender|neobank|payments?|insurtech|insurance|credit|loans?|wealth|banking|nbfc|upi|remittance|trading app|stock broking|mutual funds?|buy now pay later|bnpl|accounting|invoice|expense management)\b/i },
  { id: "healthtech", label: "Healthtech", re: /\b(health ?tech|healthcare|health care|medtech|diagnostics?|telemedicine|telehealth|pharma(?:cy)?|hospitals?|clinics?|biotech|wellness|mental health|medical|therapeutics|e-?pharmacy)\b/i },
  { id: "edtech", label: "Edtech", re: /\b(ed ?tech|education|learning platform|upskilling|test prep|coaching|tutoring|e-?learning|students?|skilling|school|k-?12)\b/i },
  { id: "climate", label: "Climate and energy", re: /\b(climate|clean ?tech|renewable|solar|battery|batteries|carbon|sustainab\w+|green hydrogen|energy storage|waste|recycling|water tech|ev charging)\b/i },
  { id: "mobility", label: "Mobility and EV", re: /\b(electric vehicles?|ev makers?|evs?|e-?scooters?|mobility|ride-?hailing|ride sharing|two-?wheelers?|cabs?|fleet|autonomous driving|vehicle)\b/i },
  { id: "agri_food", label: "Food and agri", re: /\b(agri ?tech|ag ?tech|agriculture|farmers?|farm|food ?tech|food delivery|restaurants?|cloud kitchens?|beverages?|dairy|grocery|groceries|fmcg|snacks|nutrition)\b/i },
  { id: "logistics", label: "Logistics and supply chain", re: /\b(logistics|supply chain|freight|trucking|warehous\w+|last[- ]mile|shipping|fulfil?lment|cold chain|3pl|courier)\b/i },
  { id: "proptech", label: "Real estate", re: /\b(prop ?tech|real estate|rental|co-?living|co-?working|home loans?|housing|construction tech|brokerage platform)\b/i },
  { id: "commerce", label: "Commerce and D2C", re: /\b(e-?commerce|d2c|direct[- ]to[- ]consumer|quick[- ]commerce|marketplace|retail|fashion|apparel|beauty|jewell?ery|furniture|consumer brand|social commerce|resale)\b/i },
  { id: "consumer", label: "Consumer, media and gaming", re: /\b(gaming|games?|esports|creator economy|creators?|social (?:network|media|app)|streaming|music|entertainment|content platform|dating|fantasy sports|short video|travel ?tech|travel|hospitality)\b/i },
  { id: "deeptech", label: "Deeptech and hardware", re: /\b(deep ?tech|semiconductors?|chips?|robotics?|drones?|space ?tech|satellites?|defen[cs]e|quantum|photonics|hardware|iot|3d printing|aerospace|sensors?|manufacturing)\b/i },
  { id: "saas", label: "SaaS and enterprise", re: /\b(saas|b2b|enterprise software|developer tools?|devtools?|cloud|cybersecurity|security platform|api platform|hr ?tech|hiring platform|recruitment|martech|sales automation|crm|workflow|analytics platform|data platform|low-?code|erp)\b/i },
  { id: "ai", label: "AI and data", re: /\b(ai|a\.i\.|gen ?ai|generative|llms?|machine learning|ml|agentic|ai agents?|computer vision|nlp|copilot)\b/i },
];
export const SECTOR_BY_ID = new Map(SECTORS.map((s) => [s.id, s]));
export const SECTOR_IDS = SECTORS.map((s) => s.id);

/** First matching sector in the headline and the start of the summary. Null when no rule applies (the AI pass may classify it). */
export function sectorFromText(headline: string, summary: string | null): string | null {
  // Investor names often contain sector words ("Climate Collective", "Blume Ventures"), so text after "led by / backed by / from" is ignored.
  const strip = (s: string) => s.replace(/\b(?:led by|backed by|co-led by|participation (?:of|from)|from|with participation)\b.*$/i, "");
  const text = `${strip(headline)}. ${strip((summary ?? "").slice(0, 300))}`;
  return SECTORS.find((s) => s.re.test(text))?.id ?? null;
}

/** A company record's location text ("Bengaluru, Karnataka, India") → city id. The first place named is the headquarters. */
export function cityFromPlaceText(text: string | null | undefined): string | null {
  for (const part of (text ?? "").split(/[,/;|]/)) {
    const id = cityId(part);
    if (id) return id;
  }
  return null;
}
