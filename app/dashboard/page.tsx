import type { Metadata } from "next";
import { HomeModules } from "@/components/dashboard/HomeModules";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// The four product modules. The previous arena-based AnalyticsDashboard (components/AnalyticsDashboard.tsx) is kept, unused,
// so it can come back once there is a genuine live jobs pipeline.
export default function DashboardPage() {
  return <HomeModules />;
}
