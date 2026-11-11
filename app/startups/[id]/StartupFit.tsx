"use client";
import { AskButton } from "@/components/career-ai/AskButton";

/** On-click only: nothing is requested until the button is pressed. */
export function StartupFit({ startupId, name }: { startupId: number; name: string }) {
  return (
    <AskButton mode="startup_fit" startupId={startupId} label="Relevant experience" title={`Your relevant experience for ${name}`} description="Drawn only from your own projects and documents, with sources." />
  );
}
