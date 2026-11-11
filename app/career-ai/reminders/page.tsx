import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CareerNav } from "@/components/career-ai/CareerNav";
import { RemindersWorkspace } from "@/components/career-ai/RemindersWorkspace";

export const metadata: Metadata = { title: "Reminders · Atlas" };

export default function RemindersPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Reminders" subtitle="Follow-up reminders shown here in the app. Nothing is emailed or pushed to you automatically." actions={<CareerNav />} />
      <RemindersWorkspace />
    </div>
  );
}
