// Browser-side logic for the voice interview, kept free of React and of real browser objects so it can be tested:
//  - microphone error classification
//  - the audio player (one sound at a time, replay / pause / stop, cancellation)
//  - the transcript-review state machine (record → transcribe → accept | edit | discard)
// The interviewer only ever receives text that went through "accept".

// ---------------- microphone ----------------
export type MicProblem = "denied" | "no_device" | "in_use" | "insecure" | "unsupported" | "unknown";
export function classifyMicError(e: unknown): { problem: MicProblem; message: string } {
  const name = (e as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return { problem: "denied", message: "Microphone access is blocked. Allow it in your browser's site settings, or switch to the text-only interview." };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return { problem: "no_device", message: "No microphone was found. Connect one, or switch to the text-only interview." };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { problem: "in_use", message: "The microphone is busy or unavailable. Close other apps using it and try again." };
    case "TypeError":
      return { problem: "insecure", message: "Recording needs a secure (https) page." };
    case "UnsupportedError":
      return { problem: "unsupported", message: "This browser can't record audio. Use the text-only interview." };
    default:
      return { problem: "unknown", message: "The microphone could not be started. Try again, or use the text-only interview." };
  }
}

/** First recording format the browser supports, in order of how widely the speech provider accepts it. */
export function pickRecorderMime(isSupported: (t: string) => boolean): string | null {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => isSupported(t)) ?? null;
}

// ---------------- audio player ----------------
export type PlayerState = "idle" | "loading" | "playing" | "paused" | "error";
export interface AudioLike {
  src: string;
  play(): Promise<void>;
  pause(): void;
  currentTime: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}
export interface PlayerDeps {
  createAudio: () => AudioLike;
  /** Resolves an interviewer turn to an object URL, or rejects (provider failure). */
  fetchAudio: (turnIdx: number, signal: AbortSignal) => Promise<string>;
  revoke?: (url: string) => void;
}

/**
 * Plays interviewer turns. At most one sound exists at any time: starting a new turn stops the old one first, a late response for a
 * turn that was cancelled or replaced is discarded, and a provider failure leaves the text on screen (state "error", never a crash).
 */
export class AudioPlayer {
  state: PlayerState = "idle";
  turn: number | null = null;
  private audio: AudioLike | null = null;
  private url: string | null = null;
  private ctrl: AbortController | null = null;
  private seq = 0;
  /** Cached URL per turn so Replay does not call the provider again. */
  private cache = new Map<number, string>();
  constructor(private deps: PlayerDeps, private onChange: (s: PlayerState, turn: number | null) => void = () => {}) {}

  private set(s: PlayerState, t: number | null = this.turn) {
    this.state = s;
    this.turn = t;
    this.onChange(s, t);
  }

  private halt() {
    this.seq++; // any in-flight request for the previous turn is now stale
    this.ctrl?.abort();
    this.ctrl = null;
    if (this.audio) {
      this.audio.onended = this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
  }

  async play(turnIdx: number): Promise<void> {
    this.halt();
    const my = this.seq;
    this.set("loading", turnIdx);
    let url = this.cache.get(turnIdx);
    if (!url) {
      this.ctrl = new AbortController();
      try {
        url = await this.deps.fetchAudio(turnIdx, this.ctrl.signal);
      } catch {
        if (my === this.seq) this.set("error", turnIdx);
        return;
      }
      if (my !== this.seq) { this.deps.revoke?.(url); return; } // cancelled or replaced while generating
      this.cache.set(turnIdx, url);
    }
    const a = this.deps.createAudio();
    this.audio = a;
    a.src = url;
    a.currentTime = 0;
    a.onended = () => my === this.seq && this.set("idle", turnIdx);
    a.onerror = () => my === this.seq && this.set("error", turnIdx);
    try {
      await a.play();
      if (my === this.seq) this.set("playing", turnIdx);
    } catch {
      if (my === this.seq) this.set("error", turnIdx); // e.g. autoplay blocked: the user can press Play
    }
  }

  replay() {
    return this.turn === null ? Promise.resolve() : this.play(this.turn);
  }
  pause() {
    if (this.state === "playing" && this.audio) { this.audio.pause(); this.set("paused"); }
  }
  async resume() {
    if (this.state === "paused" && this.audio) {
      try { await this.audio.play(); this.set("playing"); } catch { this.set("error"); }
    }
  }
  stop() {
    this.halt();
    if (this.turn !== null) this.set("idle");
  }
  dispose() {
    this.halt();
    for (const u of this.cache.values()) this.deps.revoke?.(u);
    this.cache.clear();
  }
}

// ---------------- transcript review ----------------
export interface Draft { text: string; original: string; edited: boolean; stt: unknown }
export type ReviewState =
  | { phase: "idle" }
  | { phase: "recording" }
  | { phase: "transcribing" }
  | { phase: "review"; draft: Draft }
  | { phase: "submitting"; draft: Draft }
  | { phase: "error"; message: string; retryable: boolean };

export type ReviewEvent =
  | { type: "record" }
  | { type: "stop" }
  | { type: "transcribed"; text: string; stt: unknown }
  | { type: "failed"; message: string; retryable: boolean }
  | { type: "edit"; text: string }
  | { type: "discard" }
  | { type: "accept" }
  | { type: "accepted" }
  | { type: "submit_failed"; message: string };

export const initialReview: ReviewState = { phase: "idle" };

/** Only "accept" moves a draft to "submitting"; discard drops it without any trace; edits keep the original for the edited flag. */
export function reviewReducer(s: ReviewState, e: ReviewEvent): ReviewState {
  switch (e.type) {
    case "record": return s.phase === "idle" || s.phase === "error" || s.phase === "review" ? { phase: "recording" } : s;
    case "stop": return s.phase === "recording" ? { phase: "transcribing" } : s;
    case "transcribed": return s.phase === "transcribing" ? { phase: "review", draft: { text: e.text, original: e.text, edited: false, stt: e.stt } } : s;
    case "failed": return s.phase === "transcribing" || s.phase === "recording" ? { phase: "error", message: e.message, retryable: e.retryable } : s;
    case "edit": return s.phase === "review" ? { phase: "review", draft: { ...s.draft, text: e.text, edited: e.text.trim() !== s.draft.original.trim() } } : s;
    case "discard": return s.phase === "review" || s.phase === "error" ? { phase: "idle" } : s;
    case "accept": return s.phase === "review" && s.draft.text.trim().length >= 2 ? { phase: "submitting", draft: s.draft } : s;
    case "accepted": return s.phase === "submitting" ? { phase: "idle" } : s;
    case "submit_failed": return s.phase === "submitting" ? { phase: "review", draft: s.draft } : s;
  }
}

/** Maps a server error code to a short, calm message and whether a text answer can replace speech. */
export function voiceErrorAdvice(code: string | undefined): { message: string; suggestText: boolean } {
  switch (code) {
    case "no_speech": return { message: "No speech was recognised. Check your microphone and record again.", suggestText: false };
    case "speech_quota_exhausted": return { message: "The speech provider's free quota is used up for now. You can type your answers instead.", suggestText: true };
    case "speech_rate_limited": return { message: "The speech service is busy. Try again in a moment.", suggestText: false };
    case "stt_unavailable": case "speech_unavailable": case "speech_unavailable_": return { message: "Speech recognition is unavailable. You can type your answers instead.", suggestText: true };
    case "invalid_audio": return { message: "That recording could not be used. Record a shorter answer.", suggestText: false };
    default: return { message: "Something went wrong. Try again.", suggestText: false };
  }
}
