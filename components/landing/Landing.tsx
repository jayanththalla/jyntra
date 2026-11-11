// Public landing page. Uses only Jyntra's own tokens (violet / indigo / blue on the dark or light theme), no outside colours or images.
// Every claim here matches something the app really does; nothing is a made-up statistic, price or testimonial.
import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "./Reveal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ArrowRightIcon, BriefcaseBusinessIcon, CheckIcon, MailIcon, NewspaperIcon, RocketIcon, ShieldCheckIcon, SparklesIcon, TargetIcon } from "@/components/icons";

const NAV = [["Features", "#features"], ["How it works", "#how"], ["Free to start", "#start"], ["Trust & privacy", "#trust"]] as const;

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-brand-foreground"><span className="size-1.5 rounded-full bg-brand-violet" aria-hidden />{children}</p>;
}
function Heading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-balance text-3xl font-semibold tracking-tight sm:text-5xl ${className}`}>{children}</h2>;
}
const cta = "group inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-ring/60";

/** A small product-style card used inside the hero and feature tiles. Pure markup: it illustrates, it does not pretend to be live data. */
function Chip({ children, tone = "violet" }: { children: ReactNode; tone?: "violet" | "blue" | "muted" }) {
  const t = tone === "blue" ? "bg-brand-blue/15 text-brand-blue" : tone === "violet" ? "bg-brand-violet/15 text-accent-brand-foreground" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${t}`}>{children}</span>;
}

