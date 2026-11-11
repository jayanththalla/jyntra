import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CareerNav } from "@/components/career-ai/CareerNav";
import { ApplicationsWorkspace } from "@/components/career-ai/ApplicationsWorkspace";

export const metadata: Metadata = { title: "Application answers · Atlas" };

export default function ApplicationAnswersPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Application answers" subtitle="Paste a form's questions and get editable first-person answers grounded in your own work." actions={<CareerNav />} />
      <ApplicationsWorkspace />
    </div>
  );
}
