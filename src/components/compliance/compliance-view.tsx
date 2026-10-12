"use client";

import { useState } from "react";
import { Ban, Bot, CheckCircle2, Database, Gauge, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json, useFetch } from "@/lib/client";
import { formatDate } from "@/lib/utils";

interface SuppressionRow {
  id: string;
  type: "DOMAIN" | "EMAIL";
  value: string;
  reason: string | null;
  createdAt: string;
}

interface ComplianceInfo {
  crawler: { userAgent: string; domainDelayMs: number; timeoutMs: number; ttlHours: number; concurrency: number; offline: boolean };
  llmProvider: string;
  suppressedLeads: number;
}

export function ComplianceView() {
  const { toast } = useToast();
  const list = useFetch<{ items: SuppressionRow[] }>("/api/suppressions");
  const info = useFetch<ComplianceInfo>("/api/compliance");
  const [entries, setEntries] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const parts = entries
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ added: number; invalid: string[] }>("/api/suppressions", {
        method: "POST",
        body: json({ entries: parts, reason: reason.trim() || undefined }),
      });
      toast({
        title: res.added ? `Added ${res.added} opt-out${res.added === 1 ? "" : "s"}` : "Nothing new to add",
        description: res.invalid.length ? `Skipped invalid: ${res.invalid.slice(0, 5).join(", ")}` : "Enforced from now on.",
        variant: res.added || !res.invalid.length ? undefined : "error",
      });
      if (res.added) {
        setEntries("");
        setReason("");
      }
      list.reload();
      info.reload();
    } catch (e) {
      toast({ title: "Could not add opt-outs", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: SuppressionRow) {
    if (!window.confirm(`Remove ${row.value} from the opt-out list? It will become exportable and contactable again.`)) return;
    try {
      await apiFetch(`/api/suppressions/${row.id}`, { method: "DELETE" });
      toast({ title: "Removed from opt-out list", description: row.value });
      list.reload();
      info.reload();
    } catch (e) {
      toast({ title: "Could not remove entry", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  const c = info.data?.crawler;

  return (
    <>
      <PageHeader title="Ethics & Compliance" description="What LeadLens collects, how it behaves on the web, and how opt-outs are honoured." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={<Database />} title="Data sources" description="Only information a company chooses to publish, or that you provide.">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Your own data</strong>: CSV uploads and pasted lists.
            </li>
            <li>
              <strong>Seed dataset</strong>: <code>data/sample_companies.csv</code>, a synthetic set of fictional small businesses.
            </li>
            <li>
              <strong>Public company websites</strong>: home, about, contact and similar pages on the company&apos;s own domain.
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            <Ban className="mr-1 inline size-4 text-destructive" aria-hidden />
            Never collected: LinkedIn or other social network pages (links a company publishes on its own site are recorded but never fetched), logged-in or paywalled pages, personal profiles, or purchased and breached data.
          </p>
        </Section>

        <Section icon={<Bot />} title="Crawler behaviour" description="Polite by default; none of this can be turned off from the UI.">
          {info.error && !c ? (
            <ErrorState message={info.error} onRetry={info.reload} />
          ) : !c ? (
            <Skeleton className="h-32" />
          ) : (
            <ul className="space-y-2">
              <Rule>
                <strong>robots.txt is obeyed</strong> (RFC 9309): longest matching rule wins, Allow beats Disallow on ties, wildcards and Crawl-delay are honoured. If robots.txt cannot be read because of an auth or server error, we do not crawl.
              </Rule>
              <Rule>
                <strong>Identified</strong>: requests send the user agent <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">{c.userAgent}</code>
              </Rule>
              <Rule>
                <strong>Rate limited</strong>: at most one request per domain every {c.domainDelayMs} ms (shared across workers via Redis), {c.concurrency} domains in parallel, {c.timeoutMs / 1000}s timeouts, retries with backoff that honour Retry-After.
              </Rule>
              <Rule>
                <strong>Safe</strong>: private and internal addresses are blocked, redirects stay on the same domain and response size is capped.
              </Rule>
              <Rule>
                <strong>Cached</strong> for {c.ttlHours} hours so the same site is not re-fetched needlessly.
              </Rule>
              {c.offline && <Rule>Offline mode is on: no real network requests are made.</Rule>}
            </ul>
          )}
        </Section>

        <Section icon={<Gauge />} title="Rate limits & AI" description="Protecting the targets and your quota.">
          <ul className="space-y-2">
            <Rule>API endpoints that start work (enrich, score, outreach, export) are rate limited per minute.</Rule>
            <Rule>
              AI scoring runs through the <Badge variant="secondary">{info.data?.llmProvider ?? "…"}</Badge> provider. Calls are batched and cached by content hash, so unchanged leads never trigger a repeat call.
            </Rule>
            <Rule>Only public company text and your ICP are sent to the model; no personal contact details are included in scoring prompts.</Rule>
            <Rule>Outreach drafts may only cite facts from the enrichment record. Anything else is rejected and replaced by a fact-based template.</Rule>
          </ul>
        </Section>

        <Section icon={<ShieldCheck />} title="Where opt-outs are enforced" description={`${info.data?.suppressedLeads ?? 0} existing lead${info.data?.suppressedLeads === 1 ? " is" : "s are"} currently covered by the list.`}>
          <ul className="space-y-2">
            <Rule>
              <strong>Enrichment</strong>: suppressed domains are never fetched.
            </Rule>
            <Rule>
              <strong>Outreach</strong>: drafts cannot be generated for suppressed domains.
            </Rule>
            <Rule>
              <strong>Export</strong>: suppressed companies are left out of CSV and JSON files, and suppressed email addresses are stripped from contact columns. The export tells you how many were removed.
            </Rule>
            <Rule>A domain entry also covers its subdomains, so opting out example.com covers mail.example.com.</Rule>
          </ul>
        </Section>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Opt-out / suppression list</CardTitle>
          <CardDescription>Add companies or people who asked not to be contacted. Accepts domains, URLs or email addresses.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 md:grid-cols-[1fr_16rem_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="opt-entries">Domains or emails</Label>
              <Textarea id="opt-entries" rows={3} placeholder={"acme.com\nowner@smallbiz.com"} value={entries} onChange={(e) => setEntries(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opt-reason">Reason (optional)</Label>
              <Input id="opt-reason" maxLength={200} placeholder="Requested removal by email" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button onClick={add} loading={busy} disabled={!entries.trim()}>
              Add to list
            </Button>
          </div>

          {list.error && !list.data ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <Skeleton className="h-24" />
          ) : list.data.items.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="size-8" />} title="No opt-outs yet" description="When someone asks to be removed, add them here and they are excluded everywhere." />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">Suppression list</caption>
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Value
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Type
                    </th>
                    <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                      Reason
                    </th>
                    <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                      Added
                    </th>
                    <th scope="col" className="w-12 px-3 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.data.items.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-medium">{row.value}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{row.type === "DOMAIN" ? "Domain" : "Email"}</Badge>
                      </td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{row.reason ?? "—"}</td>
                      <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">{formatDate(row.createdAt)}</td>
                      <td className="px-3 py-2">
                        <Button variant="ghost" size="icon" aria-label={`Remove ${row.value}`} onClick={() => remove(row)}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Section({ icon, title, description, children }: { icon: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base [&_svg]:size-4 [&_svg]:text-primary">
          {icon}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
