import Link from "next/link";
import type { StartupView } from "@/lib/types";
import { SendIcon } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button";

/** Plain link to the full-page outreach editor (no client state needed). */
export function StartupOutreachAction({ startup }: { startup: StartupView }) {
  const topJob = startup.jobs[0] ?? null;
  return (
    <Link href={`/outreach/${startup.id}${topJob ? `?jobId=${topJob.id}` : ""}`} className={buttonVariants()}>
      <SendIcon /> Reach out
    </Link>
  );
}
