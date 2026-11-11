import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { VoiceInterview } from "@/components/voice/VoiceInterview";

export const metadata: Metadata = { title: "Voice interview" };

export default function VoiceInterviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Voice interview" subtitle="Practise interviews and spoken English. Review every transcript before the interviewer sees it." actions={<Link href="/mock-interview" className="text-sm text-primary hover:underline">Written mock interview</Link>} />
      <VoiceInterview />
    </div>
  );
}
