// Provider abstraction for speech. The interview engine only ever sees SttProvider / TtsProvider, so another service (or a local backend)
// can be added without touching it. Sarvam is the first adapter, written against the official REST docs (read 2026-10-29):
//   STT  POST https://api.sarvam.ai/speech-to-text   multipart: file, [model], [language_code], [with_timestamps]; header api-subscription-key
//        200 -> { request_id, transcript, language_code, timestamps?: { words, start_time_seconds, end_time_seconds }, language_probability? }
//        The REST endpoint is for quick (< 30 s) audio; longer audio needs their Batch API (not used here). No per-word confidence is returned.
//   TTS  POST https://api.sarvam.ai/text-to-speech   JSON: text, language_code, [model], [speaker], [output_audio_codec]; same header
//        200 -> { request_id, audios: [base64 audio] }. Text limit 2500 chars (bulbul:v3) / 1500 (bulbul:v2).
// Model and speaker are NOT hard-coded: they are sent only when SARVAM_STT_MODEL / SARVAM_TTS_MODEL / SARVAM_TTS_SPEAKER are set, and
// the API's documented defaults apply otherwise. The key is read here, on the server, and goes only into the request header.
import { sarvamKey } from "./config";

export type VoiceErrorCode = "not_configured" | "rate_limited" | "quota_exhausted" | "auth" | "invalid_audio" | "timeout" | "unavailable" | "empty" | "bad_response";
export class VoiceError extends Error {
  constructor(public code: VoiceErrorCode, message: string, public retryAfterSeconds?: number) {
    super(message);
  }
  /** Whether trying the same request again later can work. */
  get retryable() {
    return this.code === "rate_limited" || this.code === "timeout" || this.code === "unavailable";
  }
}

export interface Transcript {
  text: string;
  /** BCP-47 tag the provider reports, e.g. en-IN */
  language: string | null;
  /** provider segments with start/end seconds, kept as given */
  segments: { text: string; start: number; end: number }[];
  /** null when the provider supplies none (Sarvam's REST STT returns language_probability only, which is NOT transcription confidence) */
  confidence: number | null;
  languageProbability: number | null;
  requestId: string | null;
  provider: string;
}
export interface SttProvider {
  id: string;
  transcribe(a: { audio: Uint8Array; mime: string; signal?: AbortSignal }): Promise<Transcript>;
}
export interface TtsResult { audio: Uint8Array; mime: string; provider: string }
export interface TtsProvider {
  id: string;
  synthesize(a: { text: string; signal?: AbortSignal }): Promise<TtsResult>;
}

const API = "https://api.sarvam.ai";
const DOC_STT_MODELS = new Set(["saaras:v4", "saaras:v3"]);
const DOC_TTS_MODELS = new Set(["bulbul:v2", "bulbul:v3", "bulbul:v4-flash"]);

function mapStatus(status: number, body: string): VoiceError {
  const t = body.slice(0, 300).toLowerCase();
  if (status === 429) return /quota|credit|exceed|insufficient|balance/.test(t) ? new VoiceError("quota_exhausted", "The speech provider's free quota is used up.") : new VoiceError("rate_limited", "The speech provider is busy. Try again in a moment.");
  if (status === 401 || status === 403) return /quota|credit|insufficient/.test(t) ? new VoiceError("quota_exhausted", "The speech provider's free quota is used up.") : new VoiceError("auth", "The speech provider rejected the server's credentials.");
  if (status === 400 || status === 413 || status === 415 || status === 422) return new VoiceError("invalid_audio", "The provider could not read that audio. Record again.");
  return new VoiceError("unavailable", "The speech provider is unavailable right now.");
}

async function call(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const signal = outer ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal });
  } catch (e) {
    if (outer?.aborted) throw new VoiceError("timeout", "Cancelled.");
    throw new VoiceError((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError" ? "timeout" : "unavailable", "The speech provider could not be reached.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => ""); // inspected for quota words only; never logged or returned
    const err = mapStatus(res.status, body);
    const ra = Number(res.headers.get("retry-after"));
    if (Number.isFinite(ra)) err.retryAfterSeconds = ra;
    throw err;
  }
  return res;
}

