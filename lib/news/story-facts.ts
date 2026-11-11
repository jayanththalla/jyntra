// What we KNOW about a story, as plain lines with the basis for each. Pure and client-safe: the story card shows this
// instantly, with no model involved. The AI analysis (analysis.ts) is a separate, labelled layer on top.
import { CITY_BY_ID, SECTOR_BY_ID, VERIFICATION_HELP, type Verification } from "./taxonomy";

export interface FactInput {
  headline: string;
  publisher: string;
  published_at: string | null;
  company_name: string | null;
  funding_amount: string | null;
  funding_round: string | null;
  investors: string[];
  announcement_kind: "confirmed" | "planned" | "rumored";
  also_reported: { publisher: string }[];
  verification: Verification;
  outlets: number;
  city: string | null;
  city_source: string | null;
  sector: string | null;
  sector_source: string | null;
  listed_roles: number;
}

export interface FactLine { label: string; value: string; basis: string }
export interface StoryFacts { lines: FactLine[]; gaps: string[]; verification_note: string }

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function storyFacts(a: FactInput): StoryFacts {
  const lines: FactLine[] = [];
  const gaps: string[] = [];
  const outlets = [...new Set([a.publisher, ...a.also_reported.map((r) => r.publisher)])];
  const fromHeadline = "Read from the headline";

  if (a.company_name) lines.push({ label: "Company", value: a.company_name, basis: fromHeadline });
  if (a.funding_amount) lines.push({ label: "Amount", value: a.funding_amount, basis: `${fromHeadline}, as the publisher wrote it` });
  else gaps.push("No amount is stated in the headline.");
  if (a.funding_round) lines.push({ label: "Round", value: a.funding_round, basis: fromHeadline });
  if (a.investors.length) lines.push({ label: "Investors named", value: a.investors.slice(0, 6).join(", "), basis: "Named in the story" });
  else gaps.push("No investors are named.");
  lines.push({ label: "Reported by", value: outlets.join(", "), basis: `${outlets.length} publisher${outlets.length === 1 ? "" : "s"}` });
  if (a.published_at) lines.push({ label: "Published", value: day(a.published_at), basis: "The publisher's date" });
  else gaps.push("The publisher gave no date, so we cannot say how recent this is.");
  const city = a.city ? CITY_BY_ID.get(a.city)?.label : null;
  if (city) lines.push({ label: "City", value: city, basis: a.city_source === "company_record" ? "From the company record" : "The story ties it to the company" });
  else gaps.push("The company's city is not stated.");
  const sector = a.sector ? SECTOR_BY_ID.get(a.sector)?.label : null;
  if (sector) lines.push({ label: "Sector", value: sector, basis: a.sector_source === "ai" ? "Classified by an AI model from the headline" : "Matched from words in the story" });
  lines.push({ label: "Open roles we list", value: String(a.listed_roles), basis: "Counted from job boards, separate from this story" });

  if (a.announcement_kind === "planned") gaps.push("This is a plan or talks, not a closed round.");
  if (a.announcement_kind === "rumored") gaps.push("The publisher marks this as unconfirmed.");
  if (a.verification === "single_source") gaps.push("Only one publisher carries it so far.");
  gaps.push("A funding story is not proof that the company is hiring.");
  return { lines, gaps, verification_note: VERIFICATION_HELP[a.verification] };
}
