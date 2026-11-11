// Receives CSP violation reports (only used while CSP_MODE=report-only). Logs a short, sanitised line; stores nothing.
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[^\w:./\- ]/g, "").slice(0, 120) : "");

export async function POST(req: Request) {
  if (rateLimit(req, "write")) return new Response(null, { status: 429 });
  try {
    const text = (await req.text()).slice(0, 8_000);
    const r = (JSON.parse(text)?.["csp-report"] ?? {}) as Record<string, unknown>;
    console.warn(`[csp] ${clean(r["violated-directive"])} blocked=${clean(r["blocked-uri"])} doc=${clean(String(r["document-uri"] ?? "").split("?")[0])}`);
  } catch {}
  return new Response(null, { status: 204 });
}
