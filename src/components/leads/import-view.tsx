"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Compass, FileUp, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json, useFetch } from "@/lib/client";
import type { IcpView } from "@/lib/types";

interface Summary {
  received: number;
  created: number;
  duplicatesRemoved: number;
  invalidDomains: number;
  skipped: number;
  fuzzyCandidates: number;
}

const NONE = "none";

export function ImportView() {
  const { toast } = useToast();
  const icps = useFetch<{ items: IcpView[] }>("/api/icps");
  const sources = useFetch<{ sources: { id: string; label: string; description: string; facets: { industries: string[] } | null }[] }>("/api/discover");

  const [icpId, setIcpId] = useState(NONE);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<"csv" | "paste">("paste");
  const [industries, setIndustries] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [enrich, setEnrich] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const source = sources.data?.sources[0];
  const icpValue = icpId === NONE ? null : icpId;

  async function run(fn: () => Promise<Summary>) {
    setBusy(true);
    setSummary(null);
    try {
      const s = await fn();
      setSummary(s);
      toast({ title: `Imported ${s.created} new lead${s.created === 1 ? "" : "s"}`, description: `${s.duplicatesRemoved} duplicate${s.duplicatesRemoved === 1 ? "" : "s"} removed` });
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast({ title: "File too large", description: "Please keep CSV files under 5 MB.", variant: "error" });
      return;
    }
    setText(await file.text());
    setFileName(file.name);
    setMode("csv");
  };

  return (
    <>
      <PageHeader title="Import & Discover" description="Bring companies in from a CSV, a pasted list, or a discovery source. Duplicates are removed on the way in." />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Add companies</CardTitle>
            <CardDescription>Choose how to bring companies in.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5 sm:max-w-sm">
              <Label htmlFor="icp-select">Score against ICP (optional)</Label>
              <Select value={icpId} onValueChange={setIcpId}>
                <SelectTrigger id="icp-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No ICP yet</SelectItem>
                  {icps.data?.items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:max-w-sm">
              <div>
                <Label htmlFor="enrich-switch">Enrich after import</Label>
                <p className="text-xs text-muted-foreground">Queue website enrichment for new leads.</p>
              </div>
              <Switch id="enrich-switch" checked={enrich} onCheckedChange={setEnrich} />
            </div>

            <Tabs defaultValue="upload">
              <TabsList>
                <TabsTrigger value="upload">
                  <FileUp className="mr-1.5 size-4" /> CSV / paste
                </TabsTrigger>
                <TabsTrigger value="discover">
                  <Compass className="mr-1.5 size-4" /> Discover
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="csv-file" onChange={(e) => onFile(e.target.files?.[0])} />
                  <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                    <FileUp /> Choose CSV file
                  </Button>
                  <span className="text-sm text-muted-foreground">{fileName ?? "Columns: name, domain/website, industry, city, state, employees…"}</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="paste">Or paste a list (one company per line)</Label>
                  <Textarea
                    id="paste"
                    rows={8}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setMode(fileName ? "csv" : "paste");
                    }}
                    placeholder={"Acme Plumbing, acmeplumbing.com\nTidewater HVAC - https://tidewaterhvac.com\nsummitroofing.com"}
                    className="font-mono text-xs"
                  />
                </div>
                <Button
                  disabled={!text.trim()}
                  loading={busy}
                  onClick={() => run(() => apiFetch<Summary>("/api/import", { method: "POST", body: json({ mode, text, icpId: icpValue, enrich }) }))}
                >
                  Import companies
                </Button>
              </TabsContent>

              <TabsContent value="discover" className="space-y-4">
                <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                  <p className="font-medium">{source?.label ?? "Loading source…"}</p>
                  <p className="mt-1 text-muted-foreground">{source?.description}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="disc-industries">Limit to industries (leave empty for all)</Label>
                  <TagInput id="disc-industries" value={industries} onChange={setIndustries} placeholder="HVAC, Dental Practice…" suggestions={source?.facets?.industries ?? []} />
                </div>
                <Button
                  loading={busy}
                  disabled={!source}
                  onClick={() => run(() => apiFetch<Summary>("/api/discover", { method: "POST", body: json({ sourceId: source!.id, industries, icpId: icpValue, enrich }) }))}
                >
                  Discover companies
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {summary ? (
            <Card className="border-success/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="size-4 text-success" /> Import complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-2">
                  <Stat label="Received" value={summary.received} />
                  <Stat label="New leads" value={summary.created} />
                  <Stat label="Duplicates removed" value={summary.duplicatesRemoved} />
                  <Stat label="Possible merges" value={summary.fuzzyCandidates} />
                  {summary.invalidDomains > 0 && <Stat label="Invalid domains" value={summary.invalidDomains} />}
                  {summary.skipped > 0 && <Stat label="Skipped rows" value={summary.skipped} />}
                </dl>
                <Button asChild className="w-full">
                  <Link href="/leads">View leads</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-2 p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">What happens on import</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Domains are normalized (no protocol, www or paths).</li>
                  <li>Exact duplicates by domain are merged.</li>
                  <li>Near-duplicate names are flagged for review.</li>
                  <li>Enrichment runs in the background if enabled; watch progress on the Leads page.</li>
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/60 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}