export function Landing() {
  return (
    <div className="relative overflow-x-clip bg-background text-foreground">
      {/* soft brand glow behind the hero */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[640px] bg-[radial-gradient(60%_60%_at_70%_0%,color-mix(in_oklab,var(--brand-violet)_28%,transparent),transparent_70%),radial-gradient(40%_50%_at_10%_10%,color-mix(in_oklab,var(--brand-blue)_20%,transparent),transparent_70%)]" />

      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Jyntra home">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-gradient text-white shadow-sm"><RocketIcon className="size-5" /></span>
            <span className="text-base font-bold tracking-tight">Jyntra</span>
          </Link>
          <nav aria-label="Page sections" className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            {NAV.map(([l, h]) => <a key={h} href={h} className="rounded outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{l}</a>)}
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/demo" className="hidden h-10 items-center rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-flex">Sample demo</Link>
            <Link href="/login" className="hidden h-10 items-center rounded-full px-4 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-flex">Sign in</Link>
            <Link href="/onboarding" className={`${cta} h-10 bg-brand-gradient px-5 text-white shadow-sm hover:opacity-90`}>Get started <ArrowRightIcon className="lp-arrow size-4" /></Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* HERO */}
        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <div className="lp-pop"><Eyebrow>Your next role, found with evidence</Eyebrow></div>
            <h1 className="lp-pop text-balance text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
              Find the startups <span className="text-brand-gradient lp-shimmer">hiring for you.</span>
            </h1>
            <p className="lp-pop mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Jyntra tracks recently funded startups and their open jobs, scores each one against your skills, and gives you an AI assistant that answers from your own projects, with sources.
            </p>
            <div className="lp-pop mt-8 flex flex-wrap items-center gap-3">
              <Link href="/onboarding" className={`${cta} bg-brand-gradient text-white shadow-lg shadow-brand-violet/25 hover:opacity-90`}>Start free <ArrowRightIcon className="lp-arrow size-4" /></Link>
              <a href="#how" className={`${cta} border border-border bg-card/60 text-foreground hover:bg-card`}>See how it works</a>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheckIcon className="size-4 text-accent-brand-foreground" /> No spam. Nothing is emailed until you review and confirm it.</p>
          </div>

          {/* hero mock: Atlas answering with sources + a job match */}
          <div className="lp-float relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
            <div className="lp-glow absolute -inset-4 rounded-[2rem] bg-brand-gradient blur-2xl" />
            <div className="relative rounded-3xl border border-border bg-card p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between text-[11px] font-medium text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="relative flex size-2"><span className="lp-ping absolute inline-flex size-full rounded-full bg-brand-violet" /><span className="relative inline-flex size-2 rounded-full bg-brand-violet" /></span><SparklesIcon className="size-3.5 text-accent-brand-foreground" /> Atlas</span><Chip tone="muted">Answers with sources</Chip></div>
              <div className="lp-pop ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm [animation-delay:.5s]">How do I explain my strongest backend project?</div>
              <div className="lp-pop mt-3 space-y-2 text-sm leading-relaxed [animation-delay:.9s]">
                <p>You built an API with FastAPI and Redis queues to cut response latency, then added role-based access.<sup className="ml-1 rounded-full bg-brand-violet/15 px-1.5 text-[10px] font-semibold text-accent-brand-foreground">1</sup></p>
                <div className="rounded-xl border border-border bg-background/60 p-3 text-xs text-muted-foreground"><span className="font-semibold text-foreground">[1] README · your repository</span><br />Shown so you can check every claim.</div>
                <p className="text-[10px] text-muted-foreground">Illustration with example content, not real data.</p>
              </div>
              <div className="lp-pop mt-4 grid grid-cols-2 gap-3 [animation-delay:1.3s]">
                <div className="rounded-2xl border border-border bg-background/60 p-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold">Backend Engineer</span><Chip tone="blue">Match</Chip></div>
                  <div className="mt-3 h-1.5 rounded-full bg-muted"><div className="lp-grow h-full w-[82%] rounded-full bg-brand-gradient [animation-delay:1.6s]" /></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Example: skills, role and location fit</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 p-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold">Funding news</span><Chip>Confirmed</Chip></div>
                  <p className="mt-2 text-[11px] leading-snug text-muted-foreground">Seed round · investors named · also reported by 2 outlets</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* strip */}
        <div className="border-y border-border/60 bg-card/40">
          <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-4 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:px-6">
            <li>Funded startups, one place</li><li aria-hidden>·</li><li>Matches that show their reasons</li><li aria-hidden>·</li><li>You stay in control</li>
          </ul>
        </div>

        {/* FEATURES */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <Reveal><div className="mx-auto max-w-2xl text-center">
            <Eyebrow>A toolkit for what&apos;s next</Eyebrow>
            <Heading>Small steps. <span className="text-brand-gradient">Big momentum.</span></Heading>
            <p className="mt-4 text-muted-foreground">Everything between &ldquo;who is hiring?&rdquo; and &ldquo;I sent a great application&rdquo;, in one workspace.</p>
          </div></Reveal>
          <div className="mt-14 grid gap-5 md:grid-cols-2">
            <Feature delay={0} icon={<NewspaperIcon />} kicker="Funding news" title="Know who just raised" body="Stories from Indian and global outlets, sorted into confirmed raises and unconfirmed reports, merged when several outlets cover the same round.">
              <div className="space-y-2 text-xs">
                {[["Zyro raises $5 Mn Seed", "Confirmed"], ["NoBroker in talks to raise", "Planned"]].map(([t, k]) => (
                  <div key={t} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background/60 px-3 py-2"><span className="truncate font-medium">{t}</span><Chip tone={k === "Confirmed" ? "violet" : "muted"}>{k}</Chip></div>
                ))}
                <p className="px-1 text-[11px] text-muted-foreground">Illustration of the news list.</p>
              </div>
            </Feature>
            <Feature delay={120} icon={<TargetIcon />} kicker="Job matching" title="See why a job fits" body="Every job is scored against your role, skills, location and experience, with the reasons shown. No black-box number.">
              <div className="space-y-3 text-xs">
                {[["Skills", 88], ["Role", 80], ["Location", 70]].map(([l, v]) => (
                  <div key={l as string}><div className="mb-1 flex justify-between"><span>{l}</span><span className="text-muted-foreground">{v}%</span></div><div className="h-1.5 rounded-full bg-muted"><div className="lp-grow h-full rounded-full bg-brand-gradient" style={{ width: `${v}%` }} /></div></div>
                ))}
                <p className="text-[11px] text-muted-foreground">Illustrative example values, not a real score.</p>
              </div>
            </Feature>
            <Feature delay={0} icon={<SparklesIcon />} kicker="Atlas assistant" title="Ask about your own work" body="Connect GitHub or upload your resume. Atlas answers from what you have actually built and shows the source of each claim.">
              <div className="space-y-2 text-xs">
                <div className="w-fit rounded-xl bg-muted px-3 py-1.5">Which project shows my backend skills?</div>
                <div className="rounded-xl border border-border bg-background/60 p-3 text-muted-foreground">Your payments API (FastAPI, Redis) is the strongest evidence. <Chip>Source 1</Chip></div>
              </div>
            </Feature>
            <Feature delay={120} icon={<MailIcon />} kicker="Applications and email" title="Track it, draft it, confirm it" body="Keep every application in one tracker, set follow-up reminders, and draft emails that you review in full before a single send.">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                {[["Saved", 6], ["Applied", 4], ["Interview", 1]].map(([l, n]) => <div key={l as string} className="rounded-xl border border-border bg-background/60 py-3"><div className="text-xl font-semibold">{n}</div><div className="text-[11px] text-muted-foreground">{l}</div></div>)}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Example counts for illustration.</p>
            </Feature>
          </div>
        </section>

        {/* HOW IT WORKS (dark band) */}
        <section id="how" className="scroll-mt-20 bg-[#0d0d15] text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
            <Reveal><div>
              <Eyebrow>A clearer way forward</Eyebrow>
              <h2 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">From &ldquo;where do I start?&rdquo; <span className="text-brand-gradient">to &ldquo;I&apos;ve got a plan.&rdquo;</span></h2>
              <p className="mt-5 max-w-md text-white/70">Start with your skills. Jyntra does the searching and shows its work.</p>
              <Link href="/onboarding" className={`${cta} mt-8 bg-white text-[#09090f] hover:bg-white/90`}>Find your first startup <ArrowRightIcon className="lp-arrow size-4" /></Link>
            </div></Reveal>
            <Reveal delay={150} className="self-center"><ol className="divide-y divide-white/10 border-y border-white/10">
              {[["Tell us your skills", "Pick the roles you want and the skills you have. It takes a minute."], ["See who is hiring", "Recently funded startups and their open jobs, ranked for you with the reasons."], ["Apply with confidence", "Ask Atlas, draft your email, review it, then send. You approve every step."]].map(([t, b], i) => (
                <li key={t} className="flex gap-5 py-6"><span className="text-sm font-semibold text-accent-brand-foreground">0{i + 1}</span><div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-white/65">{b}</p></div></li>
              ))}
            </ol></Reveal>
          </div>
        </section>

        {/* START FREE */}
        <section id="start" className="mx-auto max-w-4xl scroll-mt-20 px-4 py-24 sm:px-6">
          <div className="text-center"><Eyebrow>Simple and clear</Eyebrow><Heading>Free to start. <span className="text-brand-gradient">No card needed.</span></Heading></div>
          <Reveal className="mx-auto mt-12 max-w-xl"><div className="lp-lift rounded-3xl border border-border bg-card p-8 shadow-xl">
            <div className="flex items-baseline justify-between"><h3 className="text-xl font-semibold">What you get</h3><Chip>Available now</Chip></div>
            <ul className="mt-6 space-y-3 text-sm">
              {["Recently funded startups and their open jobs", "Match scores with the reasons shown", "Funding news sorted into confirmed and unconfirmed", "Atlas assistant answering from your own projects and documents", "Application tracker and follow-up reminders", "Email drafts you review before anything is sent"].map((x) => (
                <li key={x} className="flex gap-3"><CheckIcon className="mt-0.5 size-4 shrink-0 text-accent-brand-foreground" />{x}</li>
              ))}
            </ul>
            <Link href="/onboarding" className={`${cta} mt-8 w-full bg-brand-gradient text-white hover:opacity-90`}>Get started free <ArrowRightIcon className="lp-arrow size-4" /></Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">Or <Link href="/login" className="underline underline-offset-2">sign in with Google</Link> to keep your data on every device.</p>
          </div></Reveal>
        </section>

        {/* TRUST */}
        <section id="trust" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 sm:px-6">
          <div className="mx-auto max-w-2xl text-center"><Eyebrow>Built to be trusted</Eyebrow><Heading>AI in your corner. <span className="text-brand-gradient">You in control.</span></Heading></div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              [<ShieldCheckIcon key="a" />, "Your data stays yours", "Connection keys are stored encrypted on the server and never sent back to your browser. Delete everything any time."],
              [<MailIcon key="b" />, "Nothing sends by itself", "Every email is shown in full first. You confirm the recipient and the message, then it goes."],
              [<BriefcaseBusinessIcon key="c" />, "Honest about what it knows", "Answers cite your sources. If your documents don't say it, Atlas says so instead of guessing."],
            ].map(([icon, t, b]) => (
              <Reveal key={t as string} delay={0}><div className="lp-lift h-full rounded-2xl border border-border bg-card p-6"><span className="flex size-10 items-center justify-center rounded-xl bg-brand-violet/15 text-accent-brand-foreground [&_svg]:size-5">{icon}</span><h3 className="mt-4 font-semibold">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b}</p></div></Reveal>
            ))}
          </div>
          <p className="mt-6 text-center text-sm"><Link href="/privacy" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">Read our privacy notice</Link></p>
        </section>

        {/* FINAL CTA */}
        <section className="px-4 pb-24 sm:px-6">
          <Reveal><div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-border bg-card px-6 py-16 text-center">
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,color-mix(in_oklab,var(--brand-violet)_30%,transparent),transparent_70%)]" />
            <div className="relative">
              <Heading>Ready to make your <span className="text-brand-gradient">next move?</span></Heading>
              <p className="mx-auto mt-4 max-w-md text-muted-foreground">Tell Jyntra your skills and see who is hiring today.</p>
              <Link href="/onboarding" className={`${cta} mt-8 bg-brand-gradient px-8 text-white shadow-lg shadow-brand-violet/25 hover:opacity-90`}>Get started <ArrowRightIcon className="lp-arrow size-4" /></Link>
            </div>
          </div></Reveal>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span className="flex items-center gap-2 font-semibold text-foreground"><span className="flex size-7 items-center justify-center rounded-md bg-brand-gradient text-white"><RocketIcon className="size-4" /></span>Jyntra</span>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-5 gap-y-1">
            <Link href="/about" className="hover:text-foreground">About</Link><Link href="/privacy" className="hover:text-foreground">Privacy</Link><Link href="/terms" className="hover:text-foreground">Terms</Link><Link href="/contact" className="hover:text-foreground">Contact</Link>
          </nav>
          <span>© {new Date().getFullYear()} Jyntra</span>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon, kicker, title, body, children, delay = 0 }: { icon: ReactNode; kicker: string; title: string; body: string; children: ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className="h-full">
    <article className="lp-lift flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card hover:border-brand-violet/50 sm:flex-row md:flex-col lg:flex-row">
      <div className="flex-1 p-6">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-violet/15 text-accent-brand-foreground [&_svg]:size-5">{icon}</span>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{kicker}</p>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div aria-hidden className="flex flex-1 items-center bg-gradient-to-br from-brand-blue/10 via-brand-indigo/10 to-brand-violet/15 p-6"><div className="w-full">{children}</div></div>
    </article>
    </Reveal>
  );
}
