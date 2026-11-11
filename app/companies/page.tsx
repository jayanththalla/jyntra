import type { Metadata } from "next";
import { CompaniesDirectory } from "@/components/companies/CompaniesDirectory";
import { PageHeader } from "@/components/PageHeader";
import { dbCompanyCards } from "@/lib/company-jobs/directory";
import { companyCards, loadArena, familyLabel } from "@/lib/arena";

export const metadata: Metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const { totalJobs: snapshotJobs, fetchedAt, bySlug } = loadArena();
  const cards = [...companyCards(), ...(await dbCompanyCards(new Set(bySlug.keys())))];
  const totalJobs = snapshotJobs + cards.filter((c) => !bySlug.has(c.slug)).reduce((n, c) => n + c.count, 0);
  const cities = [...new Set(cards.map((c) => c.city).filter((x): x is string => !!x))].sort();
  const counts = new Map<string, number>();
  for (const c of cards) for (const f of c.families) counts.set(f, (counts.get(f) ?? 0) + 1);
  const families = [...counts].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, label: familyLabel(key), companies: n }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Companies"
        subtitle={`${cards.length} companies hiring across ${cities.join(", ") || "India"}, ${totalJobs.toLocaleString("en-IN")} open roles. Open a company to see all of its listings.`}
      />
      <CompaniesDirectory cities={cities} cards={cards} families={families} fetchedAt={fetchedAt} />
    </div>
  );
}
