"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ChevronLeft, ChevronRight, Search, Table2, Trash2, X } from "lucide-react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState } from "@tanstack/react-table";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { apiFetch, json, useDebounced, useFetch } from "@/lib/client";
import { LEAD_STATUSES, TIERS, SORTABLE_FIELDS } from "@/lib/schemas";
import type { IcpView, LeadListResponse, LeadRow, SavedViewDto } from "@/lib/types";
import { ScoreBadge, StatusBadge } from "./badges";
import { LeadDrawer } from "./lead-drawer";
import { BulkActions } from "./bulk-actions";

type SortField = (typeof SORTABLE_FIELDS)[number];

interface Filters {
  q: string;
  status: string;
  tier: string;
  industry: string;
  icpId: string;
  minScore: string;
}

const ALL = "all";
const EMPTY_FILTERS: Filters = { q: "", status: ALL, tier: ALL, industry: ALL, icpId: ALL, minScore: "" };

function toParams(f: Filters, sort: SortField, order: "asc" | "desc", page: number, pageSize: number) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.status !== ALL) p.set("status", f.status);
  if (f.tier !== ALL) p.set("tier", f.tier);
  if (f.industry !== ALL) p.set("industry", f.industry);
  if (f.icpId !== ALL) p.set("icpId", f.icpId);
  if (f.minScore !== "") p.set("minScore", f.minScore);
  p.set("sort", sort);
  p.set("order", order);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p;
}

