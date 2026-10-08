"use client";

import { useState } from "react";
import { GitMerge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json, useFetch } from "@/lib/client";

interface CandidateLead {
  id: string;
  name: string;
  domain: string | null;
  location: string | null;
  industry: string | null;
  employees: number | null;
  score: number | null;
}
interface Candidate {
  id: string;
  similarity: number;
  reason: "DOMAIN" | "FUZZY_NAME";
  leadA: CandidateLead;
  leadB: CandidateLead;
}

export function MergeCandidatesButton({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const list = useFetch<{ items: Candidate[] }>("/api/dedupe");
  const count = list.data?.items.length ?? 0;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <GitMerge /> Possible duplicates{count > 0 && <Badge variant="warning">{count}</Badge>}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Possible duplicates</SheetTitle>
            <SheetDescription>Exact domain matches are merged automatically on import. These are near-matches by company name that need a human decision.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-6 pb-8">
            {list.loading && !list.data ? (
              <Skeleton className="h-32" />
            ) : list.error ? (
              <ErrorState message={list.error} onRetry={list.reload} />
            ) : count === 0 ? (
              <EmptyState title="No merge candidates" description="Nothing looks like a duplicate right now." />
            ) : (
              list.data!.items.map((c) => (
                <CandidateCard
                  key={c.id}
                  c={c}
                  onDone={() => {
                    list.reload();
                    onChanged();
                  }}
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function CandidateCard({ c, onDone }: { c: Candidate; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: "dismiss" | "merge", keepId?: string) {
    setBusy(action + (keepId ?? ""));
    try {
      await apiFetch(`/api/dedupe/${c.id}`, { method: "POST", body: json(action === "merge" ? { action, keepId } : { action }) });
      toast({ title: action === "merge" ? "Leads merged" : "Marked as not a duplicate" });
      onDone();
    } catch (e) {
      toast({ title: "Action failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between">
        <Badge variant={c.reason === "DOMAIN" ? "destructive" : "warning"}>{c.reason === "DOMAIN" ? "Same domain" : "Similar name"}</Badge>
        <span className="text-xs text-muted-foreground">{Math.round(c.similarity * 100)}% match</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[c.leadA, c.leadB].map((l) => (
          <div key={l.id} className="rounded-md bg-muted/50 p-2 text-sm">
            <p className="font-medium">{l.name}</p>
            <p className="text-xs text-muted-foreground">{l.domain ?? "no domain"}</p>
            <p className="text-xs text-muted-foreground">
              {[l.location, l.industry, l.employees ? `${l.employees} staff` : null].filter(Boolean).join(" · ")}
            </p>
            <Button size="sm" variant="outline" className="mt-2 w-full" loading={busy === "merge" + l.id} onClick={() => act("merge", l.id)}>
              Keep this one
            </Button>
          </div>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="mt-2" loading={busy === "dismiss"} onClick={() => act("dismiss")}>
        Not a duplicate
      </Button>
    </div>
  );
}
