"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, jsonBody } from "@/components/api";
import { Banner } from "@/components/Banner";
import { SettingsSkeleton } from "@/components/skeletons";
import { INFO_LINKS } from "@/components/info-links";
import { PageHeader } from "@/components/PageHeader";
import { SourceDiagnostics } from "@/components/SourceDiagnostics";
import { AlertCircleIcon, ArrowRightIcon, CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, GithubIcon, GlobeIcon, LinkedinIcon, LinkIcon, Loader2Icon, LogOutIcon, MailIcon, MediumIcon, PencilIcon, SaveIcon, UserRoundIcon } from "@/components/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

interface Me {
  user: { id: number; profile: Record<string, any>; linkCreatedAt: string | null; memberSince?: string | null; email?: string | null; googleLinked?: boolean };
  queries: string[];
  canonicalSkills: string[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <Badge key={s} variant="secondary" className="h-6 px-2.5 text-[13px]">
          {s}
        </Badge>
      ))}
    </div>
  );
}

function IconInput({ id, icon, label, ...props }: { id: string; icon: React.ReactNode; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">{icon}</span>
        <Input id={id} className="pl-9" {...props} />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"profile" | "links" | "integrations" | "account" | "data">("profile");
  useEffect(() => { const h = window.location.hash.slice(1); if (["profile","links","integrations","account","data"].includes(h)) setTab(h as any); }, []);
  const [me, setMe] = useState<Me | null>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "manual">("no");
  const [error, setError] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  // The link exists only after the user asks for it (the server keeps just a hash, so it can't be shown again).
  const [link, setLink] = useState<string | null>(null);
  const [makingLink, setMakingLink] = useState(false);

  // Candidate socials (used to personalise outreach)
  const [githubUrl, setGithubUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [mediumUrl, setMediumUrl] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [bio, setBio] = useState("");
  const [savingSocial, setSavingSocial] = useState(false);
  const [socialSaved, setSocialSaved] = useState(false);

  // Gmail (send outreach from your own inbox)
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPass, setGmailPass] = useState(""); // only ever holds what the user types now
  const [gmailHasPass, setGmailHasPass] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [savingGmail, setSavingGmail] = useState(false);
  const [gmailSaved, setGmailSaved] = useState(false);

  async function load() {
    const { ok, status, data, error } = await api<Me>("/api/me");
    if (status === 401) return router.replace("/onboarding");
    if (!ok) return setError(error);
    setError(null);
    setMe(data);
    const p = data.user.profile;
    setGithubUrl(p.github_url ?? "");
    setLinkedinUrl(p.linkedin_url ?? "");
    setMediumUrl(p.medium_url ?? "");
    setPortfolioUrl(p.portfolio_url ?? "");
    setBio(p.bio ?? "");
    setGmailUser(p.gmail_user ?? "");
    setGmailPass("");
    setGmailHasPass(!!p.gmail_app_password_set);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me)
    return error ? (
      <Banner
        tone="error"
        action={
          <Button size="sm" variant="outline" onClick={load}>
            Try again
          </Button>
        }
      >
        {error}
      </Banner>
    ) : (
      <SettingsSkeleton />
    );

  const p = me.user.profile;
  const hadLink = !!me.user.linkCreatedAt;

  async function makeLink() {
    if (hadLink && !link && !confirm("This replaces your current private link. The old one will stop working. Continue?")) return;
    setMakingLink(true);
    const { ok, data, error } = await api<{ token: string }>("/api/me/link", { method: "POST" });
    setMakingLink(false);
    if (!ok || !data?.token) return setError(error ?? "Couldn't create a link.");
    setError(null);
    setCopied("no");
    setLink(`${window.location.origin}/api/me/link?t=${data.token}`);
    setMe((m) => (m ? { ...m, user: { ...m.user, linkCreatedAt: new Date().toISOString() } } : m));
  }
  const years = Number(p.tech_experience_years ?? 0);
  const gmailConnected = !!(p.gmail_user && p.gmail_app_password_set);

  async function saveProfile(extra: Record<string, unknown>, setBusy: (b: boolean) => void, setDone: (b: boolean) => void) {
    setBusy(true);
    setDone(false);
    const { ok, error } = await api("/api/me", { method: "PUT", ...jsonBody({ ...p, ...extra }) });
    setBusy(false);
    if (!ok) return setError(error);
    setError(null);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
    // Mirror what was just stored, so the setup bar and summary always reflect saved data (never unsaved typing).
    const { gmail_app_password: pw, ...stored } = extra as Record<string, unknown> & { gmail_app_password?: string };
    setMe((m) => (m ? { ...m, user: { ...m.user, profile: { ...m.user.profile, ...stored, ...(pw ? { gmail_app_password_set: true } : {}) } } } : m));
  }
  const saveSocial = () =>
    saveProfile({ github_url: githubUrl, linkedin_url: linkedinUrl, medium_url: mediumUrl, portfolio_url: portfolioUrl, bio }, setSavingSocial, setSocialSaved);
  const saveGmail = () => saveProfile({ gmail_user: gmailUser, gmail_app_password: gmailPass }, setSavingGmail, setGmailSaved);

  async function startOver() {
    const { ok, error } = await api("/api/me", { method: "DELETE" });
    if (!ok) {
      setConfirmSignOut(false);
      return setError(error);
    }
    try {
      localStorage.removeItem("dsf.filters.v1");
    } catch {}
    router.replace("/onboarding");
  }

  // Setup progress comes from what is SAVED on the account (me), not from half-typed form fields.
  const steps = [
    { label: "Skills", done: (me.canonicalSkills?.length ?? 0) > 0 },
    { label: "Outreach links", done: !!(p.github_url || p.linkedin_url || p.portfolio_url || p.medium_url) },
    { label: "Gmail", done: !!(p.gmail_user && p.gmail_app_password_set) },
    { label: "Google account", done: !!me.user.googleLinked },
  ];
  const doneN = steps.filter((x) => x.done).length;
  const nextStep = steps.find((x) => !x.done);
  const accountLine = me.user.email ? me.user.email : me.user.googleLinked ? "Google account linked" : "Signed in on this device only";
  const initials = ((me?.user?.profile?.name || "J").trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join("")) || "J";

  return (
    <div className="space-y-6">
      <PageHeader
        art="/illustrations/3d/profile.png"
        eyebrow="Profile & settings"
        title="Your profile"
        subtitle="We match startups and jobs using what's on this page."
        actions={
          <Link href="/onboarding" className={buttonVariants()}>
            <PencilIcon /> Edit profile
          </Link>
        }
      />

      <section aria-label="Profile summary" className="grid items-center gap-5 border-b border-border pb-6 sm:grid-cols-[auto_1fr_auto]">
        <span aria-hidden className="flex size-16 items-center justify-center rounded-md bg-foreground font-heading text-2xl font-extrabold text-background">{initials}</span>
        <div className="min-w-0">
          <p className="display truncate text-2xl">{me?.user?.profile?.name || "Your profile"}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{accountLine}{me?.user?.memberSince ? ` · Member since ${new Date(me.user.memberSince).toLocaleDateString("en", { month: "short", year: "numeric" })}` : ""}</p>
        </div>
        <div className="sm:w-56" aria-label={`${doneN} of 4 setup steps done`}>
          <div className="mb-1.5 flex justify-between font-mono text-[11px] text-muted-foreground"><span>Setup</span><span>{doneN}/4</span></div>
          <div className="flex gap-1">{steps.map((x) => <span key={x.label} title={`${x.label}: ${x.done ? "done" : "not yet"}`} className={cn("h-1.5 flex-1 rounded-full", x.done ? "bg-forest" : "bg-border")} />)}</div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{nextStep ? `Next: ${nextStep.label}` : "Everything is set up"}</p>
        </div>
      </section>

      {error && (
        <Banner tone="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <div role="tablist" aria-label="Settings sections" aria-orientation="vertical" className="flex gap-1 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:self-start lg:overflow-visible">
          {([["profile","Profile"],["links","Outreach links"],["integrations","Integrations"],["account","Account & access"],["data","Data sources"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); history.replaceState(null, "", `#${k}`); }}
              className={cn("shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring lg:border-l-2 lg:rounded-l-none", tab === k ? "bg-secondary text-foreground lg:border-accent-brand" : "text-muted-foreground hover:text-foreground lg:border-transparent")}>{l}</button>
          ))}
        </div>
        <div role="tabpanel" className="flex min-w-0 max-w-3xl flex-col gap-6">
        <div className="contents">
          <Card id="profile" className={cn("scroll-mt-20", tab !== "profile" && "hidden")}>
            <CardHeader>
              <div className="flex items-center gap-4">
                <Avatar className="size-14 rounded-full">
                  <AvatarFallback className="text-xl">{(p.name as string | undefined)?.trim()?.[0]?.toUpperCase() ?? <UserRoundIcon className="size-6" />}</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-xl">{p.name || "Student"}</CardTitle>
                  <CardDescription>{p.explorer ? "Exploring, no skills added yet" : years === 0 ? "Fresher" : `About ${years} year${years === 1 ? "" : "s"} of experience`}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="divide-y">
              {p.explorer ? (
                <Alert>
                  <AlertCircleIcon />
                  <AlertDescription>
                    You skipped the setup, so you&apos;re seeing recently funded startups without personal matches.{" "}
                    <Link href="/onboarding" className="inline-flex items-center gap-1 font-semibold text-foreground underline">
                      Add your skills <ArrowRightIcon className="size-3.5" />
                    </Link>
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Section title="Roles you want">
                    <Chips items={p.target_roles ?? []} empty="No roles picked" />
                  </Section>
                  <Section title="Where you want to work">
                    <Chips items={p.preferred_locations ?? []} empty="Anywhere" />
                  </Section>
                  <Section title="Kinds of startup">
                    <Chips items={p.preferred_startup_types ?? []} empty="Any kind" />
                  </Section>
                  <Section title={`Skills we recognise (${me.canonicalSkills.length})`}>
                    <Chips items={me.canonicalSkills} empty="No skills yet. Add some so we can match you." />
                  </Section>
                </>
              )}
            </CardContent>
          </Card>

          <Card id="links" className={cn("scroll-mt-20", tab !== "links" && "hidden")}>
            <CardHeader>
              <CardTitle>Links used in your outreach</CardTitle>
              <CardDescription>Added to the cold emails and DMs we draft for you.</CardDescription>
              <CardAction className="hidden sm:block">
                <Button onClick={saveSocial} disabled={savingSocial}>
                  {savingSocial ? <Loader2Icon className="animate-spin" /> : socialSaved ? <CheckIcon /> : <SaveIcon />}
                  {savingSocial ? "Saving…" : socialSaved ? "Saved" : "Save links"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <IconInput id="github" label="GitHub" icon={<GithubIcon />} type="url" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/username" />
                <IconInput id="linkedin" label="LinkedIn" icon={<LinkedinIcon />} type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/username" />
                <IconInput id="medium" label="Writing (Medium, Substack, blog)" icon={<MediumIcon />} type="url" value={mediumUrl} onChange={(e) => setMediumUrl(e.target.value)} placeholder="https://medium.com/@username" />
                <IconInput id="portfolio" label="Portfolio or website" icon={<GlobeIcon />} type="url" value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="https://yourportfolio.dev" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">Short pitch and key achievements</Label>
                <Textarea id="bio" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="e.g. Built a campus placement app used by 500 students; open-source contributor; learning agentic systems." />
              </div>
            </CardContent>
            <CardFooter className="sm:hidden">
              <Button className="w-full" size="lg" onClick={saveSocial} disabled={savingSocial}>
                {savingSocial ? <Loader2Icon className="animate-spin" /> : socialSaved ? <CheckIcon /> : <SaveIcon />}
                {savingSocial ? "Saving…" : socialSaved ? "Saved" : "Save links"}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="contents">
          <Card id="gmail" className={cn("scroll-mt-20", tab !== "integrations" && "hidden")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MailIcon /> Gmail
              </CardTitle>
              <CardDescription>Send outreach from your own inbox. Messages appear in your Gmail Sent folder.</CardDescription>
              <CardAction>
                <Badge variant={gmailConnected ? "success" : "secondary"}>{gmailConnected ? "Connected" : "Not connected"}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <IconInput id="gmail-user" label="Your Gmail address" icon={<MailIcon />} type="email" value={gmailUser} onChange={(e) => setGmailUser(e.target.value)} placeholder="you@gmail.com" autoComplete="email" />
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="gmail-pass">App password (16 characters)</Label>
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center text-xs font-medium underline hover:text-muted-foreground">
                    Create one
                  </a>
                </div>
                <div className="relative">
                  <Input id="gmail-pass" type={showPass ? "text" : "password"} value={gmailPass} onChange={(e) => setGmailPass(e.target.value)} placeholder={gmailHasPass ? "Saved — type to replace" : "xxxx xxxx xxxx xxxx"} className="pr-10" autoComplete="off" />
                  <Button type="button" variant="ghost" size="icon-sm" className="absolute top-1/2 right-1 -translate-y-1/2" onClick={() => setShowPass(!showPass)} aria-label={showPass ? "Hide password" : "Show password"}>
                    {showPass ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </div>
              </div>
              <Button className="w-full" size="lg" onClick={saveGmail} disabled={savingGmail || !gmailUser}>
                {savingGmail ? <Loader2Icon className="animate-spin" /> : gmailSaved ? <CheckIcon /> : <SaveIcon />}
                {savingGmail ? "Saving…" : gmailSaved ? "Saved" : "Save Gmail settings"}
              </Button>
            </CardContent>
          </Card>

          <Card id="account" className={cn("scroll-mt-20", tab !== "account" && "hidden")}>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>
                {me.user.googleLinked ? "Signed in with Google. Sign in the same way on any device to get your data back." : "You're using Jyntra without an account. Sign in with Google to keep your data safe across devices."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {me.user.googleLinked ? (
                <p className="text-sm">Google account: <b className="break-all">{me.user.email}</b></p>
              ) : (
                <Button asChild variant="outline"><a href="/api/auth/google/start?next=/settings">Sign in with Google</a></Button>
              )}
              <p className="text-xs text-muted-foreground">Signing in only shares your name and verified email. It does not give Jyntra access to your Gmail.</p>
            </CardContent>
          </Card>

          <Card id="private-link" className={cn("scroll-mt-20", tab !== "account" && "hidden")}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon /> Your private link
              </CardTitle>
              <CardDescription>
                There&apos;s no password. Your profile is saved in this browser. Open this link on your phone or another laptop to get your profile, saved startups and applications there too.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {link ? (
                <>
                  <div className="flex gap-2">
                    <Input ref={linkRef} readOnly value={link} aria-label="Your private link" className="min-w-0 flex-1 text-xs" onFocus={(e) => e.target.select()} />
                    <Button
                      variant="outline"
                      size="lg"
                      className="shrink-0"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(link);
                          setCopied("yes");
                          setTimeout(() => setCopied("no"), 1500);
                        } catch {
                          // Clipboard blocked (e.g. plain http on a LAN address): select it so Ctrl+C works.
                          linkRef.current?.focus();
                          linkRef.current?.select();
                          setCopied("manual");
                        }
                      }}
                    >
                      {copied === "yes" ? <CheckIcon className="text-success" /> : <CopyIcon />}
                      {copied === "yes" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  {copied === "manual" && <p className="text-xs font-medium">Link selected. Press Ctrl+C (or Cmd+C) to copy it.</p>}
                  <p className="text-xs text-muted-foreground">Copy it now: for your safety it can&apos;t be shown again after you leave this page.</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {hadLink
                    ? "You already made a private link. It can't be shown again, but you can make a new one (the old link then stops working)."
                    : "You haven't made a private link yet."}
                </p>
              )}
              <Button variant="outline" onClick={makeLink} disabled={makingLink}>
                {makingLink ? <Loader2Icon className="animate-spin" /> : <LinkIcon />}
                {hadLink || link ? "Get a new private link" : "Get my private link"}
              </Button>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertCircleIcon className="mt-px size-3.5 text-warning" />
                Keep it private. Anyone with this link can open your profile.
              </p>
              <Separator />
              <Button variant="ghost" className="-ml-2 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmSignOut(true)}>
                <LogOutIcon /> Sign out on this device
              </Button>
            </CardContent>
          </Card>
        </div>
        {tab === "data" && <SourceDiagnostics />}
        </div>
      </div>

      <nav aria-label="About Jyntra" className="flex flex-wrap gap-x-1 gap-y-1 text-sm text-muted-foreground">
        {INFO_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex min-h-10 items-center rounded-md px-3 hover:bg-muted hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>

      <Dialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out on this device?</DialogTitle>
            <DialogDescription>
              {hadLink
                ? "You can come back using your private link."
                : "You haven't made a private link yet, so after signing out you can't get back to this profile. Make one first."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" onClick={startOver}>
              <LogOutIcon /> Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
