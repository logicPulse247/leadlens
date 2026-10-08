"use client";

import type { LeadDetail } from "@/lib/types";

export function OutreachPanel({ lead }: { lead: LeadDetail; onChanged: () => void }) {
  return <p className="text-sm text-muted-foreground">Outreach drafts for {lead.name} arrive in the next phase.</p>;
}