export function LeadsView() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortField>("score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");

  const debouncedQ = useDebounced(filters.q, 300);
  const query = toParams({ ...filters, q: debouncedQ }, sort, order, page, pageSize).toString();

  const hasEnriching = useRef(false);
  const leads = useFetch<LeadListResponse>(`/api/leads?${query}`, { pollMs: () => (hasEnriching.current ? 2500 : false) });
  hasEnriching.current = !!leads.data?.items.some((l) => l.status === "ENRICHING");

  const facets = useFetch<{ industries: { value: string; count: number }[] }>("/api/leads/facets");
  const icps = useFetch<{ items: IcpView[] }>("/api/icps");
  const views = useFetch<{ items: SavedViewDto[] }>("/api/views");

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelection({});
  };

  const selectedIds = useMemo(() => Object.keys(selection).filter((k) => selection[k]), [selection]);
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v !== "" && v !== ALL && k !== "q").length + (filters.q ? 1 : 0);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sort === field) setOrder((o) => (o === "asc" ? "desc" : "asc"));
      else {
        setSort(field);
        setOrder(field === "score" || field === "employees" ? "desc" : "asc");
      }
      setPage(1);
    },
    [sort],
  );

  const columns = useMemo<ColumnDef<LeadRow>[]>(() => {
    const sortable = (label: string, field: SortField) => {
      const Header = () => {
        const active = sort === field;
        const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
        return (
          <button
            type="button"
            onClick={() => toggleSort(field)}
            className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
            aria-label={`Sort by ${label}`}
          >
            {label}
            <Icon className={active ? "size-3.5 text-foreground" : "size-3.5 opacity-50"} />
          </button>
        );
      };
      return Header;
    };
    return [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all rows"
            checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(c) => table.toggleAllRowsSelected(!!c)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox aria-label={`Select ${row.original.name}`} checked={row.getIsSelected()} onCheckedChange={(c) => row.toggleSelected(!!c)} onClick={(e) => e.stopPropagation()} />
        ),
      },
      {
        id: "name",
        header: sortable("Company", "name"),
        cell: ({ row }) => (
          <div className="min-w-[180px]">
            <button type="button" onClick={() => setOpenId(row.original.id)} className="text-left font-medium hover:underline">
              {row.original.name}
            </button>
            <div className="text-xs text-muted-foreground">{row.original.domain ?? "no domain"}</div>
          </div>
        ),
      },
      { id: "industry", header: sortable("Industry", "industry"), cell: ({ row }) => row.original.industry ?? "—" },
      { id: "location", header: "Location", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.location ?? "—"}</span> },
      { id: "employees", header: sortable("Staff", "employees"), cell: ({ row }) => <span className="tabular-nums">{row.original.employees ?? "—"}</span> },
      { id: "score", header: sortable("Fit", "score"), cell: ({ row }) => <ScoreBadge score={row.original.score} tier={row.original.tier} /> },
      { id: "status", header: sortable("Status", "status"), cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      {
        id: "contacts",
        header: "Contacts",
        cell: ({ row }) => {
          const e = row.original.enrichment;
          if (!e) return <span className="text-xs text-muted-foreground">—</span>;
          const good = e.emails.filter((m) => m.syntaxValid && m.mxValid !== false).length;
          return (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {good} email{good === 1 ? "" : "s"} · {e.phones.length} phone{e.phones.length === 1 ? "" : "s"}
            </span>
          );
        },
      },
    ];
  }, [sort, order, toggleSort]);

  const table = useReactTable({
    data: leads.data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
    manualSorting: true,
    manualPagination: true,
    enableRowSelection: true,
  });

  async function saveView() {
    if (!viewName.trim()) return;
    const f: Record<string, string | number> = {};
    if (filters.q.trim()) f.q = filters.q.trim();
    if (filters.status !== ALL) f.status = filters.status;
    if (filters.tier !== ALL) f.tier = filters.tier;
    if (filters.industry !== ALL) f.industry = filters.industry;
    if (filters.icpId !== ALL) f.icpId = filters.icpId;
    if (filters.minScore !== "") f.minScore = Number(filters.minScore);
    f.sort = sort;
    f.order = order;
    try {
      await apiFetch("/api/views", { method: "POST", body: json({ name: viewName.trim(), filters: f }) });
      toast({ title: "View saved", description: viewName.trim() });
      setSavingView(false);
      setViewName("");
      views.reload();
    } catch (e) {
      toast({ title: "Could not save view", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  function applyView(v: SavedViewDto) {
    const f = v.filters;
    setFilters({
      q: String(f.q ?? ""),
      status: String(f.status ?? ALL),
      tier: String(f.tier ?? ALL),
      industry: String(f.industry ?? ALL),
      icpId: String(f.icpId ?? ALL),
      minScore: f.minScore != null ? String(f.minScore) : "",
    });
    if (f.sort) setSort(f.sort as SortField);
    if (f.order) setOrder(f.order as "asc" | "desc");
    setPage(1);
    setSelection({});
  }

  async function deleteView(v: SavedViewDto) {
    await apiFetch(`/api/views/${v.id}`, { method: "DELETE" });
    views.reload();
  }

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const data = leads.data;
  const isEmptyDb = data && data.total === 0 && activeFilterCount === 0;

  return (
    <>
      <PageHeader
        title="Leads"
        description="Cleaned, enriched and ranked by fit. Click a company for the full picture."
        actions={
          <Button variant="outline" asChild>
            <Link href="/import">Add companies</Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Label htmlFor="lead-search" className="sr-only">
            Search leads
          </Label>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input id="lead-search" className="pl-8" placeholder="Search name, domain, industry…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
        </div>

        <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter("status", v)} options={LEAD_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
        <FilterSelect label="Tier" value={filters.tier} onChange={(v) => setFilter("tier", v)} options={TIERS.map((t) => ({ value: t, label: `Tier ${t}` }))} />
        <FilterSelect label="Industry" value={filters.industry} onChange={(v) => setFilter("industry", v)} options={(facets.data?.industries ?? []).map((i) => ({ value: i.value, label: `${i.value} (${i.count})` }))} />
        <FilterSelect label="ICP" value={filters.icpId} onChange={(v) => setFilter("icpId", v)} options={(icps.data?.items ?? []).map((i) => ({ value: i.id, label: i.name }))} />
        <div className="w-24">
          <Label htmlFor="min-score" className="mb-1 block text-xs text-muted-foreground">
            Min score
          </Label>
          <Input id="min-score" type="number" min={0} max={100} value={filters.minScore} onChange={(e) => setFilter("minScore", e.target.value)} />
        </div>

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X /> Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {views.data && views.data.items.length > 0 && (
            <Select onValueChange={(id) => applyView(views.data!.items.find((v) => v.id === id)!)}>
              <SelectTrigger className="w-44" aria-label="Saved views">
                <Bookmark className="mr-1 size-4 shrink-0" />
                <SelectValue placeholder="Saved views" />
              </SelectTrigger>
              <SelectContent>
                {views.data.items.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => setSavingView(true)}>
            <Bookmark /> Save view
          </Button>
        </div>
      </div>

      {selectedIds.length > 0 && <BulkActions ids={selectedIds} onDone={() => { setSelection({}); leads.reload(); }} onClear={() => setSelection({})} />}

      {leads.error && !data ? (
        <ErrorState message={leads.error} onRetry={leads.reload} />
      ) : isEmptyDb ? (
        <EmptyState
          icon={<Table2 className="size-8" />}
          title="No leads yet"
          description="Import a CSV, paste a list, or discover companies from the sample dataset."
          action={
            <Button asChild>
              <Link href="/import">Import companies</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((h) => (
                    <TableHead key={h.id} className={h.id === "select" ? "w-10" : undefined} aria-sort={sort === h.id ? (order === "asc" ? "ascending" : "descending") : undefined}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {leads.loading && !data
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={columns.length}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : table.getRowModel().rows.length === 0
                  ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="py-12 text-center text-muted-foreground">
                        No leads match these filters.
                      </TableCell>
                    </TableRow>
                  )
                  : table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id} data-state={row.getIsSelected() ? "selected" : undefined}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                        ))}
                      </TableRow>
                    ))}
            </TableBody>
          </Table>

          {data && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
              <span aria-live="polite">
                {data.total} lead{data.total === 1 ? "" : "s"}
                {selectedIds.length > 0 && ` · ${selectedIds.length} selected`}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft />
                </Button>
                <span className="tabular-nums">
                  {page} / {data.pageCount}
                </span>
                <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= data.pageCount} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {views.data && views.data.items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {views.data.items.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
              <button type="button" className="hover:text-foreground" onClick={() => applyView(v)}>
                {v.name}
              </button>
              <button type="button" aria-label={`Delete view ${v.name}`} className="hover:text-destructive" onClick={() => deleteView(v)}>
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <LeadDrawer
        leadId={openId}
        onClose={() => setOpenId(null)}
        onChanged={leads.reload}
      />

      <Sheet open={savingView} onOpenChange={setSavingView}>
        <SheetContent side="center">
          <SheetHeader className="px-0 pt-0">
            <SheetTitle>Save current view</SheetTitle>
            <SheetDescription>Saves the filters and sort order so you can come back to them.</SheetDescription>
          </SheetHeader>
          <div className="space-y-1.5">
            <Label htmlFor="view-name">View name</Label>
            <Input id="view-name" value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveView()} placeholder="Tier A, owner-operated" autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSavingView(false)}>
              Cancel
            </Button>
            <Button onClick={saveView} disabled={!viewName.trim()}>
              Save view
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className="w-36">
      <Label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
