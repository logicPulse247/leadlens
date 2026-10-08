"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useFetch } from "@/lib/client";
import type { JobView } from "@/lib/types";

const LABEL: Record<JobView["type"], string> = { ENRICH: "Enriching leads", SCORE: "Scoring leads", IMPORT: "Importing" };

/** Polls background job status. Fast while work is active, slow otherwise. */
export function JobsTray({ onSettled }: { onSettled?: () => void }) {
  const activeRef = useRef(false);
  const jobs = useFetch<{ active: JobView[]; recent: JobView[] }>("/api/jobs", {
    pollMs: () => (activeRef.current ? 1500 : 6000),
  });
  const activeCount = jobs.data?.active.length ?? 0;
  activeRef.current = activeCount > 0;

  const prev = useRef(0);
  useEffect(() => {
    if (prev.current > 0 && activeCount === 0) onSettled?.();
    prev.current = activeCount;
  }, [activeCount, onSettled]);

  // Also refresh the table periodically while jobs run so scores and statuses appear live.
  useEffect(() => {
    if (!activeCount) return;
    const t = setInterval(() => onSettled?.(), 4000);
    return () => clearInterval(t);
  }, [activeCount, onSettled]);

  const active = jobs.data?.active ?? [];
  const justFinished = (jobs.data?.recent ?? []).filter((j) => Date.now() - new Date(j.updatedAt).getTime() < 15_000);
  if (!active.length && !justFinished.length) return null;

  return (
    <div className="mb-4 space-y-2" role="status" aria-live="polite">
      {[...active, ...justFinished].map((job) => {
        const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
        const done = job.status === "COMPLETED";
        return (
          <div key={job.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                {done ? <CheckCircle2 className="size-4 text-success" /> : <Loader2 className="size-4 animate-spin text-primary" />}
                {done ? "Finished" : LABEL[job.type]}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {job.done} / {job.total}
                {job.failed > 0 && ` · ${job.failed} could not be enriched`}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={LABEL[job.type]}>
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
