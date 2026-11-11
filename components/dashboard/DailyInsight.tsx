import Link from "next/link";
import { ArrowRightIcon, LightbulbIcon } from "@/components/icons";

export interface InsightInput { completed: number; best: number | null; avg: number | null; saved: number | null; followupsDue: number; contributions: { title: string; href: string } | null; atlasDocs: number }

/** Picks ONE next step from the person's own numbers. No made-up facts: every line is derived from what is on the dashboard. */
export function pickInsight(i: InsightInput): { title: string; body: string; href: string; cta: string } {
  if (i.followupsDue > 0) return { title: `${i.followupsDue} follow-up${i.followupsDue === 1 ? " is" : "s are"} due`, body: "A short, specific follow-up is the cheapest way to move an application forward.", href: "/applications", cta: "Open applications" };
  if (i.contributions) return { title: "Pick up where you left off", body: `You have an open-source issue in progress: ${i.contributions.title}`, href: i.contributions.href, cta: "Continue" };
  if (i.atlasDocs === 0) return { title: "Give Atlas something to read", body: "Connect GitHub or add your résumé so answers and interview questions use your real projects.", href: "/career-ai", cta: "Add a source" };
  if (i.completed === 0) return { title: "Do one practice interview", body: "Five questions, a score on each answer and a report. It takes about 15 minutes.", href: "/mock-interview", cta: "Start" };
  if (i.saved) return { title: "Show your work, don't just DM", body: "Pick a saved startup, build a small piece around a problem they have, and send that to the team instead of a cold message.", href: "/applications", cta: "Choose a startup" };
  if (i.avg != null && i.avg < 75) return { title: `Your average is ${Math.round(i.avg)}/100`, body: "Retry the answers you scored lowest on; practice mode lets you try again until 75.", href: "/mock-interview", cta: "Practise again" };
  return { title: "Look for new openings", body: "New roles are checked against their original listings. Save the ones that fit.", href: "/discover", cta: "Browse jobs" };
}

export function DailyInsight(props: InsightInput) {
  const t = pickInsight(props);
  return (
    <section aria-label="Today's focus" className="tile flex items-start gap-4 p-5">
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-sun text-[#14122b]"><LightbulbIcon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Today&apos;s focus</p>
        <p className="mt-1 font-heading text-base font-bold leading-snug">{t.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.body}</p>
        <Link href={t.href} className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-indigo hover:underline">{t.cta}<ArrowRightIcon className="size-4" /></Link>
      </div>
    </section>
  );
}
