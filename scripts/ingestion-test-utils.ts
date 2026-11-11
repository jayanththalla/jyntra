import { setPublicHostResolver } from "@/lib/net/public-url";
import { setFetchImpl } from "@/lib/ingestion/http";

export interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
export type Handler = (url: string, init: RequestInit, call: Call) => Response | Promise<Response | null> | null;

export function json(data: unknown, init: ResponseInit & { etag?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.etag) headers.set("etag", init.etag);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}
export const text = (body: string, init: ResponseInit = {}) => new Response(body, { status: init.status ?? 200, headers: init.headers });

/** Installs a fixture-backed fetch + a DNS stub so no test touches the network. Returns the recorded calls and a restore fn. */
export function installFixtures(handlers: Handler[]) {
  setPublicHostResolver(async () => ["93.184.216.34"]);
  const calls: Call[] = [];
  const prev = setFetchImpl(async (url, init) => {
    const call: Call = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    for (const h of handlers) {
      const r = await h(url, init, call);
      if (r) return r;
    }
    return new Response("not found (no fixture)", { status: 404 });
  });
  return { calls, restore: () => void setFetchImpl(prev) };
}

export function harness() {
  let passed = 0, failed = 0;
  return {
    async t(name: string, fn: () => void | Promise<void>) {
      try { await fn(); passed++; console.log(`  ✓ ${name}`); }
      catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 5).join("\n    ")}`); }
    },
    done(label: string) {
      console.log(`\n${label}: ${passed} passed, ${failed} failed`);
      if (failed) process.exit(1);
      return passed;
    },
  };
}
