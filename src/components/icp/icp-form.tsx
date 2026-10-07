"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json, ApiClientError } from "@/lib/client";
import { icpInputSchema, SIGNAL_LABELS, type IcpInput, type Signals } from "@/lib/schemas";
import type { IcpView } from "@/lib/types";

const EMPTY: IcpInput = {
  name: "",
  industries: [],
  locations: [],
  minEmployees: null,
  maxEmployees: null,
  includeKeywords: [],
  excludeKeywords: [],
  signals: { ownerOperated: false, longEstablished: false, noRecentFunding: false, hiringSlowdown: false },
};

export function IcpForm({
  icp,
  industrySuggestions,
  onSaved,
  onCancel,
}: {
  icp?: IcpView;
  industrySuggestions: string[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<IcpInput>(icp ? { ...EMPTY, ...icp } : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof IcpInput>(key: K, value: IcpInput[K]) => setValues((v) => ({ ...v, [key]: value }));
  const num = (s: string) => (s === "" ? null : Math.max(0, Math.floor(Number(s))) || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = icpInputSchema.safeParse(values);
    if (!parsed.success) {
      const flat: Record<string, string> = {};
      for (const i of parsed.error.issues) flat[String(i.path[0])] = i.message;
      setErrors(flat);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await apiFetch(icp ? `/api/icps/${icp.id}` : "/api/icps", { method: icp ? "PUT" : "POST", body: json(parsed.data) });
      toast({ title: icp ? "ICP updated" : "ICP created", description: parsed.data.name });
      onSaved();
    } catch (err) {
      toast({ title: "Could not save ICP", description: err instanceof ApiClientError ? err.message : "Unexpected error", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col" noValidate>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="icp-name">Name</Label>
          <Input
            id="icp-name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Owner-operated home services"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "icp-name-err" : undefined}
          />
          {errors.name && (
            <p id="icp-name-err" className="text-xs text-destructive">
              {errors.name}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="icp-industries">Industries</Label>
          <TagInput id="icp-industries" value={values.industries} onChange={(v) => set("industries", v)} placeholder="Type and press Enter" suggestions={industrySuggestions} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="icp-locations">Locations (states or cities)</Label>
          <TagInput id="icp-locations" value={values.locations} onChange={(v) => set("locations", v)} placeholder="OH, Raleigh, NC…" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="icp-min">Min employees</Label>
            <Input id="icp-min" type="number" min={0} value={values.minEmployees ?? ""} onChange={(e) => set("minEmployees", num(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="icp-max">Max employees</Label>
            <Input id="icp-max" type="number" min={0} value={values.maxEmployees ?? ""} onChange={(e) => set("maxEmployees", num(e.target.value))} aria-invalid={!!errors.maxEmployees} />
            {errors.maxEmployees && <p className="text-xs text-destructive">{errors.maxEmployees}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="icp-include">Keywords to include</Label>
          <TagInput id="icp-include" value={values.includeKeywords} onChange={(v) => set("includeKeywords", v)} placeholder="family-owned, since…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="icp-exclude">Keywords to exclude</Label>
          <TagInput id="icp-exclude" value={values.excludeKeywords} onChange={(v) => set("excludeKeywords", v)} placeholder="venture, franchise…" />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Acquisition signals</legend>
          {(Object.keys(SIGNAL_LABELS) as (keyof Signals)[]).map((key) => (
            <div key={key} className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor={`sig-${key}`}>{SIGNAL_LABELS[key].label}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{SIGNAL_LABELS[key].hint}</p>
              </div>
              <Switch id={`sig-${key}`} checked={values.signals[key]} onCheckedChange={(c) => set("signals", { ...values.signals, [key]: c })} />
            </div>
          ))}
        </fieldset>
      </div>

      <div className="flex justify-end gap-2 border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {icp ? "Save changes" : "Create ICP"}
        </Button>
      </div>
    </form>
  );
}
