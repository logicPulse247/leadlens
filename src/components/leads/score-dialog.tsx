"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json, useFetch } from "@/lib/client";
import type { IcpView } from "@/lib/types";

export function ScoreDialog({
  open,
  onOpenChange,
  leadIds,
  defaultIcpId,
  onQueued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When omitted, every lead is scored. */
  leadIds?: string[];
  defaultIcpId?: string;
  onQueued: () => void;
}) {
  const { toast } = useToast();
  const icps = useFetch<{ items: IcpView[] }>(open ? "/api/icps" : null);
  const [icpId, setIcpId] = useState<string>("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!icpId && icps.data?.items.length) setIcpId(defaultIcpId ?? icps.data.items[0].id);
  }, [icps.data, icpId, defaultIcpId]);

  async function submit() {
    setBusy(true);
    try {
      const body = leadIds ? { icpId, leadIds, force } : { icpId, scope: force ? "all" : "unscored", force };
      const res = await apiFetch<{ queued: number }>("/api/score", { method: "POST", body: json(body) });
      toast({ title: `Scoring ${res.queued} lead${res.queued === 1 ? "" : "s"}`, description: "Results appear in the table as they finish." });
      onOpenChange(false);
      onQueued();
    } catch (e) {
      toast({ title: "Could not start scoring", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const none = icps.data && icps.data.items.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="center">
        <SheetHeader className="px-0 pt-0">
          <SheetTitle>Score leads against an ICP</SheetTitle>
          <SheetDescription>
            {leadIds ? `${leadIds.length} selected lead${leadIds.length === 1 ? "" : "s"}` : "All leads"} will get a 0–100 fit score from deterministic rules blended with an AI read of each company&apos;s website text.
          </SheetDescription>
        </SheetHeader>
        {none ? (
          <p className="text-sm text-muted-foreground">
            You need an ICP first. <Link href="/icps" className="text-primary underline">Create one</Link>.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="score-icp">Ideal Customer Profile</Label>
              <Select value={icpId} onValueChange={setIcpId}>
                <SelectTrigger id="score-icp">
                  <SelectValue placeholder="Choose an ICP" />
                </SelectTrigger>
                <SelectContent>
                  {icps.data?.items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="score-force">Re-score already scored leads</Label>
                <p className="text-xs text-muted-foreground">Unchanged leads are normally skipped via content hash.</p>
              </div>
              <Switch id="score-force" checked={force} onCheckedChange={setForce} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!icpId || !!none}>
            <Sparkles /> Start scoring
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
