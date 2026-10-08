"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail, Quote, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json } from "@/lib/client";
import { TONES, TONE_LABELS } from "@/lib/schemas";
import type { DraftView, LeadDetail } from "@/lib/types";

type Tone = (typeof TONES)[number];

export function OutreachPanel({ lead, onChanged }: { lead: LeadDetail; onChanged: () => void }) {
  const { toast } = useToast();
  const [tone, setTone] = useState<Tone>("friendly");
  const existing = lead.drafts.find((d) => d.tone === tone);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSubject(existing?.subject ?? "");
    setBody(existing?.body ?? "");
  }, [existing?.id, existing?.updatedAt, existing?.subject, existing?.body, tone]);

  const dirty = !!existing && (subject !== existing.subject || body !== existing.body);

  async function generate() {
    if (dirty && !window.confirm("Regenerating will replace your edits. Continue?")) return;
    setGenerating(true);
    try {
      const res = await apiFetch<{ draft: DraftView; source: "llm" | "template" }>(`/api/leads/${lead.id}/outreach`, { method: "POST", body: json({ tone }) });
      toast({ title: "Draft ready", description: res.source === "template" ? "Used the fact-based template (AI draft failed validation)." : undefined });
      onChanged();
    } catch (e) {
      toast({ title: "Could not generate draft", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!existing) return;
    setSaving(true);
    try {
      await apiFetch(`/api/outreach/${existing.id}`, { method: "PUT", body: json({ subject, body }) });
      toast({ title: "Draft saved" });
      onChanged();
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52 space-y-1.5">
          <Label htmlFor="tone">Tone</Label>
          <Select value={tone} onValueChange={(v) => setTone(v as Tone)}>
            <SelectTrigger id="tone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TONE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={generate} loading={generating}>
          <Sparkles /> {existing ? "Regenerate" : "Generate draft"}
        </Button>
      </div>

      {!existing && !generating ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <Mail className="mx-auto mb-2 size-5" />
          Generate a short cold email that cites real facts from this company&apos;s own website.
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="draft-subject">Subject</Label>
            <Input id="draft-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-body">Body</Label>
            <Textarea id="draft-body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copy}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" onClick={save} loading={saving} disabled={!dirty}>
              <Save /> Save edits
            </Button>
            {existing?.edited && !dirty && <span className="self-center text-xs text-muted-foreground">Edited by you</span>}
          </div>
          {existing && existing.factsUsed.length > 0 && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Quote className="size-3.5" /> Facts this draft is based on
              </h4>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {existing.factsUsed.map((f) => (
                  <li key={f.id}>{f.text}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
