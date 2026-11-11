import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CareerNav } from "@/components/career-ai/CareerNav";
import { WorkflowsWorkspace } from "@/components/career-ai/WorkflowsWorkspace";

export const metadata: Metadata = { title: "Workflows · Atlas" };

export default function WorkflowsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Career workflows" subtitle="Compare your profile with a job, plan what to learn, and turn a project into resume bullets." actions={<CareerNav />} />
      <WorkflowsWorkspace />
    </div>
  );
}
