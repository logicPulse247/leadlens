"use client";

import { useRef, useState } from "react";
import { AlertTriangle, CheckCheck, ExternalLink, Globe, Mail, Phone, RefreshCw, ShieldAlert, Sparkles, ThumbsUp, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json, useFetch } from "@/lib/client";
import { formatDate } from "@/lib/utils";
import type { EmailRecord, LeadDetail } from "@/lib/types";
import { ScoreBadge, StatusBadge } from "./badges";
import { OutreachPanel } from "./outreach-panel";

export function LeadDrawer({ leadId, onClose, onChanged }: { leadId: string | null; onClose: () => void; onChanged: () => void }) {
  const detailRef = useRef<LeadDetail>();
  const detail = useFetch<LeadDetail>(leadId ? `/api/leads/${leadId}` : null, {
    pollMs: () => (detailRef.current?.status === "ENRICHING" ? 2000 : false),
  });
  detailRef.current = detail.data;
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const lead = detail.data;

  async function act(kind: string, fn: () => Promise<unknown>, success: string) {
    setBusy(kind);
    try {
      await fn();
      toast({ title: success });
      detail.reload();
      onChanged();
    } catch (e) {
      toast({ title: "Action failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{lead?.name ?? "Lead"}</SheetTitle>
          <SheetDescription asChild>
            <div>
              {lead?.domain ? (
                <a href={`https://${lead.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  {lead.domain} <ExternalLink className="size-3" />
                </a>
              ) : (
                "No website on file"
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-6 pb-8">
          {detail.loading && !lead ? (
            <div className="space-y-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-40" />
            </div>
          ) : detail.error && !lead ? (
            <ErrorState message={detail.error} onRetry={detail.reload} />
          ) : lead ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <ScoreBadge score={lead.score} tier={lead.tier} />
                <StatusBadge status={lead.status} />
                {lead.icp && <Badge variant="outline">ICP: {lead.icp.name}</Badge>}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" loading={busy === "enrich"} onClick={() => act("enrich", () => apiFetch("/api/enrich", { method: "POST", body: json({ leadIds: [lead.id], force: true, icpId: lead.icpId }) }), "Re-enrichment queued")}>
                  <RefreshCw /> Re-enrich
                </Button>
                <Button size="sm" variant="outline" loading={busy === "qualify"} onClick={() => act("qualify", () => apiFetch("/api/leads/bulk", { method: "PATCH", body: json({ ids: [lead.id], status: "QUALIFIED" }) }), "Marked qualified")}>
                  <CheckCheck /> Qualify
                </Button>
                <Button size="sm" variant="outline" loading={busy === "reject"} onClick={() => act("reject", () => apiFetch("/api/leads/bulk", { method: "PATCH", body: json({ ids: [lead.id], status: "REJECTED" }) }), "Marked rejected")}>
                  <XCircle /> Reject
                </Button>
              </div>

              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="contact">Contact</TabsTrigger>
                  <TabsTrigger value="outreach">Outreach</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-5">
                  <ScoreSection lead={lead} />
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <Field label="Industry" value={lead.industry} />
                    <Field label="Location" value={lead.location} />
                    <Field label="Employees" value={lead.employees} />
                    <Field label="Founded" value={lead.foundedYear} />
                  </dl>
                  {(lead.enrichment?.about || lead.description) && (
                    <Section title="About">
                      <p className="text-sm text-muted-foreground">{lead.enrichment?.about ?? lead.description}</p>
                    </Section>
                  )}
                  {lead.enrichment && lead.enrichment.techStack.length > 0 && (
                    <Section title="Tech stack hints">
                      <div className="flex flex-wrap gap-1.5">
                        {lead.enrichment.techStack.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </Section>
                  )}
                </TabsContent>

                <TabsContent value="contact" className="space-y-5">
                  <ContactSection lead={lead} />
                </TabsContent>

                <TabsContent value="outreach">
                  <OutreachPanel lead={lead} onChanged={() => detail.reload()} />
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ScoreSection({ lead }: { lead: LeadDetail }) {
  const d = lead.scoreDetails;
  if (!d) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <Sparkles className="mb-1 size-4" />
        Not scored yet. Scores are computed after enrichment when the lead is linked to an ICP.
      </div>
    );
  }
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Why this score</h3>
        {d.rules && (
          <span className="text-xs text-muted-foreground">
            Rules {d.rules.total}/100{d.llm ? ` · AI ${d.llm.score}/100 (${d.llm.provider}${d.llm.cached ? ", cached" : ""})` : ""}
          </span>
        )}
      </div>
      <ReasonList icon={<ThumbsUp className="size-4 text-success" />} title="Strengths" items={d.reasons} />
      <ReasonList icon={<AlertTriangle className="size-4 text-warning" />} title="Risks" items={d.risks} />
      <ReasonList icon={<ShieldAlert className="size-4 text-primary" />} title="Acquisition signals" items={d.acquisitionSignals} />
      {d.rules && (
        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          {(["industry", "size", "location", "keywords", "signals"] as const).map((k) => (
            <div key={k} className="rounded-md bg-muted/60 p-2">
              <div className="font-semibold tabular-nums">{d.rules![k]}</div>
              <div className="capitalize text-muted-foreground">{k}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReasonList({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </h4>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function EmailRow({ e }: { e: EmailRecord }) {
  const status = !e.syntaxValid ? ["Invalid syntax", "destructive"] : e.mxValid === false ? ["No mail server", "destructive"] : e.mxValid === null ? ["Unverified", "secondary"] : ["Verified", "success"];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      <a href={`mailto:${e.address}`} className="font-medium hover:underline">
        {e.address}
      </a>
      <span className="flex items-center gap-1.5">
        <Badge variant="outline" className="capitalize">
          {e.kind}
        </Badge>
        <Badge variant={status[1] as "success" | "destructive" | "secondary"}>{status[0]}</Badge>
      </span>
    </li>
  );
}

function ContactSection({ lead }: { lead: LeadDetail }) {
  const e = lead.enrichment;
  if (!e) {
    return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No enrichment data yet. Use Re-enrich to fetch public contact details.</p>;
  }
  return (
    <>
      {e.error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">{e.robotsAllowed ? "Enrichment failed" : "Skipped: site asks not to be crawled"}</p>
            <p className="text-muted-foreground">{e.error}</p>
          </div>
        </div>
      )}
      <Section title="Emails" icon={<Mail className="size-4" />}>
        {e.emails.length ? (
          <ul className="space-y-1.5">
            {e.emails.map((m) => (
              <EmailRow key={m.address} e={m} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No public emails found.</p>
        )}
      </Section>
      <Section title="Phones" icon={<Phone className="size-4" />}>
        {e.phones.length ? (
          <ul className="space-y-1 text-sm">
            {e.phones.map((p) => (
              <li key={p}>
                <a href={`tel:${p}`} className="hover:underline">
                  {p}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No phone numbers found.</p>
        )}
      </Section>
      {Object.keys(e.socials).length > 0 && (
        <Section title="Social profiles" icon={<Globe className="size-4" />}>
          <ul className="space-y-1 text-sm">
            {Object.entries(e.socials).map(([k, v]) => (
              <li key={k}>
                <span className="mr-2 capitalize text-muted-foreground">{k}</span>
                <a href={v} target="_blank" rel="noopener noreferrer" className="break-all hover:underline">
                  {v}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">Links published on the company&apos;s own site. We never fetch social or LinkedIn pages.</p>
        </Section>
      )}
      <Section title="Source pages">
        {e.sourceUrls.length ? (
          <ul className="space-y-1 text-sm">
            {e.sourceUrls.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                  {u}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No pages were fetched.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Fetched {formatDate(e.fetchedAt)} · cached until {formatDate(e.expiresAt)}
        </p>
      </Section>
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value ?? "—"}</dd>
    </div>
  );
}
