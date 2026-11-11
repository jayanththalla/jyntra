// Prints the REAL response shapes of blrstartuparena.com so the adapter can be checked against them. Run on a machine that can reach it:
//   npx tsx scripts/probe-blrarena.ts [slug ...]      (default slug: pwc)
const BASE = "https://www.blrstartuparena.com";
async function show(url: string) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "JyntraProbe/1.0" } });
    const body = await r.text();
    console.log(`\n${r.status} ${url}  content-type=${r.headers.get("content-type")}  bytes=${body.length}`);
    try { const j = JSON.parse(body); const first = Array.isArray(j) ? j[0] : Array.isArray(j?.jobs) ? j.jobs[0] : j; console.log("top-level keys:", Array.isArray(j) ? `array(${j.length})` : Object.keys(j)); console.log("first item:", JSON.stringify(first, null, 2)?.slice(0, 900)); }
    catch { console.log("not JSON; starts with:", body.slice(0, 200).replace(/\s+/g, " ")); }
  } catch (e) { console.log(`\nFAILED ${url}: ${(e as Error).message}`); }
}
(async () => {
  await show(`${BASE}/robots.txt`);
  await show(`${BASE}/api/companies`);
  for (const s of process.argv.slice(2).length ? process.argv.slice(2) : ["pwc"]) await show(`${BASE}/api/companies/${s}/jobs`);
})();
