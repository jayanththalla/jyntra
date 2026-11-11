"use client";
// Technical view of data providers: provider id, error category, retry time, last successful time. Collapsed by default so the
// everyday screens only ever show one calm sentence. Never shows keys, URLs or raw provider errors (the API does not send them).
import { Skeleton } from "@/components/Skeleton";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Row { provider: string; description: string; state: string; error_category: string | null; consecutive_failures: number; next_retry_at: string | null; last_run_at: string | null; last_success_at: string | null; disabled_reason: string | null }
interface CompanyJobsDiag {
  companies_synced: number; logos?: { resolved: number; initials: number; failed: number }; jobs_fetched: number; new_records: number | null; updated_records: number | null;
  valid_application_links: number; recovered_links: number; missing_application_links: number; invalid_links: number;
  provider_failures: Record<string, number>; http_status: Record<string, number>;
  last_successful_sync: string | null; next_scheduled_sync: string | null;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

export function SourceDiagnostics() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [co, setCo] = useState<CompanyJobsDiag | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || rows) return;
    api<{ technical: Row[]; company_jobs?: CompanyJobsDiag | null }>("/api/sources/status").then((r) => {
      if (!r.ok) return;
      setRows(r.data.technical);
      setCo(r.data.company_jobs ?? null);
    });
  }, [open, rows]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data sources</CardTitle>
        <CardDescription>Technical status of each provider. Everyday screens only show a short note when something needs attention.</CardDescription>
      </CardHeader>
      <CardContent>
        <details onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Show technical details</summary>
          {rows === null ? (
            <div className="mt-3"><Skeleton variant="table" count={3} /></div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <caption className="sr-only">Provider diagnostics</caption>
                <thead className="text-muted-foreground">
                  <tr><th className="py-1 pr-3 font-medium">Provider</th><th className="pr-3 font-medium">State</th><th className="pr-3 font-medium">Error category</th><th className="pr-3 font-medium">Retry</th><th className="font-medium">Last success</th></tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.provider} title={r.disabled_reason ?? r.description}>
                      <td className="py-1.5 pr-3 font-mono">{r.provider}</td>
                      <td className="pr-3">{r.state.replace("_", " ")}</td>
                      <td className="pr-3">{r.error_category ?? "–"}</td>
                      <td className="pr-3">{r.next_retry_at ? when(r.next_retry_at) : "–"}</td>
                      <td>{when(r.last_success_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {co && (
                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Company job sync</p>
                  <p>Companies synchronized: {co.companies_synced} · job records: {co.jobs_fetched}</p>
                  {co.logos && <p>Logos: {co.logos.resolved} resolved · {co.logos.initials} initials · {co.logos.failed} failed</p>}
                  <p>New this run: {co.new_records ?? "–"} · updated: {co.updated_records ?? "–"}</p>
                  <p>Total jobs: {co.jobs_fetched} · valid application links: {co.valid_application_links} · missing: {co.missing_application_links} · invalid: {co.invalid_links} · recovered: {co.recovered_links}</p>
                  <p>HTTP: {Object.entries(co.http_status).map(([k, v]) => `${k} ${v}`).join(", ") || "–"}</p>
                  <p>Failures: {Object.entries(co.provider_failures).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}</p>
                  <p>Last successful sync: {when(co.last_successful_sync)} · next expected: {when(co.next_scheduled_sync)}</p>
                </div>
              )}
            </div>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
