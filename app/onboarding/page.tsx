"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SKILL_DICTIONARY } from "@/lib/matching/skills";
import { ROLE_OPTIONS, STARTUP_TYPE_OPTIONS } from "@/lib/resume/parse";
import { LOCATION_OPTIONS } from "@/lib/types";
import { api } from "@/components/api";
import { Chip } from "@/components/Chip";
import { AlertCircleIcon, ArrowLeftIcon, ArrowRightIcon, CancelIcon, CheckIcon, CircleCheckIcon, GithubIcon, InfoIcon, LinkedinIcon, Loader2Icon, MinusSignIcon, PlusIcon, UploadCloudIcon } from "@/components/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const ALL_SKILLS = Object.keys(SKILL_DICTIONARY).sort((a, b) => a.localeCompare(b));
const ALL_ROLES = ROLE_OPTIONS.map((r) => r.role);
const STEPS = ["Your skills", "Roles you want", "Where and what"];

function ChipInput({ id, values, onChange, suggestions, placeholder }: { id?: string; values: string[]; onChange: (v: string[]) => void; suggestions: string[]; placeholder: string }) {
  const [text, setText] = useState("");
  // Best first: exact match, then "starts with", then "contains" — so typing "SQL" + Enter adds SQL, not MySQL.
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const rank = (s: string) => (s.toLowerCase() === q ? 0 : s.toLowerCase().startsWith(q) ? 1 : 2);
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && !values.includes(s))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 6);
  }, [text, suggestions, values]);
  const add = (v: string) => {
    const t = v.trim();
    if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...values, t]);
    setText("");
  };
  return (
    <div>
      {values.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="h-7 gap-1 pr-1 pl-2.5 text-sm">
              {v}
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="size-5 rounded-full">
                <CancelIcon className="size-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(matches[0] && text.trim().length > 1 ? matches[0] : text);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10">
            {matches.map((m) => (
              <Button key={m} type="button" variant="ghost" onClick={() => add(m)} className="w-full justify-start font-normal">
                <PlusIcon className="text-muted-foreground" />
                {m}
              </Button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Press Enter to add.</p>
    </div>
  );
}

/** Shared never-throwing fetch; on failure `d.error` carries the server's message or a friendly fallback. */
async function send(url: string, init: RequestInit): Promise<{ ok: boolean; d: any }> {
  const r = await api(url, init);
  return { ok: r.ok, d: r.ok ? r.data : { ...r.data, error: r.error } };
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [explorer, setExplorer] = useState(false); // skipped earlier; now adding skills for the first time
  const [skipping, setSkipping] = useState(false);
  const [step, setStep] = useState(1);
  const [skills, setSkills] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [years, setYears] = useState<string>("0");
  const [locations, setLocations] = useState<string[]>(["Remote", "Remote - India"]);
  const [types, setTypes] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [upload, setUpload] = useState<{ state: "idle" | "reading" | "done" | "error"; msg?: string }>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Edit mode: prefill from the existing profile.
  useEffect(() => {
    api("/api/me")
      .then(({ ok, data: d }) => {
        if (!ok) return;
        if (!d?.user) return;
        const p = d.user.profile;
        setEditing(true);
        if (p.explorer) {
          setExplorer(true); // keep the blank form: their "profile" is only generic defaults
          return;
        }
        setName(p.name ?? "");
        setGithubUrl(p.github_url ?? "");
        setLinkedinUrl(p.linkedin_url ?? "");
        setSkills([...new Set<string>([...(p.skills ?? []), ...(p.programming_languages ?? []), ...(p.frameworks ?? []), ...(p.databases ?? []), ...(p.ai_ml_skills ?? []), ...(p.libraries ?? []), ...(p.cloud_tools ?? [])])]);
        setRoles(p.target_roles ?? []);
        setYears(String(p.tech_experience_years ?? 0));
        setLocations(p.preferred_locations ?? []);
        setTypes(p.preferred_startup_types ?? []);
      })
      .catch(() => {});
  }, []);

  async function onFile(file: File) {
    setUpload({ state: "reading" });
    const fd = new FormData();
    fd.append("file", file);
    const { ok, d } = await send("/api/resume", { method: "POST", body: fd });
    if (!ok) {
      setUpload({ state: "error", msg: d.error ?? "Couldn't read that file. Try again, or add your skills below." });
      return;
    }
    setSkills((s) => [...new Set([...s, ...d.skills])]);
    setRoles((r) => [...new Set([...r, ...d.roles])]);
    if (d.locations?.length) setLocations((l) => [...new Set([...l, ...d.locations.filter((x: string) => (LOCATION_OPTIONS as readonly string[]).includes(x))])]);
    if (d.experienceYears != null) setYears(String(d.experienceYears));
    setUpload({ state: "done", msg: `Found ${d.skills.length} skills and ${d.roles.length} likely roles. Check them below and remove anything that's wrong.` });
  }

  /** No skills yet: browse recently funded startups now, add skills later. */
  async function skip() {
    setError(null);
    setSkipping(true);
    const { ok, d } = await send("/api/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ explore: true }) });
    if (!ok) {
      setSkipping(false);
      setError(d.error ?? "Couldn't continue. Please try again.");
      return;
    }
    try {
      localStorage.removeItem("dsf.filters.v1");
    } catch {}
    router.push("/startups?welcome=1");
  }

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setError(null);
    setSaving(true);
    const { ok, d } = await send("/api/me", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, skills, target_roles: roles, tech_experience_years: Number(years), preferred_locations: locations, preferred_startup_types: types, github_url: githubUrl, linkedin_url: linkedinUrl }),
    });
    setSaving(false);
    if (!ok) {
      setError(d.error ?? "Couldn't save your profile. Please try again in a moment.");
      return;
    }
    try {
      localStorage.removeItem("dsf.filters.v1"); // let the dashboard pick up the new preferences
    } catch {}
    router.push(editing && !explorer ? "/discover" : "/discover?welcome=1");
  }

  const canNext = step === 1 ? skills.length > 0 : step === 2 ? roles.length > 0 : locations.length > 0;

  const yearsNum = Math.max(0, Number(years) || 0);
  const setYearsNum = (n: number) => setYears(String(Math.min(40, Math.max(0, Math.round(n * 2) / 2))));

  return (
    <div className="mx-auto max-w-2xl sm:py-2">
      <Input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {editing && !explorer ? (
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Edit your profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Changes update your matches straight away.</p>
        </div>
      ) : (
        <div className="mb-8">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance sm:text-4xl">Find startup jobs that fit you</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">Tell us your skills once. We match you with open jobs at startups, show where each listing came from and when it was last checked, and explain why each one fits.</p>
          {params.get("link") === "invalid" && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircleIcon />
              <AlertDescription>That private link doesn&apos;t work anymore. Set up a new profile below.</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Step indicator */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">{STEPS[step - 1]}</span>
          <span className="text-muted-foreground">
            Step {step} of {STEPS.length}
          </span>
        </div>
        <Progress value={(step / STEPS.length) * 100} className="mt-2" aria-label={`Step ${step} of ${STEPS.length}`} />
      </div>

      <Card className="gap-0 py-0">
        <CardContent className="p-5 sm:p-7">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.state === "reading"} className="h-auto w-full flex-col gap-2 border-dashed py-7 whitespace-normal">
                  <span className="flex size-11 items-center justify-center rounded-lg bg-muted">{upload.state === "reading" ? <Loader2Icon className="size-5 animate-spin" /> : <UploadCloudIcon className="size-5" />}</span>
                  <span className="text-[15px] font-semibold">{upload.state === "reading" ? "Reading your resume…" : "Upload your resume"}</span>
                  <span className="text-xs font-normal text-muted-foreground">PDF only. We read it once to fill in your skills. The file isn&apos;t saved.</span>
                </Button>
                {upload.msg && (
                  <Alert variant={upload.state === "error" ? "destructive" : "success"} role="status" className="mt-3">
                    {upload.state === "error" ? <AlertCircleIcon /> : <CircleCheckIcon />}
                    <AlertDescription>{upload.msg}</AlertDescription>
                  </Alert>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or add them yourself <span className="h-px flex-1 bg-border" />
              </div>
              <div>
                <Label htmlFor="skills-input" className="text-base font-semibold">
                  Your skills
                </Label>
                <p className="mt-1 mb-3 text-sm text-muted-foreground">Languages, frameworks and tools you&apos;ve used, even in college projects.</p>
                <ChipInput id="skills-input" values={skills} onChange={setSkills} suggestions={ALL_SKILLS} placeholder="e.g. Python, React, SQL" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-base font-semibold">Which roles are you looking for?</h2>
                <p className="mt-0.5 mb-3 text-sm text-muted-foreground">Pick all that fit. You can add your own too.</p>
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...ALL_ROLES, ...roles])].map((r) => (
                    <Chip key={r} size="default" label={r} on={roles.includes(r)} onClick={() => setRoles(toggle(roles, r))} />
                  ))}
                </div>
                <div className="mt-4">
                  <ChipInput values={roles.filter((r) => !ALL_ROLES.includes(r))} onChange={(custom) => setRoles([...roles.filter((r) => ALL_ROLES.includes(r)), ...custom])} suggestions={[]} placeholder="Add another role" />
                </div>
              </div>
              <div>
                <Label htmlFor="years" className="text-base font-semibold">
                  Work experience in tech
                </Label>
                <p className="mt-1 mb-3 text-sm text-muted-foreground">Internships count. Choose 0 if you&apos;re a student or fresher. We use this to flag jobs that are too senior.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-1">
                    <Button type="button" variant="outline" size="icon" onClick={() => setYearsNum(yearsNum - 0.5)} disabled={yearsNum <= 0} aria-label="Less experience">
                      <MinusSignIcon />
                    </Button>
                    <Input
                      id="years"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={40}
                      step={0.5}
                      value={years}
                      onChange={(e) => setYears(e.target.value)}
                      className="w-16 [appearance:textfield] text-center font-semibold tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setYearsNum(yearsNum + 0.5)} aria-label="More experience">
                      <PlusIcon />
                    </Button>
                  </div>
                  <span className="text-sm text-muted-foreground">{yearsNum === 0 ? "years (student / fresher)" : yearsNum === 1 ? "year" : "years"}</span>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-7">
              <div>
                <h2 className="text-base font-semibold">Where do you want to work?</h2>
                <p className="mt-0.5 mb-3 text-sm text-muted-foreground">&ldquo;Remote - India&rdquo; means remote jobs that are open to people in India.</p>
                <div className="flex flex-wrap gap-2">
                  {LOCATION_OPTIONS.filter((l) => l !== "Other").map((l) => (
                    <Chip key={l} size="default" label={l} on={locations.includes(l)} onClick={() => setLocations(toggle(locations, l))} />
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-base font-semibold">What kind of startups interest you?</h2>
                <p className="mt-0.5 mb-3 text-sm text-muted-foreground">Optional. Leave empty to see every kind.</p>
                <div className="flex flex-wrap gap-2">
                  {STARTUP_TYPE_OPTIONS.map((t) => (
                    <Chip key={t} size="default" label={t === "AI" ? "AI startups" : t} on={types.includes(t)} onClick={() => setTypes(toggle(types, t))} />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name" className="text-base font-semibold">
                  Your first name <span className="text-sm font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Only you will see this" autoComplete="given-name" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="github">
                    <GithubIcon /> GitHub <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input id="github" type="url" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="linkedin">
                    <LinkedinIcon /> LinkedIn <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input id="linkedin" type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/username" />
                </div>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">GitHub and LinkedIn are only used to personalise the outreach messages we draft for you.</p>
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mt-5">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-3 p-5 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            {step === 1 ? (
              !editing ? (
                <Button type="button" variant="ghost" onClick={skip} disabled={skipping}>
                  {skipping ? "Opening…" : "Skip for now"}
                </Button>
              ) : (
                <span />
              )
            ) : (
              <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                <ArrowLeftIcon /> Back
              </Button>
            )}
            {step < 3 ? (
              <Button type="button" size="lg" disabled={!canNext} onClick={() => setStep(step + 1)}>
                Next <ArrowRightIcon />
              </Button>
            ) : (
              <Button type="button" size="lg" disabled={!canNext || saving} onClick={save}>
                {saving && <Loader2Icon className="animate-spin" />}
                {saving ? "Saving…" : editing && !explorer ? "Save changes" : "Show my jobs"}
                {!saving && !(editing && !explorer) && <ArrowRightIcon />}
              </Button>
            )}
          </div>
          {!canNext && <p className="text-right text-xs text-muted-foreground">{step === 1 ? "Add at least one skill to continue." : step === 2 ? "Pick at least one role to continue." : "Pick at least one location to continue."}</p>}
        </CardFooter>
      </Card>

      {!editing && !explorer && (
        <p className="mt-5 text-center text-sm text-muted-foreground">
          No skills yet?{" "}
          <Button type="button" variant="link" onClick={skip} disabled={skipping} className="h-auto p-0">
            Explore recently funded startups first
          </Button>
        </p>
      )}
      {!editing && !explorer && (
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Already have an account? <a href="/login" className="font-medium text-foreground underline underline-offset-2">Sign in with Google</a>
        </p>
      )}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <InfoIcon className="size-3.5" />
        No sign-up needed. Your profile is saved in this browser, with a private link to open it elsewhere.
      </p>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
