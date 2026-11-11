// Live check of public boards, NO database. Usage: npm run jobs:validate-live -- greenhouse:stripe lever:palantir ashby:ramp
// Prints what each real endpoint returned. Use it from a machine that can reach the ATS hosts.
import { getProvider, isProviderId } from "@/lib/ingestion/providers";
async function main() {
  const specs = process.argv.slice(2).filter((a) => a.includes(":"));
  if (!specs.length) { console.log("usage: jobs:validate-live -- provider:board [workday:tenant/wd3/Site] ..."); return; }
  for (const spec of specs) {
    const [p, rest] = spec.split(":") as [string, string];
    if (!isProviderId(p)) { console.log(`${spec}: unsupported provider`); continue; }
    const [a, b, c] = rest.split("/");
    const src = { id: null, companySlug: "live", provider: p, boardSlug: p === "workday" ? null : a!, tenant: p === "workday" ? a! : null, host: p === "workday" ? b ?? null : null, careerSite: p === "workday" ? c ?? null : null, sourceUrl: null, etag: null, lastModified: null, config: {} } as const;
    const t0 = Date.now();
    const v = await getProvider(p).validateSource(src as any);
    console.log(`${spec.padEnd(40)} ${v.ok ? "OK  " : "FAIL"} http=${v.httpStatus ?? "-"} jobs=${v.jobCount ?? "-"} ${Date.now() - t0}ms ${v.error ?? ""}`);
    for (const s of v.sample) console.log(`    - ${s.title} | ${s.location ?? "?"} | ${s.applyUrl ?? "NO APPLY URL"}`);
  }
}
main();
