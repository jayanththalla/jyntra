// Pure state machine for a realtime interview turn. No DOM, no network: the WebRTC controller feeds it events and performs the
// effects it returns. This is where the hard rules live and where they are tested:
//   - Barge-in: speech starting while the interviewer talks cancels that response and clears its audio, and that response id
//     is remembered as STALE so late events from it can never overwrite the new state.
//   - Duplicates: the same transcript item id is accepted once, however many times the provider delivers it.
//   - Confirmation: by default a final transcript goes to review. Auto-submit is opt-in, and still submits once.
export type Phase = "idle" | "connecting" | "ready" | "ai_speaking" | "user_speaking" | "transcribing" | "reviewing" | "submitting" | "waiting_ai" | "error" | "closed";
export interface Draft { itemId: string; text: string; original: string; edited: boolean }
export interface RtState {
  phase: Phase; autoSubmit: boolean;
  activeResponse: string | null; staleResponses: string[]; interruptions: number;
  partial: string; draft: Draft | null; handledItems: string[]; error: string | null;
}
export type RtEvent =
  | { t: "connecting" } | { t: "connected" } | { t: "closed" } | { t: "error"; message: string }
  | { t: "ai_started"; responseId: string } | { t: "ai_audio_done"; responseId: string }
  | { t: "ai_text"; responseId: string; text: string }
  | { t: "speech_started" } | { t: "speech_stopped" }
  | { t: "transcript_partial"; itemId: string; delta: string }
  | { t: "transcript_final"; itemId: string; text: string }
  | { t: "edit"; text: string } | { t: "accept" } | { t: "rerecord" } | { t: "cancel_recording" }
  | { t: "submit_ok" } | { t: "submit_failed"; message: string } | { t: "set_auto_submit"; on: boolean };
export type RtEffect =
  | { type: "cancel_response" } | { type: "clear_output_audio" }
  | { type: "submit_answer"; itemId: string; text: string }
  | { type: "show_ai_text"; text: string };

const MAX_TRACKED = 200;
export const initialRt = (autoSubmit = false): RtState => ({ phase: "idle", autoSubmit, activeResponse: null, staleResponses: [], interruptions: 0, partial: "", draft: null, handledItems: [], error: null });
const cap = <T,>(xs: T[]) => (xs.length > MAX_TRACKED ? xs.slice(-MAX_TRACKED) : xs);
const none: RtEffect[] = [];

