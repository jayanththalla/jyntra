"use client";
// Admin-only source diagnostics. Access is enforced by the API (Bearer JOB_SYNC_SECRET); this page just holds the secret
// in sessionStorage for the tab and sends it as a header. Nothing sensitive is rendered: no tokens, headers or credentials.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Banner } from "@/components/Banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const KEY = "jyntra-admin-secret";
const read = () => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } };

export default function AdminSources() {
  const [secret, setSecret] = useState("");
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  const [form, setForm] = useState({ name: "", url: "", provider: "", slug: "" });
  const headers = useCallback(() => ({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }), [secret]);

  const load = useCallback(async () => {
    const r = await api("/api/admin/ingestion", { headers: headers() });
    if (!r.ok) { setData(null); setMsg({ tone: "error", text: r.status === 401 ? "Wrong admin secret." : r.status === 503 ? "Admin access is not configured on the server (set JOB_SYNC_SECRET)." : r.error ?? "Could not load." }); return; }
    setMsg(null); setData(r.data);
  }, [headers]);
  useEffect(() => { setSecret(read()); }, []);
  useEffect(() => { if (secret) load(); }, [secret, load]);

  const act = async (body: Record<string, unknown>) => {
    const r = await api("/api/admin/ingestion", { method: "POST", headers: headers(), body: JSON.stringify(body) });
    const d: any = r.data;
    setMsg({ tone: r.ok && d.ok !== false ? "info" : "error", text: r.ok ? (d.ok === false ? d.error ?? "Failed" : "Done") : r.error ?? "Failed" });
    load();
  };
  const inspect = async (id: number) => { const r = await api(`/api/admin/ingestion/sources/${id}`, { headers: headers() }); setDetail(r.ok ? r.data : null); };
  useEffect(() => { if (secret && data) api("/api/admin/ingestion/report", { headers: headers() }).then((r) => setRep(r.ok ? r.data : null)); }, [secret, data, headers]);
  const d = data?.diagnostics;

  if (!secret || !data) return (
    <div className="mx-auto max-w-md space-y-3 py-10">
      <h1 className="text-xl font-semibold">Source diagnostics</h1>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <form onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("s") ?? ""); try { sessionStorage.setItem(KEY, v); } catch {} setSecret(v); }} className="space-y-2">
        <Input name="s" type="password" aria-label="Admin secret" placeholder="Admin secret (JOB_SYNC_SECRET)" autoComplete="off" />
        <Button type="submit">Unlock</Button>
      </form>
    </div>
  );
  const stat = (label: string, v: unknown) => <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-semibold">{String(v ?? "–")}</div></div>;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Source diagnostics</h1><Button variant="outline" size="sm" onClick={() => { try { sessionStorage.removeItem(KEY); } catch {} setSecret(""); setData(null); }}>Lock</Button></div>
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat("Discovered candidates", d.companies.discoveredCandidates)}{stat("Validated boards", d.companies.validatedBoards)}{stat("Active sources", d.sources.active)}{stat("Failing sources", d.sources.failing)}
        {stat("Bengaluru jobs / companies", `${d.coverage.bengaluru.jobs} / ${d.coverage.bengaluru.companies}`)}{stat("Hyderabad jobs / companies", `${d.coverage.hyderabad.jobs} / ${d.coverage.hyderabad.companies}`)}{stat("India-remote jobs", d.coverage.indiaRemote.jobs)}{stat("Active jobs", d.jobs.active)}
        {stat("New (24 h)", d.jobs.newLast24h)}{stat("Updated (24 h)", d.jobs.updatedLast24h)}{stat("Closed (24 h)", d.jobs.closedLast24h)}{stat("Checked OK (24 h)", d.sources.checkedLast24h)}
        {stat("Repeated rate limits", d.sources.repeatedRateLimits)}{stat("Missing apply link", d.jobs.missingApplyLink)}{stat("Companies without a board", d.companies.withoutValidatedBoard)}{stat("Last successful sync", when(d.sources.lastSuccessfulSync))}
      </div>
      <p className="text-xs text-muted-foreground">Oldest stale source: {d.sources.oldestStale ? `${d.sources.oldestStale.company} (${d.sources.oldestStale.provider}), last success ${when(d.sources.oldestStale.lastSuccessAt)}` : "none"} · Candidates by state: {Object.entries(d.companies.candidatesByState).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") || "none"}</p>
      {rep && (
        <Card>
          <CardHeader><CardTitle>Discovery &amp; ingestion report</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {stat("Candidates discovered", rep.discovery.candidatesDiscovered)}{stat("Boards validated", rep.discovery.boardsValidated)}{stat("Boards rejected", rep.discovery.boardsRejected)}{stat("Temporarily unavailable", rep.discovery.boardsTemporarilyUnavailable)}{stat("Unsupported provider", rep.discovery.unsupportedProviderBoards)}{stat("Not yet validated", rep.discovery.notYetValidated)}
            </div>
            <table className="w-full text-left"><thead className="text-muted-foreground"><tr><th className="py-1">City</th><th>Companies with active sources</th><th>Companies with live jobs</th><th>Active jobs</th><th>Missing application URL</th></tr></thead>
              <tbody className="divide-y">{(["bengaluru", "hyderabad", "chennai"] as const).map((c) => <tr key={c}><td className="py-1 capitalize">{c}</td><td>{rep.cities[c].companiesWithActiveSources}</td><td>{rep.cities[c].companiesWithLiveJobs}</td><td>{rep.cities[c].activeJobs}</td><td>{rep.cities[c].jobsMissingApplicationUrl}</td></tr>)}
                <tr><td className="py-1">India remote</td><td>–</td><td>{rep.cities.indiaRemote.companiesWithLiveJobs}</td><td>{rep.cities.indiaRemote.activeJobs}</td><td>{rep.cities.indiaRemote.jobsMissingApplicationUrl}</td></tr></tbody></table>
            <p className="text-muted-foreground">Providers: {rep.providerDistribution.map((p: any) => `${p.provider} ${p.activeSources}/${p.sources} (${p.activeJobs} jobs)`).join(", ") || "none"} · Last refresh {when(rep.refresh.lastSuccessfulRefresh)} · Failing sources {rep.sourceFailures.total} · Stale {rep.staleSources.count} · Payload duplicates dropped {rep.duplicates.duplicateRecordsDroppedFromPayloads}</p>
            <p className="text-muted-foreground">Apply links ({rep.applicationLinks.activeJobs} active): missing {rep.applicationLinks.missing}, verified {rep.applicationLinks.verifiedOk}, gone {rep.applicationLinks.gone}, restricted {rep.applicationLinks.restricted}, unreachable {rep.applicationLinks.unreachable}, never checked {rep.applicationLinks.neverChecked}</p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Add a company or board</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-4">
          <Input aria-label="Company name" placeholder="Company name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input aria-label="Careers or ATS URL" placeholder="Careers / ATS URL (https)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="sm:col-span-2" />
          <Button onClick={() => act({ action: "addCompany", name: form.name, careersUrl: form.url })}>Resolve & validate</Button>
          <select aria-label="Provider" className="rounded-md border bg-background px-2 text-sm" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}><option value="">Provider…</option>{data.providers.map((p: any) => <option key={p.provider} value={p.provider}>{p.label}</option>)}</select>
          <Input aria-label="Board slug" placeholder="Board slug / subdomain" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className="sm:col-span-2" />
          <Button variant="outline" onClick={() => act({ action: "addBoard", companyName: form.name, provider: form.provider, boardSlug: form.slug })}>Add board</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Sources ({data.sources.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-xs">
            <thead className="text-muted-foreground"><tr><th className="py-1 pr-3">Company</th><th className="pr-3">Provider</th><th className="pr-3">Status</th><th className="pr-3">Jobs</th><th className="pr-3">Last success</th><th className="pr-3">Next</th><th className="pr-3">Fails</th><th className="pr-3">Last error</th><th>Actions</th></tr></thead>
            <tbody className="divide-y">{data.sources.map((s: any) => (
              <tr key={s.id}><td className="py-1.5 pr-3">{s.company}</td><td className="pr-3 font-mono">{s.provider}</td><td className="pr-3">{s.status}</td><td className="pr-3">{s.active_jobs}</td><td className="pr-3">{when(s.last_success_at)}</td><td className="pr-3">{when(s.next_check_at)}</td><td className="pr-3">{s.consecutive_failures}</td><td className="max-w-[14rem] truncate pr-3" title={s.last_error ?? ""}>{s.last_error_category ? `${s.last_error_category}: ` : ""}{s.last_error ?? "–"}</td>
                <td className="space-x-1 whitespace-nowrap">
                  <Button size="xs" variant="outline" onClick={() => act({ action: "validate", sourceId: s.id })}>Validate</Button>
                  <Button size="xs" variant="outline" onClick={() => act({ action: "retry", sourceId: s.id })}>Retry</Button>
                  {s.status === "paused" ? <Button size="xs" variant="outline" onClick={() => act({ action: "reactivate", sourceId: s.id })}>Reactivate</Button> : <Button size="xs" variant="outline" onClick={() => act({ action: "pause", sourceId: s.id })}>Pause</Button>}
                  <Button size="xs" variant="ghost" onClick={() => inspect(s.id)}>Inspect</Button></td></tr>))}</tbody>
          </table>
        </CardContent>
      </Card>
      {detail && (
        <Card><CardHeader><CardTitle>Source #{detail.source.id}: last fetch & history</CardTitle></CardHeader><CardContent className="space-y-3 text-xs">
          <pre className="max-h-64 overflow-auto rounded bg-muted p-2">{JSON.stringify({ lastFetch: detail.source.last_sample, validation: detail.source.validation }, null, 2)}</pre>
          <table className="w-full text-left"><thead className="text-muted-foreground"><tr><th>Started</th><th>Status</th><th>HTTP</th><th>Fetched</th><th>+new</th><th>~upd</th><th>-closed</th><th>Error</th></tr></thead>
            <tbody className="divide-y">{detail.history.map((h: any) => <tr key={h.id}><td>{when(h.started_at)}</td><td>{h.status}</td><td>{h.http_status ?? "–"}</td><td>{h.jobs_fetched}</td><td>{h.jobs_inserted}</td><td>{h.jobs_updated}</td><td>{h.jobs_closed}</td><td>{h.error_category ?? ""}</td></tr>)}</tbody></table>
          <Button size="xs" variant="ghost" onClick={() => setDetail(null)}>Close</Button>
        </CardContent></Card>
      )}
    </div>
  );
}
