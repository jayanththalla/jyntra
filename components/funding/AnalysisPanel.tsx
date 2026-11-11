"use client";
import { useId, useMemo, useState } from "react";
import { api, jsonBody } from "@/components/api";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon, CircleAlertIcon, Loader2Icon, SparklesIcon } from "@/components/icons";
import { storyFacts } from "@/lib/news/story-facts";
import { VERIFICATION_LABELS } from "@/lib/news/taxonomy";
import { cn } from "@/lib/utils";
import { fmtDate, type AnalysisResponse, type Article } from "./types";

/**
 * Two layers, kept visibly apart:
 *  1. "What the story says": plain facts from our stored record, each with its basis. No model involved. Opens instantly.
 *  2. "AI analysis": written by a language model from those facts only, generated on request, labelled as AI everywhere.
 */
export function AnalysisPanel({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ loading: boolean; res?: AnalysisResponse; error?: string }>({ loading: false });
  const facts = useMemo(() => storyFacts(article), [article]);
  const panelId = useId();

  const generate = async (refresh = false) => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const r = await api<AnalysisResponse>("/api/news/analyze", { method: "POST", timeoutMs: 50_000, ...jsonBody({ id: article.id, refresh }) });
    setState(r.ok ? { loading: false, res: r.data } : { loading: false, error: r.status === 429 ? "Too many analysis requests. Wait a few minutes and try again." : r.status === 401 ? "Sign in to use AI analysis." : r.error ?? "Analysis is unavailable right now." });
  };

  const a = state.res?.analysis;
  return (
    <div className="mt-3 border-t border-border/70 pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="-ml-1 inline-flex min-h-8 items-center gap-1.5 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {open ? "Hide breakdown" : "Story breakdown and AI analysis"}
      </button>

      {open && (
        <div id={panelId} className="mt-2 space-y-3">
          <section aria-label="What the story says" className="rounded-lg bg-muted/50 p-3">
            <h4 className="text-xs font-semibold">What the story says</h4>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {VERIFICATION_LABELS[article.verification]}: {facts.verification_note}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              {facts.lines.map((l) => (
                <div key={l.label} className="col-span-2 grid grid-cols-subgrid">
                  <dt className="text-muted-foreground">{l.label}</dt>
                  <dd>
                    <span className="font-medium">{l.value}</span>
                    <span className="block text-[11px] text-muted-foreground">{l.basis}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <ul className="mt-2.5 space-y-1 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
              {facts.gaps.map((g) => (
                <li key={g} className="flex gap-1.5">
                  <CircleAlertIcon className="mt-px size-3 shrink-0" aria-hidden />
                  {g}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="AI analysis" className="rounded-lg border border-dashed border-brand-violet/60 bg-brand-violet/[0.06] p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold">
                <SparklesIcon className="size-3.5 text-accent-brand-foreground" aria-hidden /> AI analysis
              </h4>
              <span className="rounded-full bg-brand-violet/15 px-2 py-0.5 text-[11px] font-medium text-accent-brand-foreground dark:text-accent-brand-foreground">AI-generated</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Written by a language model using only the facts above. It can be wrong or too confident. Check the original article before acting on it.</p>

            <div className="mt-2.5 text-xs" aria-live="polite" aria-busy={state.loading}>
              {state.loading ? (
                <p className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Reading the story…</p>
              ) : a ? (
                <div className="space-y-2.5">
                  <div>
                    <p className="font-medium">Summary</p>
                    <p className="text-muted-foreground">{a.summary}</p>
                  </div>
                  <div>
                    <p className="font-medium">What it may mean for a job seeker</p>
                    <p className="text-muted-foreground">{a.why_it_matters}</p>
                  </div>
                  <div>
                    <p className="font-medium">Check before you act</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{a.check_next.map((c) => <li key={c}>{c}</li>)}</ul>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span>{a.provider === "groq" ? "Groq" : "Gemini"} · {a.cached ? "saved from" : "generated"} {fmtDate(a.generated_at)}</span>
                    <button type="button" onClick={() => generate(true)} className="text-primary underline-offset-2 hover:underline">Generate again</button>
                  </p>
                </div>
              ) : state.res?.status === "not_configured" ? (
                <p className="text-muted-foreground">{state.res.message}</p>
              ) : state.res?.status === "failed" || state.error ? (
                <div className="space-y-2">
                  <p className="text-warning">{state.error ?? state.res?.message}</p>
                  <Button size="sm" variant="outline" onClick={() => generate(true)}>Try again</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => generate()}>
                  <SparklesIcon className="text-accent-brand-foreground" aria-hidden /> Analyse this story
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
