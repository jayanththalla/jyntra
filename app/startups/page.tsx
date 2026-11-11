import type { Metadata } from "next";
import { StartupsDirectory } from "@/components/StartupsDirectory";

export const metadata: Metadata = { title: "Startups" };

export default function StartupsPage() {
  return <StartupsDirectory />;
}
