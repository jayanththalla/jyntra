// City / remote classification of ONE job from its OWN location text. A company's office city is never used here.
//
// Matching is word-boundary based and context-aware, never a loose substring test:
//  - unambiguous names (Bengaluru, Hyderabad, Chennai) match on their own;
//  - neighbourhood names (Gachibowli, OMR, Financial District …) only count when the same location label carries an
//    India signal, because several of them exist elsewhere (Financial District, NYC; Madras, Oregon);
//  - "MAA" (the airport code) only counts as an exact upper-case label or with an India signal, never inside a word;
//  - Hyderabad, Sindh (Pakistan) and "Indianapolis, IN" are excluded.
import type { CityClass, TrackedCity, WorkplaceType } from "./types";

export const CLASSIFIER_VERSION = 2; // bump when matching rules change: it is part of the content hash so stored rows are re-classified

const BLR = /\b(bengaluru|bangalore|bengalooru|bengalore|bangaluru|blr)\b/i;
const BLR_LOCALITY = /\b(whitefield|koramangala|indiranagar|hsr layout|electronic city|marathahalli|bellandur|sarjapur|mahadevapura|yelahanka|hebbal|jayanagar|jp nagar|domlur|manyata)\b/i;
const HYD = /\b(hyderabad|secunderabad|cyberabad|hyd)\b/i;
const HYD_LOCALITY = /\b(gachibowli|hitec city|hi-tec city|hitech city|hi-tech city|madhapur|kondapur|nanakramguda|kokapet|manikonda|raidurg|financial district)\b/i;
const CHN = /\b(chennai)\b/i;
const CHN_MADRAS = /\bmadras\b/i; // needs India context (Madras, Oregon exists)
const CHN_AIRPORT = /\bMAA\b/; // case-sensitive on purpose
const CHN_LOCALITY = /\b(omr|old mahabalipuram road|taramani|guindy|perungudi|sholinganallur|siruseri|navalur|thoraipakkam|ambattur|porur|adyar|nungambakkam|ramapuram|tidel park)\b/i;
const INDIA_COUNTRY = /\bindia\b|\(in\)|\bin_|\bind\b|\bkarnataka\b|\btelangana\b|\bmaharashtra\b|\btamil nadu\b|\btamilnadu\b|\bharyana\b|\bkerala\b|\bgujarat\b|\buttar pradesh\b|\bwest bengal\b|\brajasthan\b|\bandhra pradesh\b|\bodisha\b|\bpunjab\b/i;
// Chennai is deliberately NOT here: it is a tracked city.
const OTHER_INDIA_CITY = /\b(mumbai|navi mumbai|thane|pune|pimpri|new delhi|delhi|gurgaon|gurugram|noida|ghaziabad|faridabad|kolkata|ahmedabad|kochi|cochin|jaipur|chandigarh|mohali|coimbatore|indore|lucknow|nagpur|thiruvananthapuram|trivandrum|visakhapatnam|vizag|mysuru|mysore|mangalore|mangaluru|bhubaneswar|vadodara|surat|hubli|hubballi|madurai|tiruchirappalli|trichy)\b/i;
const NOT_INDIA = /\bpakistan\b|\bsindh\b|\bunited states\b|\busa\b|\bu\.s\.\b|\boregon\b/i;
const REMOTE = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b|\bhome[- ]?office\b/i;
const HYBRID = /\bhybrid\b/i;
const ONSITE = /\bon[- ]?site\b|\bin[- ]office\b/i;

/** Splits a source's location string(s) into individual place labels without breaking "City, State, Country". */
export function splitLocations(texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const part of String(t).split(/\s*(?:\/|;|\||·|•|\n|\s\+\s)\s*/)) {
      const p = part.replace(/\s+/g, " ").trim();
      if (!p || p.length > 120) continue;
      const k = p.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  }
  return out;
}

export function workplaceFromText(...texts: (string | null | undefined)[]): WorkplaceType {
  const t = texts.filter(Boolean).join(" ");
  if (HYBRID.test(t)) return "hybrid";
  if (REMOTE.test(t)) return "remote";
  if (ONSITE.test(t)) return "onsite";
  return "unknown";
}

export interface LocationClass {
  cityClass: CityClass;
  remoteIndia: boolean;
  cities: TrackedCity[];
}

export function classifyLocation(locations: string[], workplace: WorkplaceType = "unknown"): LocationClass {
  let blr = false;
  let hyd = false;
  let chn = false;
  let india = false;
  let remoteText = false;
  for (const s of locations) {
    const foreign = NOT_INDIA.test(s);
    const hasIndiaWord = INDIA_COUNTRY.test(s);
    if (REMOTE.test(s)) remoteText = true;
    if (foreign && !hasIndiaWord) continue;
    if (BLR.test(s) || (BLR_LOCALITY.test(s) && hasIndiaWord)) blr = true;
    if (HYD.test(s) || (HYD_LOCALITY.test(s) && hasIndiaWord)) hyd = true;
    if (CHN.test(s) || (CHN_MADRAS.test(s) && hasIndiaWord) || (CHN_LOCALITY.test(s) && hasIndiaWord) || (CHN_AIRPORT.test(s) && (hasIndiaWord || s.trim() === "MAA"))) chn = true;
    if (hasIndiaWord || OTHER_INDIA_CITY.test(s)) india = true;
  }
  const cities: TrackedCity[] = [];
  if (blr) cities.push("bengaluru");
  if (hyd) cities.push("hyderabad");
  if (chn) cities.push("chennai");
  const remote = workplace === "remote" || remoteText;
  const anyIndia = india || cities.length > 0;
  // "Remote" alone says nothing about India: remote eligibility must be stated by the source.
  const remoteIndia = remote && anyIndia;
  let cityClass: CityClass;
  if (cities.length >= 2) cityClass = blr && hyd && !chn ? "both" : "multi";
  else if (blr) cityClass = "bengaluru";
  else if (hyd) cityClass = "hyderabad";
  else if (chn) cityClass = "chennai";
  else if (remoteIndia) cityClass = "india_remote";
  else if (india) cityClass = "other_india";
  else cityClass = "unknown";
  return { cityClass, remoteIndia, cities };
}

/** Cities a stored `city_class` implies (for rows written before the `cities` column existed). */
export function citiesFromClass(c: string | null | undefined): TrackedCity[] {
  switch (c) {
    case "bengaluru": return ["bengaluru"];
    case "hyderabad": return ["hyderabad"];
    case "chennai": return ["chennai"];
    case "both": return ["bengaluru", "hyderabad"];
    default: return [];
  }
}
