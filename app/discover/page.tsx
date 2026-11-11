"use client";
// Discover: the one place to find work. Jobs (individual openings) and Startups (recently funded companies) are tabs.
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/components/api";
import { Banner } from "@/components/Banner";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { JobsTab } from "@/components/discover/JobsTab";
import { CityJobsFeed } from "@/components/discover/CityJobsFeed";
import { StartupsDirectory } from "@/components/StartupsDirectory";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function Discover() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = sp.get("tab") === "startups" ? "startups" : sp.get("tab") === "boards" ? "boards" : "jobs";
  const [welcome, setWelcome] = useState<string | null>(null);
  // First visit after onboarding on the Jobs tab: start a source check once and say so. (The Startups tab does its own.)
  useEffect(() => {
    if (sp.get("welcome") !== "1" || sp.get("tab") === "startups") return;
    router.replace("/discover");
    api("/api/discover", { method: "POST" }).then((r) => {
      if (!r.ok) return setWelcome(null);
      setWelcome(r.data?.upToDate ? "Welcome! These are matched to your profile from our latest source check." : "Welcome! We're checking sources for you now. New results appear here on their own.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-5">
      <PageHeader
        art="/illustrations/3d/pin.png"
        title="Discover"
        subtitle={tab === "boards" ? "Openings read directly from company career boards, refreshed in the background. Each links to the original application." : tab === "jobs" ? "Individual openings, checked against their original listings and scored against your profile." : "Recently funded companies. A funding round is a signal, not an open role."}
      />
      {welcome && <Banner tone="info">{welcome}</Banner>}
      <Tabs value={tab} onValueChange={(v) => router.replace(v === "startups" ? "/discover?tab=startups" : v === "boards" ? "/discover?tab=boards" : "/discover")}>
        <TabsList aria-label="Discover" className="h-10">
          <TabsTrigger value="jobs" className="px-5">Jobs</TabsTrigger>
          <TabsTrigger value="boards" className="px-5">Company boards</TabsTrigger>
          <TabsTrigger value="startups" className="px-5">Startups</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "boards" ? <CityJobsFeed /> : tab === "jobs" ? <JobsTab /> : <StartupsDirectory embedded />}
    </div>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="cards" count={6} />}>
      <Discover />
    </Suspense>
  );
}
