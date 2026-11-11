// Checks the AI keys in .env against the providers (read-only "list models" calls). Prints status only, never the key.
//   npm run check:ai
import { cleanKey } from "@/lib/ai/outreach";

async function main() {
  const groq = cleanKey(process.env.GROQ_API_KEY);
  const gem = cleanKey(process.env.GEMINI_API_KEY);
  const raw = process.env.GROQ_API_KEY ?? "";
  if (raw && raw !== raw.trim()) console.log("note: GROQ_API_KEY has leading/trailing whitespace (it is trimmed before use).");
  if (/^["']|["']$/.test(raw)) console.log("note: GROQ_API_KEY is wrapped in quotes in .env (quotes are stripped before use).");
  const probe = async (name: string, url: string, headers: Record<string, string>, key?: string) => {
    if (!key) return console.log(`${name}: no key set`);
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      console.log(`${name}: HTTP ${r.status} ${r.ok ? "OK, key accepted" : r.status === 401 || r.status === 403 ? "KEY REJECTED, create a new key and paste it into .env" : "provider problem"} (key length ${key.length}, starts with ${key.slice(0, 4)}...)`);
    } catch (e) { console.log(`${name}: could not reach the provider (${(e as Error).name})`); }
  };
  await probe("Groq", "https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${groq}` }, groq);
  await probe("Gemini", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { "x-goog-api-key": gem ?? "" }, gem);
}
main();
