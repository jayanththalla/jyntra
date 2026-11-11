// Runs once when the server starts: reports which voice-interview capabilities are configured (no values, no keys).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { capabilities, describeCapabilities } = await import("@/lib/voice/config");
  console.log(`[startup] ${describeCapabilities(capabilities({ groqKey: process.env.GROQ_API_KEY?.trim() || undefined, geminiKey: process.env.GEMINI_API_KEY?.trim() || undefined }))}`);
}
