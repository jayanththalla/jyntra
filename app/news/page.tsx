import type { Metadata } from "next";
import { FundingNews } from "@/components/FundingNews";
import { PageHeader } from "@/components/PageHeader";
import { DataFreshness } from "@/components/DataFreshness";

export const metadata: Metadata = { title: "Funding News" };

export default function NewsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        art="/illustrations/3d/coin.png"
        eyebrow="Funding wire"
        title="Funding news"
        subtitle="Recent startup funding stories, with the source and publication date shown on every item."
      />
      <DataFreshness />
      <FundingNews />
    </div>
  );
}
