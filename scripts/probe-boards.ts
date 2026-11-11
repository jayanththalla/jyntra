// npm run boards:probe — calls every board in data/boards.json once and writes data/boards-report.json.
// ok = feed works; notfound = wrong slug or the company uses another ATS; error = temporary or blocked.
import fs from "node:fs";
import path from "node:path";
import { loadBoards, matchesCity } from "@/lib/company-jobs/boards";
import { fetchAtsJobs } from "@/sources/jobs/ats";
import { errorCategory } from "@/lib/http";

async function main() {
  const boards = loadBoards();
  const report: Record<string, unknown>[] = [];
  for (const b of boards) {
    try {
      const { jobs } = await fetchAtsJobs({ vendor: b.ats, slug: b.slug }, `ats:${b.ats}`, 0);
      const inCity = jobs.filter((j) => matchesCity(j.location, b.city));
      report.push({ name: b.name, ats: b.ats, slug: b.slug, city: b.city, status: "ok", total: jobs.length, inCity: inCity.length, withApplyLink: inCity.filter((j) => j.applyUrl).length });
    } catch (e) {
      const status = (e as { status?: number }).status;
      report.push({ name: b.name, ats: b.ats, slug: b.slug, city: b.city, status: status === 404 ? "notfound" : "error", category: errorCategory(e) });
    }
    console.log(JSON.stringify(report[report.length - 1]));
  }
  fs.writeFileSync(path.join(process.cwd(), "data", "boards-report.json"), JSON.stringify({ checkedAt: new Date().toISOString(), report }, null, 2));
  console.log(`\n${report.filter((r) => r.status === "ok").length}/${report.length} boards ok. Report: data/boards-report.json`);
}
main();
