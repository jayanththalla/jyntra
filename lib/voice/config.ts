// Voice interview configuration. Every value is read from the environment on each call (nothing is baked into a bundle) and no key
// is ever returned: capabilities() reports only WHICH features are configured. Nothing here requires every key at once.
import { configuredProviders, type AiDeps } from "@/lib/ai/outreach";

type Env = Record<string, string | undefined>;
const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, Math.round(n))) : d;
};

export type SttProviderId = "sarvam";
export type TtsProviderId = "sarvam" | "browser";
export type LlmPreference = "auto" | "groq" | "gemini";

export interface VoiceLimits {
  maxTurns: number;
  maxMinutes: number;
  maxAudioSeconds: number;
  maxAudioBytes: number;
  audioRetentionDays: number;
  maxActiveSessions: number;
  maxAnswerChars: number;
}

export function voiceLimits(env: Env = process.env): VoiceLimits {
  return {
    maxTurns: num(env.VOICE_MAX_TURNS, 10, 3, 30),
    maxMinutes: num(env.VOICE_MAX_MINUTES, 30, 5, 120),
    maxAudioSeconds: num(env.VOICE_MAX_AUDIO_SECONDS, 90, 10, 300),
    maxAudioBytes: num(env.VOICE_MAX_AUDIO_BYTES, 4_000_000, 100_000, 10_000_000),
    audioRetentionDays: num(env.VOICE_AUDIO_RETENTION_DAYS, 7, 1, 90),
    maxActiveSessions: num(env.VOICE_MAX_ACTIVE_SESSIONS, 2, 1, 10),
    maxAnswerChars: 2_500,
  };
}

/** The provider ids selected by VOICE_STT_PROVIDER / VOICE_TTS_PROVIDER, or null when switched off ("none") or unsupported. */
export function sttProviderId(env: Env = process.env): SttProviderId | null {
  const v = (env.VOICE_STT_PROVIDER ?? "sarvam").trim().toLowerCase();
  return v === "sarvam" ? "sarvam" : null;
}
export function ttsProviderId(env: Env = process.env): TtsProviderId | null {
  const v = (env.VOICE_TTS_PROVIDER ?? "sarvam").trim().toLowerCase();
  return v === "sarvam" || v === "browser" ? v : null;
}
export function llmPreference(env: Env = process.env): LlmPreference {
  const v = (env.VOICE_LLM_PROVIDER ?? "auto").trim().toLowerCase();
  return v === "groq" || v === "gemini" ? v : "auto";
}

export const sarvamKey = (env: Env = process.env) => {
  const k = (env.SARVAM_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  return k.length >= 8 ? k : undefined;
};

/** Narrows the AI deps to the preferred interviewer model, but never to a provider that has no key. */
export function llmDeps(d: AiDeps, pref: LlmPreference): AiDeps {
  const have = configuredProviders(d);
  if (pref === "groq" && have.includes("groq")) return { ...d, geminiKey: undefined };
  if (pref === "gemini" && have.includes("gemini")) return { ...d, groqKey: undefined };
  return d;
}

export interface Capabilities {
  /** server-side speech-to-text is usable */
  stt: { configured: boolean; provider: SttProviderId | null; reason?: string };
  tts: { configured: boolean; provider: TtsProviderId | null; browserFallback: boolean; reason?: string };
  llm: { configured: boolean; providers: string[]; preference: LlmPreference; reason?: string };
  /** a text-only interview needs only the interviewer model */
  textOnly: boolean;
  /** a spoken interview needs all three */
  spoken: boolean;
  limits: VoiceLimits;
}

/** Which capabilities are configured. Reasons name the environment variable to set, never a value. */
export function capabilities(d: AiDeps, env: Env = process.env): Capabilities {
  const stt = sttProviderId(env);
  const tts = ttsProviderId(env);
  const llm = configuredProviders(llmDeps(d, llmPreference(env)));
  const hasSarvam = !!sarvamKey(env);
  const sttOk = stt === "sarvam" && hasSarvam;
  const ttsServer = tts === "sarvam" && hasSarvam;
  return {
    stt: { configured: sttOk, provider: sttOk ? stt : null, reason: sttOk ? undefined : stt === null ? "Speech-to-text is switched off (VOICE_STT_PROVIDER)." : "Set SARVAM_API_KEY to enable speech-to-text." },
    tts: {
      configured: ttsServer || tts === "browser",
      provider: ttsServer ? "sarvam" : tts === "browser" ? "browser" : null,
      browserFallback: tts !== null, // the browser's own speech synthesis can read text aloud without any key
      reason: ttsServer || tts === "browser" ? undefined : tts === null ? "Text-to-speech is switched off (VOICE_TTS_PROVIDER)." : "Set SARVAM_API_KEY to enable server text-to-speech.",
    },
    llm: { configured: llm.length > 0, providers: llm, preference: llmPreference(env), reason: llm.length ? undefined : "Set GROQ_API_KEY or GEMINI_API_KEY for the interviewer." },
    textOnly: llm.length > 0,
    spoken: llm.length > 0 && sttOk,
    limits: voiceLimits(env),
  };
}

/** One line for server start-up logs: which capabilities are configured. No values. */
export function describeCapabilities(c: Capabilities): string {
  return `voice: stt=${c.stt.configured ? c.stt.provider : "off"} tts=${c.tts.configured ? c.tts.provider : "off"} llm=${c.llm.configured ? c.llm.providers.join("+") : "off"} text-only=${c.textOnly}`;
}
