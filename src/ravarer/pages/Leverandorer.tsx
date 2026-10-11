import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSuppliers, useSyncSuppliersFromTripletex, type SupplierRow } from "@/ravarer/hooks/useSuppliers";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { NewSupplierDialog, SupplierDialog } from "@/ravarer/components/NewSupplierDialog";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { SplitView } from "@/ravarer/ui/SplitView";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { readSupplierView, type SupplierView } from "@/ravarer/lib/supplierSections";
import { SupplierPeek, supplierFullHref } from "@/ravarer/components/supplier/SupplierPeek";
import { SupplierStatusBadge, TrackInvoiceToggle, TRACK_HELP_SHORT } from "@/ravarer/components/supplier/TrackInvoiceToggle";

const VIEWS: [SupplierView, string][] = [["alle", "Alle"], ["folges", "Kun følges"], ["aktive", "Kun aktive"]];

/** Samme filterregler som før: «Vis inaktive» dekker lokalt og Tripletex-inaktive. */
export function filterSuppliers(rows: readonly SupplierRow[], q: string, view: SupplierView, showInactive: boolean): SupplierRow[] {
  const t = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (!showInactive && (r.tripletex_is_inactive || !r.is_active)) return false;
    if (view === "folges" && !r.track_invoice_lines) return false;
    if (view === "aktive" && !r.is_active) return false;
    if (!t) return true;
    return r.name.toLowerCase().includes(t) || (r.org_number ?? "").toLowerCase().includes(t) || (r.contact_email ?? "").toLowerCase().includes(t);
  });
}

/** Leverandørlisten: URL-styrt søk (`q`), visning, inaktive og valgt (`valgt`); peek fra 1280 px, fullside på mobil. */
export default function LeverandorerPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const { canWrite } = useRavarer();
  const q = useSuppliers();
  const sync = useSyncSuppliersFromTripletex();
  const [newOpen, setNewOpen] = useState(false);
  const [editRow, setEditRow] = useState<SupplierRow | null>(null);

  const search = sp.get("q") ?? "";
  const view = readSupplierView(sp);
  const showInactive = sp.get("inaktive") === "1";
  const selectedId = sp.get("valgt");
  const set = (k: string, v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const rows = q.data ?? [];
  const filtered = useMemo(() => filterSuppliers(rows, search, view, showInactive), [rows, search, view, showInactive]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  // Listekontekst uten `fane` (hubben eier den) — brukes som «Tilbake» fra kortet.
  const listSearch = useMemo(() => { const n = new URLSearchParams(sp); n.delete("fane"); return n.toString(); }, [sp]);
  const tracked = rows.filter((r) => r.track_invoice_lines).length;

  const columns: Column<SupplierRow>[] = [
    { id: "name", header: "Navn", alwaysVisible: true, sortKey: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "org", header: "Org.nr", sortKey: (r) => r.org_number ?? "", cell: (r) => <span className="font-mono text-xs">{r.org_number ?? "—"}</span> },
    { id: "status", header: "Status", cell: (r) => <SupplierStatusBadge s={r} /> },
    { id: "track", header: "Følg fakturalinjer", cell: (r) => <TrackInvoiceToggle supplier={r} canWrite={canWrite} /> },
    { id: "last", header: "Siste faktura", sortKey: (r) => r.last_invoice_date ?? "", cell: (r) => formatDate(r.last_invoice_date) },
    { id: "count", header: "Antall", align: "right", sortKey: (r) => r.invoice_count ?? -1, cell: (r) => (r.invoice_count != null ? formatNumber(r.invoice_count, 0) : "—") },
    { id: "edit", header: "", cell: (r) => canWrite ? <Button size="sm" variant="ghost" className="min-h-[44px] md:min-h-8" onClick={() => setEditRow(r)}>Rediger</Button> : null },
  ];

  const open = (r: SupplierRow) => {
    if (isMobile) navigate(supplierFullHref(r.id, (() => { const n = new URLSearchParams(listSearch); n.set("valgt", r.id); return n.toString(); })()));
    else set("valgt", r.id);
  };

  const list = (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-line-subtle p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
          <Input aria-label="Søk leverandør" value={search} onChange={(e) => set("q", e.target.value || null)} placeholder="Søk navn, org.nr eller e-post…" className="h-[44px] pl-9 md:h-10" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Visning">
            {VIEWS.map(([k, label]) => (
              <Button key={k} size="sm" variant={view === k ? "default" : "outline"} aria-pressed={view === k} className="min-h-[44px] md:min-h-8" onClick={() => set("visning", k === "alle" ? null : k)}>{label}</Button>
            ))}
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink-secondary md:min-h-0">
            <Switch checked={showInactive} onCheckedChange={(v) => set("inaktive", v ? "1" : null)} />Vis inaktive
          </label>
          <span className="text-sm text-ink-secondary">{filtered.length} leverandører · {tracked} følges</span>
        </div>
        <p className="text-caption text-ink-secondary">{TRACK_HELP_SHORT}</p>
      </div>
      <DataTable
        ariaLabel="Leverandører"
        rows={q.data ? filtered : undefined}
        columns={columns}
        getId={(r) => r.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        emptyText="Ingen leverandører funnet."
        activeId={selectedId}
        onActiveChange={(id) => set("valgt", id)}
        onRowClick={open}
        onEnter={(r) => navigate(supplierFullHref(r.id, listSearch))}
        hotkeys
        preferenceScope="ravarer:leverandorer:kolonner"
        renderMobileCard={(r) => (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2"><span className="font-medium [overflow-wrap:anywhere]">{r.name}</span><SupplierStatusBadge s={r} /></div>
            <div className="text-caption text-ink-secondary">{r.invoice_count != null ? `${formatNumber(r.invoice_count, 0)} fakturaer` : "Ingen fakturaer"} · siste {formatDate(r.last_invoice_date)}</div>
            <div className="flex items-center gap-2 text-sm"><TrackInvoiceToggle supplier={r} canWrite={canWrite} /><span>Følg fakturalinjer</span></div>
          </div>
        )}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" className="min-h-[44px] gap-1.5 md:min-h-9" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}Hent fra Tripletex
          </Button>
          <Button size="sm" className="min-h-[44px] gap-1.5 md:min-h-9" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" aria-hidden />Ny leverandør</Button>
        </div>
      )}
      <NewSupplierDialog open={newOpen} onOpenChange={setNewOpen} />
      <SupplierDialog key={editRow?.id ?? "none"} open={!!editRow} onOpenChange={(v) => !v && setEditRow(null)} supplier={editRow} />
      <SplitView
        selected={isMobile ? undefined : !!selected}
        list={list}
        panel={<SupplierPeek supplier={selected} listSearch={listSearch} canWrite={canWrite} onClose={() => set("valgt", null)} />}
      />
    </div>
  );
}
