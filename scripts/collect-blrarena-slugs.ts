// Collects company slugs from the BLR Startup Arena map page into data/blrarena-slugs.txt (run on a machine that can reach the site):
//   npx tsx scripts/collect-blrarena-slugs.ts
// It looks for /companies/<slug> links and "slug":"..." values in the page's HTML and embedded data. If it finds none, the map is
// loaded by a script after the page opens: open the map in your browser, DevTools > Network > Fetch/XHR, find the request that
// returns the companies, and send me that URL; the adapter can then use it directly.
import fs from "node:fs";
const BASE = "https://www.blrstartuparena.com";
(async () => {
  const slugs = new Set<string>();
  for (const page of ["/map", "/companies", "/"]) {
    try {
      const html = await (await fetch(BASE + page, { headers: { "User-Agent": "JyntraProbe/1.0" } })).text();
      for (const m of html.matchAll(/\/companies\/([a-z0-9][a-z0-9-]{0,80})(?=["'\\/?#<\s])/g)) slugs.add(m[1]);
      for (const m of html.matchAll(/\\?"slug\\?":\\?"([a-z0-9][a-z0-9-]{0,80})\\?"/g)) slugs.add(m[1]);
      console.log(`${page}: ${slugs.size} slugs so far`);
    } catch (e) { console.log(`${page}: failed (${(e as Error).message})`); }
  }
  slugs.delete("jobs");
  if (!slugs.size) return console.log("No slugs found in the page HTML. See the note at the top of this script.");
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/blrarena-slugs.txt", [...slugs].sort().join("\n") + "\n");
  console.log(`Wrote ${slugs.size} slugs to data/blrarena-slugs.txt. Set BLRARENA_ENABLED=true to use them.`);
})();
