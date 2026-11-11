import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/Landing";
import { currentUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Jyntra: find the startups hiring for you" },
  description: "Recently funded startups, jobs scored against your skills, funding news and an AI assistant that answers from your own work, with sources.",
};

export default async function Home() {
  // People who already have a profile go straight to the app; everyone else sees the landing page.
  if (await currentUser().catch(() => null)) redirect("/dashboard");
  return <Landing />;
}
