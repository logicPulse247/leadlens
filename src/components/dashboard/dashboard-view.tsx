"use client";

import Link from "next/link";
import { useState } from "react";
import { Copy, Gauge, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useFetch } from "@/lib/client";
import type { IcpView } from "@/lib/types";
import type { DashboardData } from "@/server/services/dashboard.service";

const ALL = "all";

const TIER_COLORS: Record<string, string> = {
  A: "hsl(var(--success))",
  B: "hsl(var(--warning))",
  C: "hsl(var(--muted-foreground))",
  UNSCORED: "hsl(var(--border))",
};
const TIER_LABELS: Record<string, string> = { A: "Tier A", B: "Tier B", C: "Tier C", UNSCORED: "Not scored" };

export function DashboardView() {
  const [icpId, setIcpId] = useState(ALL);
  const icps = useFetch<{ items: IcpView[] }>("/api/icps");
  const dash = useFetch<DashboardData>(`/api/dashboard${icpId !== ALL ? `?icpId=${encodeURIComponent(icpId)}` : ""}`);
  const d = dash.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How your pipeline looks right now: fit, data quality and cleanup."
        actions={
          <div className="w-48">
            <Label htmlFor="dash-icp" className="sr-only">
              Filter by ICP
            </Label>
            <Select value={icpId} onValueChange={setIcpId}>
              <SelectTrigger id="dash-icp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All ICPs</SelectItem>
                {icps.data?.items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {dash.error && !d ? (
        <ErrorState message={dash.error} onRetry={dash.reload} />
      ) : !d ? (
        <DashboardSkeleton />
      ) : d.totals.leads === 0 && d.duplicates.removed === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title="Nothing to show yet"
          description="Import or discover companies, then enrich and score them to populate the dashboard."
          action={
            <Button asChild>
              <Link href="/import">Import companies</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<Users />} label="Leads" value={d.totals.leads} hint={`${d.totals.scored} scored · ${d.totals.qualified} qualified · ${d.totals.rejected} rejected`} />
            <Kpi
              icon={<Gauge />}
              label="Enrichment success"
              value={d.enrichment.successRate == null ? "—" : `${d.enrichment.successRate}%`}
              hint={d.enrichment.attempted ? `${d.enrichment.succeeded} of ${d.enrichment.attempted} sites · ${d.enrichment.blockedByRobots} blocked by robots.txt · ${d.enrichment.failed} failed` : `${d.enrichment.pending} leads waiting to be enriched`}
            />
            <Kpi
              icon={<Copy />}
              label="Duplicates removed"
              value={d.duplicates.removed}
              hint={d.duplicates.pendingReview ? `${d.duplicates.pendingReview} possible merge${d.duplicates.pendingReview === 1 ? "" : "s"} awaiting review` : "No merges awaiting review"}
            />
            <Kpi icon={<Sparkles />} label="Average fit score" value={d.totals.averageScore ?? "—"} hint={d.totals.scored ? `across ${d.totals.scored} scored leads` : "Score leads to see this"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Leads by tier</CardTitle>
                <CardDescription>A is 75+, B is 50–74, C is below 50.</CardDescription>
              </CardHeader>
              <CardContent>
                <TierChart tiers={d.tiers} />
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Average score by industry</CardTitle>
                <CardDescription>Only scored leads are counted.</CardDescription>
              </CardHeader>
              <CardContent>
                <IndustryChart industries={d.industries} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <ShieldCheck className="size-5 text-success" aria-hidden />
              <span>
                {d.suppressions} opt-out entr{d.suppressions === 1 ? "y is" : "ies are"} enforced on enrichment, outreach and every export.
              </span>
              <Button asChild variant="link" className="ml-auto h-auto p-0">
                <Link href="/compliance">Manage compliance</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string | number; hint: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4" aria-hidden>
          {icon}
          <span>{label}</span>
        </div>
        <p className="mt-2 text-3xl font-semibold tabular-nums" aria-label={`${label}: ${value}`}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function TierChart({ tiers }: { tiers: DashboardData["tiers"] }) {
  const total = tiers.reduce((n, t) => n + t.count, 0);
  const data = tiers.map((t) => ({ ...t, name: TIER_LABELS[t.tier] }));
  if (total === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No leads yet.</p>;
  return (
    <div>
      <div className="h-56" role="img" aria-label={`Leads by tier: ${data.map((t) => `${t.name} ${t.count}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.filter((t) => t.count > 0)} dataKey="count" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
              {data
                .filter((t) => t.count > 0)
                .map((t) => (
                  <Cell key={t.tier} fill={TIER_COLORS[t.tier]} />
                ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {data.map((t) => (
          <li key={t.tier} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: TIER_COLORS[t.tier] }} aria-hidden />
              {t.name}
            </span>
            <span className="tabular-nums text-muted-foreground">{t.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IndustryChart({ industries }: { industries: DashboardData["industries"] }) {
  if (industries.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Score some leads to compare industries.</p>;
  const data = industries.slice(0, 12);
  return (
    <div
      style={{ height: Math.max(220, data.length * 34 + 30) }}
      role="img"
      aria-label={`Average score by industry: ${data.map((i) => `${i.industry} ${i.averageScore}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
          <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} stroke="hsl(var(--border))" />
          <YAxis type="category" dataKey="industry" width={130} tick={{ fill: "hsl(var(--foreground))", fontSize: 12 }} stroke="hsl(var(--border))" />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(var(--accent))" }} formatter={(v: number, _n, p) => [`${v} (${p.payload.count} lead${p.payload.count === 1 ? "" : "s"})`, "Average score"]} />
          <Bar dataKey="averageScore" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
};

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80 lg:col-span-3" />
      </div>
    </div>
  );
}
