import type { Metadata } from "next";
import { CareerNav } from "@/components/career-ai/CareerNav";
import { Workspace } from "@/components/career-ai/Workspace";

export const metadata: Metadata = { title: "Atlas" };

export default function CareerAiPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border pb-3"><div className="flex items-baseline gap-3"><h1 className="display text-3xl">Atlas</h1><p className="hidden text-sm text-muted-foreground md:block">Your career knowledge, answered with sources.</p></div><CareerNav /></div>
      <Workspace />
    </div>
  );
}
