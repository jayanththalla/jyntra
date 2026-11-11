"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { StartupView } from "@/lib/types";
import { ArrowRightIcon, CancelIcon, CheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "dsf.gettingStarted.dismissed";

/**
 * First-run checklist on the dashboard. Each step has its own call to action and ticks itself off
 * from real data (saved startups, tracked applications). Hidden once done or dismissed.
 */
export function GettingStarted({ startups, onShowBest }: { startups: StartupView[]; onShowBest: () => void }) {
  const [dismissed, setDismissed] = useState(true); // assume hidden until we've read storage (no flash)
  const [reviewed, setReviewed] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
      setReviewed(localStorage.getItem(DISMISS_KEY + ".reviewed") === "1");
      setCopiedLink(localStorage.getItem(DISMISS_KEY + ".link") === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const apps = startups.flatMap((s) => s.applications);
  const saved = apps.length > 0;
  const tracked = apps.some((a) => ["Applied", "Interview", "Offer"].includes(a.status));
  const hasMatches = startups.some((s) => s.relevant_jobs > 0);

  const mark = (key: string, set: (v: boolean) => void) => {
    set(true);
    try {
      localStorage.setItem(DISMISS_KEY + key, "1");
    } catch {}
  };

  const steps = [
    {
      done: reviewed,
      title: "See your best match",
      body: "See the startup whose jobs fit your profile best.",
      cta: hasMatches ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto min-h-6 p-0"
          onClick={() => {
            mark(".reviewed", setReviewed);
            onShowBest();
          }}
        >
          Show me <ArrowRightIcon />
        </Button>
      ) : null,
    },
    { done: saved, title: "Save a startup", body: "Tap Save on any card to add it to your Applications list.", cta: null },
    {
      done: tracked,
      title: "Track an application",
      body: "After you apply, mark it as Applied so you remember to follow up.",
      cta: (
        <Button asChild variant="link" size="sm" className="h-auto min-h-6 p-0">
          <Link href="/applications">
            Open Applications <ArrowRightIcon />
          </Link>
        </Button>
      ),
    },
    {
      done: copiedLink,
      title: "Keep your private link",
      body: "Use it to open your profile on your phone or another laptop.",
      cta: (
        <Button asChild variant="link" size="sm" className="h-auto min-h-6 p-0">
          <Link href="/settings" onClick={() => mark(".link", setCopiedLink)}>
            Get my link <ArrowRightIcon />
          </Link>
        </Button>
      ),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done); // phones show only this one, so startups stay near the top
  if (dismissed || doneCount === steps.length) return null;

  return (
    <Card aria-labelledby="first-steps">
      <CardHeader>
        <CardTitle id="first-steps" className="flex items-baseline gap-3">
          Your first steps
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {doneCount} of {steps.length} done
          </span>
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide first steps"
            title="Hide"
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {}
            }}
          >
            <CancelIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className={cn("gap-3", i === next ? "flex" : "hidden sm:flex")}>
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", s.done ? "bg-success text-background" : "border text-muted-foreground")}>
                {s.done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0">
                <div className={cn("text-sm font-semibold", s.done && "text-muted-foreground line-through")}>{s.title}</div>
                {!s.done && (
                  <>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{s.body}</p>
                    {s.cta && <div className="mt-1">{s.cta}</div>}
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
