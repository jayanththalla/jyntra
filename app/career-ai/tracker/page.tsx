import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CareerNav } from "@/components/career-ai/CareerNav";
import { TrackerWorkspace } from "@/components/career-ai/TrackerWorkspace";

export const metadata: Metadata = { title: "Tracker · Atlas" };

export default function TrackerPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Tracker" subtitle="Where your applications, emails, answers and follow-ups stand. Counts come from your own records." actions={<CareerNav />} />
      <TrackerWorkspace />
    </div>
  );
}
