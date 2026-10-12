"use client";

import { useState } from "react";
import { CheckCheck, RefreshCw, Sparkles, XCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json } from "@/lib/client";
import { ExportButtons } from "./export-buttons";

export function BulkActions({ ids, onDone, onClear, onScore }: { ids: string[]; onDone: () => void; onClear: () => void; onScore: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(status: "QUALIFIED" | "REJECTED") {
    setBusy(status);
    try {
      const res = await apiFetch<{ updated: number }>("/api/leads/bulk", { method: "PATCH", body: json({ ids, status }) });
      toast({ title: `Marked ${res.updated} lead${res.updated === 1 ? "" : "s"} as ${status.toLowerCase()}` });
      onDone();
    } catch (e) {
      toast({ title: "Bulk update failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function reEnrich() {
    setBusy("ENRICH");
    try {
      const res = await apiFetch<{ queued: number }>("/api/enrich", { method: "POST", body: json({ leadIds: ids, force: true }) });
      toast({ title: `Re-enriching ${res.queued} lead${res.queued === 1 ? "" : "s"}`, description: "Cached results are bypassed." });
      onDone();
    } catch (e) {
      toast({ title: "Could not queue enrichment", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="region" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-accent px-3 py-2 text-sm">
      <span className="font-medium text-accent-foreground">{ids.length} selected</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" loading={busy === "ENRICH"} onClick={reEnrich}>
          <RefreshCw /> Re-enrich
        </Button>
        <Button size="sm" variant="outline" onClick={onScore}>
          <Sparkles /> Score
        </Button>
        <Button size="sm" variant="outline" loading={busy === "QUALIFIED"} onClick={() => setStatus("QUALIFIED")}>
          <CheckCheck /> Mark qualified
        </Button>
        <Button size="sm" variant="outline" loading={busy === "REJECTED"} onClick={() => setStatus("REJECTED")}>
          <XCircle /> Mark rejected
        </Button>
        <ExportButtons size="sm" ids={ids} label="Export selected" />
        <Button size="icon" variant="ghost" aria-label="Clear selection" onClick={onClear}>
          <X />
        </Button>
      </div>
    </div>
  );
}
