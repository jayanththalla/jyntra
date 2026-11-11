// Client-side shapes of the /api/kb responses (see app/api/kb/** and lib/kb/answer.ts).
export interface KbSource {
  id: number;
  provider: string;
  label: string;
  status: "pending" | "connected" | "syncing" | "error" | "disconnected" | "revoked";
  last_synced_at: string | null;
  last_error: string | null;
  last_stats: Record<string, any>;
  doc_count?: number;
  has_credentials: boolean;
  config: Record<string, any>;
}
export interface ProviderInfo { provider: string; label: string; auth: string; description: string }
export interface Capabilities { github_oauth: boolean; github_token: boolean; ai: boolean }
export interface CitationSource { id: number; label: string; state: "fresh" | "stale" | "syncing" | "failed" | "never" | "manual"; lastSyncedAt: string | null }
export interface Citation { id: string; title: string; url: string | null; locator: string | null; provider: string; docType: string; documentId: number | null; snippet: string; source?: CitationSource }
export interface Analysis { required: string[]; matched: { skill: string; level: string }[]; gaps: string[]; weak: string[] }
export interface Answer {
  answer: string;
  questionType: string;
  citations: Citation[];
  consulted: number;
  grounded: boolean;
  insufficient: boolean;
  flagged: number;
  analysis?: Analysis;
  provider?: string;
  notices: string[];
  sources?: { sourceId: number; label: string; provider: string; state: CitationSource["state"]; lastSyncedAt: string | null }[];
  conversationId?: number;
  messageId?: number;
  actions?: { type: string; label: string; href?: string; needsConfirmation?: boolean }[];
}
export interface Summary {
  sources: KbSource[];
  totals: { sources: number; documents: number; chunks: number; projects: number; skills: number; notes: number };
  last_successful_sync: string | null;
  unhealthy: { id: number; label: string; status: string; error: string | null }[];
  projects: { name: string; level: string; technologies: string[] }[];
  skills: { name: string; level: string }[];
  coding: { name: string; level: string }[];
  recent_notes: { id: number; title: string; kind: string; created_at: string }[];
  recommended_actions: string[];
}
export interface ChatTurn { id: string; question: string; mode: string; result?: Answer; error?: { status: number; message: string }; pending?: boolean }
export const MODE_OPTIONS = [
  ["auto", "Auto"],
  ["project_coach", "Project coach"],
  ["jd_analyzer", "Job description analyzer"],
  ["interview_prep", "Interview prep"],
  ["coding_progress", "Coding progress"],
  ["resume_outreach", "Resume & outreach"],
] as const;
export const LEVEL_INFO: Record<string, { label: string; hint: string }> = {
  demonstrated: { label: "Demonstrated", hint: "Seen in your code, repositories or coding data." },
  self_reported: { label: "Self-reported", hint: "Listed on your profile, not yet backed by a project." },
  inferred: { label: "Inferred", hint: "Suggested by activity such as solved-problem topics. Not proof of proficiency." },
  unverified: { label: "Unverified", hint: "A claim in a document (e.g. a resume) with no supporting evidence found." },
};
/** Friendly message for an /api/kb error status. */
export function kbErrorMessage(status: number, code: string | undefined, fallback: string | null): string {
  const text = `${code ?? ""} ${fallback ?? ""}`;
  if (/^(Groq|Gemini)\b/.test(fallback ?? "")) return fallback!; // names the provider and the env var to check
  if (/rejected|invalid.*key|api key.*(invalid|expired)|provider_rejected|unauthori[sz]ed.*key/i.test(text)) return "The AI service isn't accepting this server's key. The site owner needs to update it — your data is fine.";
  if (status === 503 || code === "not_configured") return "AI answers aren't set up on this server yet. Your knowledge base still works for search.";
  if (status === 429 || /rate.?limit|too many/i.test(text)) return "Too many requests, try again in a minute.";
  if (status === 504 || code === "timeout") return "The AI service took too long to answer. Try again.";
  if (status === 403) return fallback ?? "You don't have access to that source.";
  if (status === 0) return fallback ?? "Can't reach the server. Check your connection.";
  return fallback ?? "Something went wrong. Please try again.";
}
/** "5 min ago", "yesterday", "12 days ago". */
export function relTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
