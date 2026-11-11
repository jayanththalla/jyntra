// Action routing. Reads ONLY what the candidate typed and returns SUGGESTIONS (links and labels). It never runs anything:
// nothing here sends, saves or changes data, and text from documents or from the model is never passed in.
export type ActionType = "application_answers" | "email_draft" | "send_email" | "interview_prep" | "explain_project" | "resume_review" | "job_prep" | "save_answer";
export interface SuggestedAction {
  type: ActionType;
  label: string;
  href?: string;
  /** True when carrying it out would affect something outside the chat (it always needs an explicit click and a final review). */
  needsConfirmation?: boolean;
}

const EMAIL_KIND: [RegExp, string][] = [
  [/thank[- ]?you|thanks (for|after) (the )?interview/i, "thank_you"],
  [/follow[- ]?up|nudge|checking in/i, "follow_up"],
  [/schedul|availability|reschedul|time slot/i, "interview_scheduling"],
  [/reply|respond|response to/i, "recruiter_reply"],
  [/cover letter/i, "cover_letter"],
  [/linkedin|\bdm\b/i, "linkedin_dm"],
  [/founder|ceo|cto|cold/i, "cold_founder"],
  [/recruiter|hiring manager|talent/i, "cold_recruiter"],
  [/appl(y|ication)/i, "job_application"],
];

export function suggestActions(text: string): SuggestedAction[] {
  const t = text.toLowerCase();
  const out: SuggestedAction[] = [];
  const has = (re: RegExp) => re.test(t);
  const questions = (text.match(/\?/g) ?? []).length;

  if ((has(/\b(send|fire off|ship)\b[^.\n]{0,30}\b(email|mail|message|this)\b/) || has(/\b(email|mail|message)\b[^.\n]{0,60}\b(and|then)\s+(send|fire off)\s+(it|this)\b/)) && has(/\b(email|mail|recruiter|founder|hiring)\b/)) {
    // "Send this email" is never executed from chat: the composer shows the final message and asks for confirmation.
    const kind = EMAIL_KIND.find(([re]) => re.test(text))?.[1] ?? "cold_email";
    out.push({ type: "send_email", label: "Draft and review here", href: `/career-ai/email?kind=${kind}`, needsConfirmation: true });
  } else if (has(/\b(write|draft|compose|prepare|reply|respond)\b[^.\n]{0,40}\b(email|mail|cover letter|message|dm|follow[- ]?up|thank[- ]?you|reply)\b/) || has(/\b(cover letter|cold email|follow[- ]?up email|thank[- ]?you (email|note))\b/)) {
    const kind = EMAIL_KIND.find(([re]) => re.test(text))?.[1] ?? "cold_email";
    out.push({ type: "email_draft", label: "Open in the email composer", href: `/career-ai/email?kind=${kind}` });
  }
  if (has(/\b(application|apply|portal|form)\b[^.\n]{0,40}\b(questions?|answers?)\b|\banswer (these|the) (application )?questions\b/) || (questions >= 3 && text.length > 250)) {
    out.push({ type: "application_answers", label: "Answer these in Application mode", href: "/applications?view=answers" });
  }
  if (has(/\bprepare me\b|\bprep(are)? (for|me for) (this|the) (job|role|interview)\b|\binterview prep\b|\bprepare interview questions\b/)) {
    out.push({ type: has(/interview/) ? "interview_prep" : "job_prep", label: has(/interview/) ? "Interview questions for this role" : "Preparation plan for this job" });
  }
  if (has(/\b(explain|walk me through|describe)\b[^.\n]{0,40}\b(my )?(project|repo|repository|codebase)\b/)) out.push({ type: "explain_project", label: "Project walkthrough" });
  if (has(/\b(improve|review|tailor|rewrite|fix|update)\b[^.\n]{0,30}\b(my )?(resume|cv)\b/)) out.push({ type: "resume_review", label: "Compare resume with the role" });
  if (has(/\bsave (this|that|the) (answer|reply|response)\b|\bsave (it|this) to (my )?(notes|application)\b/)) out.push({ type: "save_answer", label: "Save this answer to your notes or an application", needsConfirmation: true });
  return out.slice(0, 3);
}