export interface SarvamOptions { key?: string; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> }

export function sarvamStt(o: SarvamOptions = {}): SttProvider {
  const env = o.env ?? process.env;
  return {
    id: "sarvam",
    async transcribe({ audio, mime, signal }) {
      const key = o.key ?? sarvamKey(env);
      if (!key) throw new VoiceError("not_configured", "Speech-to-text is not configured.");
      const form = new FormData();
      form.append("file", new Blob([audio as BlobPart], { type: mime }), `answer.${mime.split("/")[1]?.split(";")[0] || "webm"}`);
      form.append("language_code", "en-IN"); // the interview is conducted in English
      form.append("with_timestamps", "true");
      const model = env.SARVAM_STT_MODEL?.trim();
      if (model) {
        if (!DOC_STT_MODELS.has(model)) throw new VoiceError("not_configured", "SARVAM_STT_MODEL is not a documented model id.");
        form.append("model", model);
      }
      const res = await call(`${API}/speech-to-text`, { method: "POST", headers: { "api-subscription-key": key }, body: form }, 30_000, signal, o.fetchImpl);
      const j = (await res.json().catch(() => null)) as any;
      if (!j || typeof j.transcript !== "string") throw new VoiceError("bad_response", "The speech provider returned something unexpected.");
      const text = j.transcript.replace(/\s+/g, " ").trim();
      if (!text) throw new VoiceError("empty", "No speech was recognised. Check your microphone and try again.");
      const ts = j.timestamps;
      const segs: Transcript["segments"] = [];
      if (ts && Array.isArray(ts.words) && Array.isArray(ts.start_time_seconds) && Array.isArray(ts.end_time_seconds)) {
        ts.words.forEach((w: unknown, i: number) => {
          const s = Number(ts.start_time_seconds[i]), e = Number(ts.end_time_seconds[i]);
          if (typeof w === "string" && Number.isFinite(s) && Number.isFinite(e)) segs.push({ text: w, start: s, end: e });
        });
      }
      const lp = Number(j.language_probability);
      return { text, language: typeof j.language_code === "string" ? j.language_code : null, segments: segs, confidence: null, languageProbability: Number.isFinite(lp) ? lp : null, requestId: typeof j.request_id === "string" ? j.request_id : null, provider: "sarvam" };
    },
  };
}

export function sarvamTts(o: SarvamOptions = {}): TtsProvider {
  const env = o.env ?? process.env;
  return {
    id: "sarvam",
    async synthesize({ text, signal }) {
      const key = o.key ?? sarvamKey(env);
      if (!key) throw new VoiceError("not_configured", "Text-to-speech is not configured.");
      const model = env.SARVAM_TTS_MODEL?.trim();
      const speaker = env.SARVAM_TTS_SPEAKER?.trim().toLowerCase();
      if (model && !DOC_TTS_MODELS.has(model)) throw new VoiceError("not_configured", "SARVAM_TTS_MODEL is not a documented model id.");
      const limit = model === "bulbul:v2" ? 1500 : 2500;
      const clean = text.replace(/\s+/g, " ").trim().slice(0, limit);
      if (!clean) throw new VoiceError("empty", "Nothing to speak.");
      const body: Record<string, unknown> = { text: clean, language_code: "en-IN", output_audio_codec: "mp3" };
      if (model) body.model = model;
      if (speaker) body.speaker = speaker;
      const res = await call(`${API}/text-to-speech`, { method: "POST", headers: { "api-subscription-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) }, 30_000, signal, o.fetchImpl);
      const j = (await res.json().catch(() => null)) as any;
      const b64 = Array.isArray(j?.audios) ? j.audios[0] : null;
      if (typeof b64 !== "string" || !b64) throw new VoiceError("bad_response", "The speech provider returned no audio.");
      return { audio: new Uint8Array(Buffer.from(b64, "base64")), mime: "audio/mpeg", provider: "sarvam" };
    },
  };
}
