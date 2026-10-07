"use client";

import { useState } from "react";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { apiFetch, useFetch } from "@/lib/client";
import { SIGNAL_LABELS, type Signals } from "@/lib/schemas";
import type { IcpView } from "@/lib/types";
import { IcpForm } from "./icp-form";

export function IcpsView() {
  const { toast } = useToast();
  const icps = useFetch<{ items: IcpView[] }>("/api/icps");
  const sources = useFetch<{ sources: { facets: { industries: string[] } | null }[] }>("/api/discover");
  const [editing, setEditing] = useState<IcpView | "new" | null>(null);
  const suggestions = [...new Set(sources.data?.sources.flatMap((s) => s.facets?.industries ?? []) ?? [])];

  async function remove(icp: IcpView) {
    if (!window.confirm(`Delete "${icp.name}"? Leads linked to it will be kept.`)) return;
    try {
      await apiFetch(`/api/icps/${icp.id}`, { method: "DELETE" });
      toast({ title: "ICP deleted", description: icp.name });
      icps.reload();
    } catch (e) {
      toast({ title: "Could not delete ICP", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  return (
    <>
      <PageHeader
        title="Ideal Customer Profiles"
        description="Define what a great acquisition target looks like. Leads are scored against the ICP you choose."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> New ICP
          </Button>
        }
      />

      {icps.loading && !icps.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : icps.error ? (
        <ErrorState message={icps.error} onRetry={icps.reload} />
      ) : icps.data?.items.length === 0 ? (
        <EmptyState
          icon={<Target className="size-8" />}
          title="No ICPs yet"
          description="Create your first Ideal Customer Profile to start scoring leads."
          action={<Button onClick={() => setEditing("new")}>Create ICP</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {icps.data?.items.map((icp) => (
            <Card key={icp.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <CardTitle className="text-base">{icp.name}</CardTitle>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${icp.name}`} onClick={() => setEditing(icp)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Delete ${icp.name}`} onClick={() => remove(icp)}>
                    <Trash2 />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Industries" items={icp.industries} />
                <Row label="Locations" items={icp.locations} />
                <div className="flex gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">Employees</span>
                  <span>{icp.minEmployees ?? "any"} – {icp.maxEmployees ?? "any"}</span>
                </div>
                <Row label="Include" items={icp.includeKeywords} />
                <Row label="Exclude" items={icp.excludeKeywords} variant="destructive" />
                <Row
                  label="Signals"
                  items={(Object.keys(SIGNAL_LABELS) as (keyof Signals)[]).filter((k) => icp.signals[k]).map((k) => SIGNAL_LABELS[k].label)}
                  variant="success"
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editing === "new" ? "New ICP" : "Edit ICP"}</SheetTitle>
            <SheetDescription>These criteria drive rule-based scoring and the AI assessment.</SheetDescription>
          </SheetHeader>
          {editing && (
            <IcpForm
              key={editing === "new" ? "new" : editing.id}
              icp={editing === "new" ? undefined : editing}
              industrySuggestions={suggestions}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                icps.reload();
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Row({ label, items, variant = "secondary" }: { label: string; items: string[]; variant?: "secondary" | "destructive" | "success" }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.length ? items.map((i) => <Badge key={i} variant={variant}>{i}</Badge>) : <span className="text-muted-foreground">Any</span>}
      </div>
    </div>
  );
}
