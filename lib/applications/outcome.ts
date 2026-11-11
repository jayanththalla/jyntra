// User-recorded outcomes. Pure validation + the status each outcome implies (only when the user picks it).
export const OUTCOMES = ["replied", "no_response", "interview_scheduled", "rejected", "offer", "accepted", "declined", "withdrawn"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  replied: "They replied",
  no_response: "No response",
  interview_scheduled: "Interview scheduled",
  rejected: "Rejected",
  offer: "Offer received",
  accepted: "Offer accepted",
  declined: "I declined",
  withdrawn: "I withdrew",
};

/** Pipeline status that follows an outcome the user recorded. null = leave the status alone. */
export const STATUS_FOR_OUTCOME: Record<Outcome, string | null> = {
  replied: null,
  no_response: null,
  interview_scheduled: "Interview",
  rejected: "Rejected",
  offer: "Offer",
  accepted: "Offer",
  declined: "Not Interested",
  withdrawn: "Not Interested",
};

export function parseOutcome(v: unknown): { ok: true; value: Outcome | null } | { ok: false } {
  if (v === null || v === "") return { ok: true, value: null };
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v) ? { ok: true, value: v as Outcome } : { ok: false };
}
