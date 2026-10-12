"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { downloadExport } from "@/lib/client";

type Format = "csv" | "json";

export function ExportButtons({
  ids,
  filters,
  size = "default",
  label,
}: {
  ids?: string[];
  filters?: Record<string, unknown>;
  size?: "default" | "sm";
  label: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<Format | null>(null);

  async function run(format: Format) {
    setBusy(format);
    try {
      const r = await downloadExport({ format, ids, filters });
      const dropped = [
        r.suppressedLeads ? `${r.suppressedLeads} opted-out compan${r.suppressedLeads === 1 ? "y" : "ies"} left out` : null,
        r.suppressedEmails ? `${r.suppressedEmails} opted-out email${r.suppressedEmails === 1 ? "" : "s"} removed` : null,
        r.truncated ? "Export capped at 5,000 rows; narrow your filters for the rest" : null,
      ].filter(Boolean);
      toast({
        title: `Exported ${r.exported} lead${r.exported === 1 ? "" : "s"}`,
        description: dropped.length ? dropped.join(". ") + "." : r.filename,
      });
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-2">
      <Button size={size} variant="outline" loading={busy === "csv"} disabled={busy !== null} onClick={() => run("csv")} title="HubSpot-compatible CSV; opted-out contacts are excluded">
        <Download /> {label} CSV
      </Button>
      <Button size={size} variant="outline" loading={busy === "json"} disabled={busy !== null} onClick={() => run("json")} title="Full records as JSON; opted-out contacts are excluded">
        JSON
      </Button>
    </div>
  );
}
