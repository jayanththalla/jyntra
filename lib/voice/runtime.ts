// Production wiring of the voice engine: real model + Sarvam adapters, built per request from the environment.
import { completeText } from "@/lib/ai/outreach";
import { depsFromEnv } from "@/lib/ai/service";
import { capabilities, llmDeps, llmPreference, voiceLimits } from "./config";
import { sarvamStt, sarvamTts } from "./providers";
import type { VoiceDeps } from "./service";

export function voiceDeps(env: NodeJS.ProcessEnv = process.env): VoiceDeps {
  const ai = depsFromEnv(env);
  const caps = capabilities(ai, env);
  return {
    caps,
    limits: voiceLimits(env),
    llm: (prompt) => completeText(prompt, llmDeps(ai, llmPreference(env))),
    stt: caps.stt.configured ? sarvamStt({ env }) : null,
    tts: caps.tts.provider === "sarvam" ? sarvamTts({ env }) : null,
  };
}
