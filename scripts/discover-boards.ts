// npm run boards:discover -- hyderabad [data/companies-input.txt]
// Reads "Company Name, https://company.com" lines, looks for a Greenhouse / Lever / Ashby link on the company's own
// homepage and careers pages (robots.txt respected), confirms the feed works, and adds working boards to data/boards.json.
import fs from "node:fs";
import path from "node:path";
import { CITIES, loadBoards, matchesCity, parseBoards } from "@/lib/company-jobs/boards";
import { assertPublicHttpsUrl } from "@/lib/net/public-url";
import { politeFetch } from "@/lib/http";
import { fetchAtsJobs, findAtsRef } from "@/sources/jobs/ats";

const city = (process.argv[2] ?? "hyderabad").toLowerCase();
const input = process.argv[3] ?? path.join(process.cwd(), "data", "companies-input.txt");
const FILE = path.join(process.cwd(), "data", "boards.json");

async function page(url: string): Promise<string> {
  try {
    await assertPublicHttpsUrl(url);
    const res = await politeFetch(url, { retries: 1 });
    return (await res.text()).slice(0, 600_000);
  } catch {
    return "";
  }
}

async function main() {
  if (!CITIES[city]) throw new Error(`Unknown city "${city}". Use one of: ${Object.keys(CITIES).join(", ")}`);
  const lines = fs.readFileSync(input, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const have = loadBoards();
  const added: { name: string; ats: string; slug: string; city: string; website: string }[] = [];
  for (const line of lines) {
    const [name, website] = line.split(",").map((x) => x.trim());
    if (!name || !website) continue;
    const base = website.replace(/\/+$/, "");
    let ref = null as ReturnType<typeof findAtsRef>;
    for (const p of ["", "/careers", "/jobs", "/careers/jobs", "/company/careers"]) {
      ref = findAtsRef(await page(base + p));
      if (ref) break;
    }
    if (!ref) { console.log(`- ${name}: no public ATS link found`); continue; }
    if (have.some((b) => b.ats === ref!.vendor && b.slug === ref!.slug && b.city === city)) { console.log(`= ${name}: already listed`); continue; }
    try {
      const { jobs } = await fetchAtsJobs(ref, `ats:${ref.vendor}`, 0);
      const n = jobs.filter((j) => matchesCity(j.location, city)).length;
      console.log(`+ ${name}: ${ref.vendor}/${ref.slug}, ${jobs.length} jobs, ${n} in ${CITIES[city].label}`);
      if (n > 0) added.push({ name, ats: ref.vendor, slug: ref.slug, city, website });
    } catch {
      console.log(`! ${name}: ${ref.vendor}/${ref.slug} did not respond`);
    }
  }
  if (added.length) {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    raw.boards = parseBoards({ boards: [...(raw.boards ?? []), ...added] });
    fs.writeFileSync(FILE, JSON.stringify(raw, null, 2) + "\n");
  }
  console.log(`\nAdded ${added.length} board(s) to data/boards.json`);
}
main();
