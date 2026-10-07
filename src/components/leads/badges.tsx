import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/types";

const TIER_STYLES: Record<"A" | "B" | "C", string> = {
  A: "bg-success/15 text-success border-success/30",
  B: "bg-warning/15 text-warning border-warning/30",
  C: "bg-muted text-muted-foreground border-border",
};

export function ScoreBadge({ score, tier }: { score: number | null; tier: "A" | "B" | "C" | null }) {
  if (score == null || !tier) return <span className="text-xs text-muted-foreground">Not scored</span>;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Score ${score}, tier ${tier}`}>
      <span className={cn("inline-flex size-6 items-center justify-center rounded-md border text-xs font-bold", TIER_STYLES[tier])}>{tier}</span>
      <span className="text-sm font-semibold tabular-nums">{score}</span>
    </span>
  );
}

const STATUS: Record<LeadRow["status"], { label: string; variant: "secondary" | "default" | "success" | "warning" | "destructive" }> = {
  NEW: { label: "New", variant: "secondary" },
  ENRICHING: { label: "Enriching…", variant: "warning" },
  ENRICHED: { label: "Enriched", variant: "default" },
  FAILED: { label: "Failed", variant: "destructive" },
  QUALIFIED: { label: "Qualified", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
};

export function StatusBadge({ status }: { status: LeadRow["status"] }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
