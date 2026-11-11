import type { Metadata } from "next";
import { FormalInterview } from "@/components/interview/FormalInterview";

export const metadata: Metadata = { title: "Formal interview" };
export default function FormalInterviewPage() { return <FormalInterview />; }