export function step(s: RtState, e: RtEvent): { state: RtState; effects: RtEffect[] } {
  switch (e.t) {
    case "connecting": return { state: { ...s, phase: "connecting", error: null }, effects: none };
    case "connected": return { state: { ...s, phase: "ready" }, effects: none };
    case "closed": return { state: { ...s, phase: "closed", activeResponse: null }, effects: none };
    case "error": return { state: { ...s, phase: "error", error: e.message }, effects: none };
    case "set_auto_submit": return { state: { ...s, autoSubmit: e.on }, effects: none };

    case "ai_started":
      // A response we already interrupted must not bring the interviewer back to "speaking".
      if (s.staleResponses.includes(e.responseId)) return { state: s, effects: none };
      if (s.phase === "user_speaking" || s.phase === "transcribing") return { state: s, effects: [{ type: "cancel_response" }, { type: "clear_output_audio" }] }; // user is mid-answer
      return { state: { ...s, phase: "ai_speaking", activeResponse: e.responseId }, effects: none };
    case "ai_audio_done":
      if (s.staleResponses.includes(e.responseId) || e.responseId !== s.activeResponse) return { state: s, effects: none };
      return { state: { ...s, phase: s.phase === "ai_speaking" ? "ready" : s.phase, activeResponse: null }, effects: none };
    case "ai_text":
      if (s.staleResponses.includes(e.responseId)) return { state: s, effects: none };   // an interrupted response cannot write its text
      return { state: s, effects: [{ type: "show_ai_text", text: e.text }] };

    case "speech_started": {
      if (s.phase === "ai_speaking") {
        const stale = s.activeResponse ? cap([...s.staleResponses, s.activeResponse]) : s.staleResponses;
        return { state: { ...s, phase: "user_speaking", activeResponse: null, staleResponses: stale, interruptions: s.interruptions + 1, partial: "" }, effects: [{ type: "cancel_response" }, { type: "clear_output_audio" }] };
      }
      if (s.phase === "ready" || s.phase === "reviewing" || s.phase === "waiting_ai") return { state: { ...s, phase: "user_speaking", partial: "" }, effects: none };
      return { state: s, effects: none };
    }
    case "speech_stopped": return { state: s.phase === "user_speaking" ? { ...s, phase: "transcribing" } : s, effects: none };
    case "transcript_partial":
      if (s.handledItems.includes(e.itemId) || (s.phase !== "user_speaking" && s.phase !== "transcribing")) return { state: s, effects: none };
      return { state: { ...s, partial: (s.partial + e.delta).slice(-2000) }, effects: none };
    case "transcript_final": {
      const text = e.text.trim();
      if (s.handledItems.includes(e.itemId)) return { state: s, effects: none };            // duplicate delivery
      if (s.draft?.itemId === e.itemId) return { state: s, effects: none };
      if (!text) return { state: { ...s, phase: "ready", partial: "" }, effects: none };      // silence/noise: nothing to review
      if (s.phase === "submitting" || s.phase === "waiting_ai") return { state: s, effects: none };   // never overwrite an answer in flight
      if (s.autoSubmit) return { state: { ...s, phase: "submitting", partial: "", draft: { itemId: e.itemId, text, original: text, edited: false }, handledItems: cap([...s.handledItems, e.itemId]) }, effects: [{ type: "submit_answer", itemId: e.itemId, text }] };
      return { state: { ...s, phase: "reviewing", partial: "", draft: { itemId: e.itemId, text, original: text, edited: false } }, effects: none };
    }
    case "edit":
      if (s.phase !== "reviewing" || !s.draft) return { state: s, effects: none };
      return { state: { ...s, draft: { ...s.draft, text: e.text, edited: e.text.trim() !== s.draft.original } }, effects: none };
    case "accept": {
      if (s.phase !== "reviewing" || !s.draft || !s.draft.text.trim()) return { state: s, effects: none };   // a second click while submitting does nothing
      return { state: { ...s, phase: "submitting", handledItems: cap([...s.handledItems, s.draft.itemId]) }, effects: [{ type: "submit_answer", itemId: s.draft.itemId, text: s.draft.text.trim() }] };
    }
    case "rerecord": case "cancel_recording":
      if (s.phase === "submitting" || s.phase === "waiting_ai") return { state: s, effects: none };
      return { state: { ...s, phase: "ready", draft: null, partial: "" }, effects: none };
    case "submit_ok": return { state: s.phase === "submitting" ? { ...s, phase: "waiting_ai", draft: null } : s, effects: none };
    case "submit_failed": return { state: s.phase === "submitting" ? { ...s, phase: "reviewing", error: e.message, handledItems: s.handledItems.filter((i) => i !== s.draft?.itemId) } : s, effects: none };   // the transcript is kept for retry
  }
}
export const run = (events: RtEvent[], from: RtState = initialRt()) => events.reduce((acc, ev) => { const r = step(acc.state, ev); return { state: r.state, effects: [...acc.effects, ...r.effects] }; }, { state: from, effects: [] as RtEffect[] });

/** Maps one provider data-channel message (OpenAI Realtime server event) to a state-machine event, or null when irrelevant. */
export function fromOpenAiEvent(m: any): RtEvent | null {
  switch (m?.type) {
    case "input_audio_buffer.speech_started": return { t: "speech_started" };
    case "input_audio_buffer.speech_stopped": return { t: "speech_stopped" };
    case "conversation.item.input_audio_transcription.delta": return typeof m.item_id === "string" && typeof m.delta === "string" ? { t: "transcript_partial", itemId: m.item_id, delta: m.delta } : null;
    case "conversation.item.input_audio_transcription.completed": return typeof m.item_id === "string" && typeof m.transcript === "string" ? { t: "transcript_final", itemId: m.item_id, text: m.transcript } : null;
    case "response.created": return typeof m.response?.id === "string" ? { t: "ai_started", responseId: m.response.id } : null;
    case "response.output_audio_transcript.done": return typeof m.response_id === "string" && typeof m.transcript === "string" ? { t: "ai_text", responseId: m.response_id, text: m.transcript } : null;
    case "output_audio_buffer.stopped": return typeof m.response_id === "string" ? { t: "ai_audio_done", responseId: m.response_id } : null;
    case "response.done": return typeof m.response?.id === "string" ? { t: "ai_audio_done", responseId: m.response.id } : null;
    case "error": return { t: "error", message: "The voice connection reported an error." };
    default: return null;
  }
}
