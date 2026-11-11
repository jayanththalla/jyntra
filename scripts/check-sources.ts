// Live provider probe. Run on a machine with internet access:  npm run check:sources
// Makes ONE small request to each public source and reports reachable / unreachable. It never writes to the database and never
// needs a key. A failure here means the provider (or your network) is the problem, not necessarily the app.
const SOURCES: { id: string; url: string; note?: string }[] = [
  { id: "yc", url: "https://yc-oss.github.io/api/companies/all.json", note: "YC directory mirror" },
  { id: "himalayas", url: "https://himalayas.app/jobs/api?limit=1" },
  { id: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs?content=false", note: "a public ATS board" },
  { id: "lever", url: "https://api.lever.co/v0/postings/leverdemo?mode=json&limit=1" },
  { id: "ashby", url: "https://api.ashbyhq.com/posting-api/job-board/ashby?includeCompensation=false" },
  { id: "hyderabad_dataset", url: "https://raw.githubusercontent.com/shivtchandra/hydstartuplist/master/data/startups.json" },
  { id: "frankfurter_fx", url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR" },
  { id: "funding_rss_inc42", url: "https://inc42.com/buzz/feed/" },
];

async function probe(s: (typeof SOURCES)[number]) {
  const t0 = Date.now();
  try {
    const r = await fetch(s.url, { headers: { "User-Agent": "DailyStartupFinder/0.1 (source check)", Accept: "application/json, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(20_000) });
    await r.arrayBuffer().catch(() => null);
    return { ...s, ok: r.ok, detail: `HTTP ${r.status}`, ms: Date.now() - t0 };
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name;
    return { ...s, ok: false, detail: `unreachable (${code})`, ms: Date.now() - t0 };
  }
}

async function main() {
  const results = await Promise.all(SOURCES.map(probe));
  for (const r of results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.id.padEnd(20)} ${r.detail.padEnd(28)} ${r.ms} ms`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} reachable. This checks reachability only, not that the data parses; run \`npm run refresh\` for that.`);
  process.exitCode = bad ? 1 : 0;
}
main();
export {};
