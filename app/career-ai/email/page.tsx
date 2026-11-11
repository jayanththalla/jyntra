import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { CareerNav } from "@/components/career-ai/CareerNav";
import { EmailWorkspace } from "@/components/career-ai/EmailWorkspace";

export const metadata: Metadata = { title: "Email · Atlas" };

export default function EmailPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Email and messages" subtitle="Draft, edit and review. Nothing is sent until you preview the final message and confirm." actions={<CareerNav />} />
      <Suspense fallback={null}><EmailWorkspace /></Suspense>
    </div>
  );
}
