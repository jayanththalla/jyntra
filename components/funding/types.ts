import type { FactInput } from "@/lib/news/story-facts";

export interface CLink { url: string; status: "verified" | "unverified"; basis: string }

/** One story as /api/news returns it. */
export interface Article extends FactInput {
  id: number;
  url: string;
  summary: string | null;
  startup_id: number | null;
  freshness: "fresh" | "recent" | "older" | "undated";
  last_checked_at: string;
  links: { website?: CLink; careers?: CLink; linkedin?: CLink };
  also_reported: { publisher: string; url: string }[];
}

export interface NewsResponse {
  state: "ok" | "empty" | "unavailable";
  articles: Article[];
  total: number;
  page: number;
  limit: number;
  publishers: string[];
  rounds?: string[];
  investors?: string[];
  facets?: { cities: { id: string; count: number }[]; sectors: { id: string; count: number }[] };
  last_checked_at: string | null;
  refreshing: boolean;
  message?: string;
  source_notes?: { id: string; message: string }[];
  serving_cache?: boolean;
  directory?: { name: string; url: string }[];
}

export interface AnalysisResponse {
  article_id: number;
  status: "ok" | "not_configured" | "failed";
  message?: string;
  analysis?: { summary: string; why_it_matters: string; check_next: string[]; provider: string; generated_at: string; cached: boolean };
}

export type VerificationFilter = "verified" | "confirmed" | "all";

export interface Filters {
  verification: VerificationFilter;
  city: string;
  sector: string;
  publisher: string;
  range: string;
  round: string;
  investor: string;
  hiring: boolean;
  sort: string;
}

export const DEFAULT_FILTERS: Filters = { verification: "confirmed", city: "all", sector: "all", publisher: "all", range: "any", round: "all", investor: "all", hiring: false, sort: "recent" };

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null);
