"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useFetch } from "@/lib/client";
import type { LeadDetail } from "@/lib/types";
import { ScoreBadge, StatusBadge } from "./badges";

export function LeadDrawer({ leadId, onClose, onChanged }: { leadId: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useFetch<LeadDetail>(leadId ? `/api/leads/${leadId}` : null);
  void onChanged;

  return (
    <Sheet open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{detail.data?.name ?? "Lead"}</SheetTitle>
          <SheetDescription>{detail.data?.domain ?? "No website on file"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-6 pb-8">
          {detail.loading && !detail.data ? (
            <Skeleton className="h-40" />
          ) : detail.error ? (
            <ErrorState message={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <>
              <div className="flex items-center gap-3">
                <ScoreBadge score={detail.data.score} tier={detail.data.tier} />
                <StatusBadge status={detail.data.status} />
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Industry" value={detail.data.industry} />
                <Field label="Location" value={detail.data.location} />
                <Field label="Employees" value={detail.data.employees} />
                <Field label="Founded" value={detail.data.foundedYear} />
              </dl>
              {detail.data.description && <p className="text-sm text-muted-foreground">{detail.data.description}</p>}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
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
