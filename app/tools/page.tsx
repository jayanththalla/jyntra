import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Career tools" };

const TOOLS = [
  { href: "/career-ai", name: "Atlas", body: "Ask questions answered from your own GitHub, resume and notes, with sources. Job-specific help is also on each job card (\"My fit\")." },
  { href: "/mock-interview", name: "Mock interview", body: "Practice questions generated from your profile, scored by an AI model. Needs an AI key configured on the server." },
  { href: "/open-source", name: "Open source", body: "Beginner issues at startups that publish code. Useful for building evidence before you reach out." },
  { href: "/news", name: "Funding news", body: "Recent funding stories with publisher and date. A funding story is a signal, not an open role." },
  { href: "/hyderabad", name: "Startup directory", body: "A static open dataset of about 1,200 local startups. Secondary: it is not funding or hiring evidence." },
];

export default function ToolsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Career tools" subtitle="Secondary tools. The main workflow is Discover, then Applications." />
      <ul className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:border-brand-violet/50">
                <CardContent className="space-y-1">
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.body}</p>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
