import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyJobs } from "@/components/companies/CompanyJobs";
import { StartupAvatar } from "@/components/StartupAvatar";
import { ArrowLeftIcon } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadArena, fmtDate } from "@/lib/arena";
import { loadDbCompany } from "@/lib/company-jobs/directory";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const slug = (await params).slug;
  const c = loadArena().bySlug.get(slug) ?? (await loadDbCompany(slug));
  return { title: c ? `${c.name} jobs` : "Company" };
}

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { bySlug, fetchedAt } = loadArena();
  const c = bySlug.get(slug) ?? (await loadDbCompany(slug));
  if (!c) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const stat = (n: number, label: string) => (
    <div className="min-w-24">
      <div className="text-2xl font-semibold tabular-nums">{n}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  const recent = c.jobs.filter((j) => j.posted && Date.parse(today) - Date.parse(j.posted) <= 30 * 86_400_000).length;
  return (
    <div className="space-y-5">
      <Link href="/companies" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2.5 text-muted-foreground" })}>
        <ArrowLeftIcon /> All companies
      </Link>
      <Card>
        <div className="flex flex-col gap-5 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-4">
            <StartupAvatar name={c.name} size="lg" src={`/api/companies/${c.slug}/logo`} />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{c.name}</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Listings collected {fmtDate((fetchedAt ?? today).slice(0, 10))}
              </p>
            </div>
          </div>
          <div className="flex gap-6">
            {stat(c.jobs.length, "open roles")}
            {stat(recent, "posted in 30 days")}
            {stat(c.jobs.filter((j) => j.fresher).length, "fresher friendly")}
          </div>
        </div>
      </Card>
      <CompanyJobs jobs={c.jobs} today={today} slug={c.slug} companyPage={c.page} />
    </div>
  );
}
