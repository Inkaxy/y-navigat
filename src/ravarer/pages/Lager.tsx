import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ClipboardCheck, Search, Trash } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { availabilityRank, useResaleStockStatus, type ResaleStockRow } from "@/ravarer/hooks/useResaleStock";
import { StockAdjustDialog, type AdjustMode } from "@/ravarer/components/stock/StockAdjustDialog";
import { StockPeek } from "@/ravarer/components/stock/StockPeek";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { SplitView } from "@/ravarer/ui/SplitView";
import { Link } from "react-router-dom";
import { KpiStrip, MobileKpis } from "@/ravarer/components/stock/MobileKpis";
import { paths } from "@/ravarer/lib/paths";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { AllStockTable } from "@/ravarer/components/stock/AllStockTable";
import { stockFullHref } from "@/ravarer/lib/lagerReturn";

const kr = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(n);

export default function LagerPage() {
  const { canWrite } = useRavarer();
  // Samme tall som Lager-merket i menyen og Beholdning-fanen (alle lagerførte, beholdning < min).
  const { data: summary } = useWorkSummary({ includeApproval: false });
  const belowMinAll = summary?.other.stock_below_min ?? null;
  const stockQuery = useResaleStockStatus();
  const { data: items = [], isLoading } = stockQuery;
  const [sp, setSp] = useSearchParams();
  // Beholdning: «Videresalg» (standard) eller «Alle lagerførte» i adressen.
  const filter = sp.get("filter") === "alle" ? "alle" : "videresalg";
  const setFilter = (v: "alle" | "videresalg") =>
    setSp(prev => {
      const p = new URLSearchParams(prev);
      if (v === "alle") p.set("filter", "alle");
      else p.delete("filter");
      // Valgt vare hører til utvalget; søket beholdes.
      p.delete("valgt");
      return p;
    }, { replace: true });
  // Søk og valgt vare ligger i adressen (`q`, `valgt`) for begge utvalg — fullt kort tar dem med i retur.
  const q = sp.get("q") ?? "";
  const setQ = (v: string) =>
    setSp(prev => {
      const p = new URLSearchParams(prev);
      if (v) p.set("q", v);
      else p.delete("q");
      return p;
    }, { replace: true });
  const selectedId = sp.get("valgt");
  const setValgt = (id: string | null) =>
    setSp(prev => {
      const p = new URLSearchParams(prev);
      if (id) p.set("valgt", id);
      else p.delete("valgt");
      return p;
    }, { replace: true });
  const [selected, setSelected] = useState<ResaleStockRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<AdjustMode>("count");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = items.filter(i => !needle || `${i.name} ${i.sku}`.toLowerCase().includes(needle));
    return arr.sort((a, b) => {
      const ra = availabilityRank(a);
      const rb = availabilityRank(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "nb");
    });
  }, [items, q]);

  const selectedRow = selectedId ? items.find(i => i.raw_material_id === selectedId) ?? null : null;

  const columns: Column<ResaleStockRow>[] = [
    { id: "name", header: "Vare", alwaysVisible: true, sortKey: r => r.name, cell: r => (
      <span className="flex flex-col"><span className="font-medium">{r.name}</span><span className="font-mono text-xs text-ink-secondary">{r.sku}</span></span>
    ) },
    { id: "disp", header: "Disponibelt", align: "right", sortKey: r => r.disponibelt, cell: r => {
      const rank = availabilityRank(r);
      return (
        <span className={`tabular-nums font-bold ${rank === 0 ? "text-destructive" : ""}`}>
          {formatNumber(r.disponibelt, 3)} <span className="text-xs font-normal text-ink-secondary">{r.base_unit}</span>
          {rank === 0 && <span className="block text-xs font-normal text-destructive">Solgt mer enn det finnes</span>}
          {rank === 2 && <span className="block text-xs font-normal text-warning">Under 7 dager igjen</span>}
        </span>
      );
    } },
    { id: "beh", header: "Beholdning", align: "right", sortKey: r => r.beholdning, cell: r => <span className="tabular-nums">{formatNumber(r.beholdning, 3)}</span> },
    { id: "res", header: "Reservert", align: "right", sortKey: r => r.reservert ?? 0, cell: r => <span className="tabular-nums text-ink-secondary">{r.reservert ? formatNumber(r.reservert, 3) : "—"}</span> },
    { id: "min", header: "Min. beholdning", align: "right", sortKey: r => r.min_stock ?? -1, cell: r => <span className="tabular-nums text-ink-secondary">{r.min_stock == null ? "—" : formatNumber(r.min_stock, 3)}</span> },
    { id: "dager", header: "Dager igjen", align: "right", sortKey: r => r.dager_igjen ?? Number.MAX_SAFE_INTEGER, cell: r => <span className="tabular-nums text-ink-secondary">{r.dager_igjen == null ? "—" : `${formatNumber(r.dager_igjen, 0)} dager`}</span> },
    { id: "neste", header: "Neste levering", sortKey: r => r.neste_levering ?? "", cell: r => <span className="text-ink-secondary">{formatDate(r.neste_levering)}</span> },
    { id: "sist", header: "Sist kjøpt", sortKey: r => r.sist_kjopt ?? "", cell: r => <span className="text-ink-secondary">{formatDate(r.sist_kjopt)}</span> },
    { id: "verdi", header: "Lagerverdi", align: "right", sortKey: r => r.lagerverdi ?? -1, cell: r => <span className="tabular-nums">{kr(r.lagerverdi)}</span> },
    { id: "act", header: "Handling", align: "right", cell: r => canWrite ? (
      <span className="flex justify-end gap-1">
        <Button size="sm" variant="outline" className="min-h-[44px] xl:min-h-8" onClick={() => openDialog(r, "count")}><ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Telling</Button>
        <Button size="sm" variant="ghost" className="min-h-[44px] xl:min-h-8" onClick={() => openDialog(r, "waste")}><Trash className="mr-1.5 h-3.5 w-3.5" /> Svinn</Button>
      </span>
    ) : null },
  ];

  const ready = !!stockQuery.data && !stockQuery.isError;
  const kpi = (v: string) => (ready ? v : stockQuery.isError ? "–" : "…");
  const negatives = rows.filter(r => r.disponibelt < 0).length;
  const belowMin = rows.filter(r => availabilityRank(r) === 1).length;
  const totalValue = rows.reduce((s, r) => s + (r.lagerverdi ?? 0), 0);

  const openDialog = (item: ResaleStockRow, m: AdjustMode) => {
    setSelected(item);
    setMode(m);
    setDialogOpen(true);
  };

  const asRawMaterial = (r: ResaleStockRow) => ({
    id: r.raw_material_id,
    name: r.name,
    base_unit: r.base_unit,
    current_stock: r.beholdning,
  });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        <RavarerHeaderBanner />

        <KpiStrip testId="stock-kpis-desktop" items={[
          { label: "Handelsvarer med lager", value: kpi(String(items.length)) },
          { label: "Under minimum (alle lagerførte)", value: belowMinAll == null ? "–" : String(belowMinAll), tone: belowMinAll ? "warning" : undefined },
          { label: "Videresalg under minimum", value: kpi(String(belowMin)), tone: ready && belowMin > 0 ? "warning" : undefined },
          { label: "Oversolgt", value: kpi(String(negatives)), tone: ready && negatives > 0 ? "destructive" : undefined },
          { label: "Lagerverdi", value: kpi(kr(totalValue)) },
        ]} />

        <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Utvalg" className="inline-flex rounded-md border border-line-subtle p-1">
          {(["videresalg", "alle"] as const).map(v => (
            <button
              key={v}
              role="radio"
              aria-checked={filter === v}
              onClick={() => setFilter(v)}
              className={`min-h-[44px] rounded px-4 text-sm ${filter === v ? "bg-muted font-medium" : "text-ink-secondary"}`}
            >
              {v === "videresalg" ? "Videresalg" : "Alle lagerførte"}
            </button>
          ))}
        </div>
        {canWrite && (
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link to={paths.lager({ fane: "telling" })}><ClipboardCheck className="mr-1.5 h-4 w-4" aria-hidden />Registrer telling</Link>
          </Button>
        )}
        </div>

        {filter === "videresalg" ? (
          <MobileKpis testId="stock-kpis-mobile" secondaryLabel="Flere nøkkeltall"
            primary={[
              { label: "Videresalg under minimum", value: kpi(String(belowMin)), tone: ready && belowMin > 0 ? "warning" : undefined },
              { label: "Oversolgt", value: kpi(String(negatives)), tone: ready && negatives > 0 ? "destructive" : undefined },
            ]}
            secondary={[
              { label: "Handelsvarer med lager", value: kpi(String(items.length)) },
              { label: "Lagerverdi (videresalg)", value: kpi(kr(totalValue)) },
              { label: "Under minimum (alle lagerførte)", value: belowMinAll == null ? "–" : String(belowMinAll) },
            ]} />
        ) : (
          <MobileKpis testId="stock-kpis-mobile" primary={[]} secondaryLabel="Nøkkeltall for videresalg"
            secondary={[
              { label: "Handelsvarer med lager", value: kpi(String(items.length)) },
              { label: "Videresalg under minimum", value: kpi(String(belowMin)) },
              { label: "Oversolgt", value: kpi(String(negatives)) },
              { label: "Lagerverdi (videresalg)", value: kpi(kr(totalValue)) },
            ]} />
        )}

        {filter === "alle" ? (
          <div className="space-y-5">
            <Card className="p-4">
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk navn, SKU eller kategori…" aria-label="Søk i alle lagerførte varer" className="h-[44px] pl-9 xl:h-10" />
              </div>
            </Card>
            <AllStockTable q={q} selectedId={selectedId} onSelect={setValgt} />
          </div>
        ) : (
          <div className="space-y-5">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                  <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk navn eller SKU…" aria-label="Søk i lagerførte varer" className="h-[44px] pl-9 xl:h-10" />
                </div>
                {canWrite && rows.length > 0 && (
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="min-h-[44px] xl:min-h-9">
                        <ClipboardCheck className="mr-1.5 h-4 w-4" /> Telling for én vare
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0" align="end">
                      <Command>
                        <CommandInput placeholder="Velg vare…" />
                        <CommandList>
                          <CommandEmpty>Ingen treff.</CommandEmpty>
                          <CommandGroup>
                            {rows.map(r => (
                              <CommandItem
                                key={r.raw_material_id}
                                value={`${r.name} ${r.sku}`}
                                onSelect={() => { setPickerOpen(false); openDialog(r, "count"); }}
                              >
                                {r.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </Card>

            <SplitView
              selected={!!selectedId}
              list={
                <div className="space-y-2">
                  <DataTable
                    ariaLabel="Lagerførte handelsvarer"
                    rows={stockQuery.data ? rows : undefined}
                    columns={columns}
                    getId={r => r.raw_material_id}
                    isLoading={isLoading}
                    error={stockQuery.error}
                    onRetry={() => void stockQuery.refetch()}
                    emptyText="Ingen handelsvarer med lagerføring ennå."
                    activeId={selectedId}
                    onActiveChange={id => setValgt(id)}
                    onRowClick={r => setValgt(r.raw_material_id)}
                    preferenceScope="ravarer:lager:kolonner"
                    renderMobileCard={r => {
                      const rank = availabilityRank(r);
                      return (
                        <div className="space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span>
                            <span className={`shrink-0 tabular-nums font-semibold ${rank === 0 ? "text-destructive" : ""}`}>{formatNumber(r.disponibelt, 3)} {r.base_unit}</span>
                          </div>
                          <div className="text-caption text-ink-secondary">
                            Beholdning {formatNumber(r.beholdning, 3)} · min {r.min_stock == null ? "—" : formatNumber(r.min_stock, 3)} · {r.dager_igjen == null ? "dager ukjent" : `${formatNumber(r.dager_igjen, 0)} dager igjen`}
                          </div>
                          {rank === 0 && <div className="text-caption text-destructive">Solgt mer enn det finnes</div>}
                          {rank === 1 && <div className="text-caption text-warning">Under minimum</div>}
                          {rank === 2 && <div className="text-caption text-warning">Under 7 dager igjen</div>}
                        </div>
                      );
                    }}
                  />
                  {stockQuery.data && rows.length > 0 && (
                    <p className="text-sm text-ink-secondary">Samlet lagerverdi ({rows.length} varer): <span className="font-semibold tabular-nums text-ink-primary">{kr(totalValue)}</span></p>
                  )}
                </div>
              }
              panel={
                <StockPeek
                  item={selectedRow ? {
                    rawMaterialId: selectedRow.raw_material_id,
                    name: selectedRow.name,
                    sku: selectedRow.sku,
                    facts: [
                      ["Disponibelt", `${formatNumber(selectedRow.disponibelt, 3)} ${selectedRow.base_unit}`],
                      ["Beholdning", `${formatNumber(selectedRow.beholdning, 3)} ${selectedRow.base_unit}`],
                      ["Reservert (kundeordrer ikke levert)", selectedRow.reservert ? formatNumber(selectedRow.reservert, 3) : "—"],
                      ["Min. beholdning", selectedRow.min_stock == null ? "—" : formatNumber(selectedRow.min_stock, 3)],
                      ["Dager igjen", selectedRow.dager_igjen == null ? "—" : `${formatNumber(selectedRow.dager_igjen, 0)} dager`],
                      ["Neste levering", formatDate(selectedRow.neste_levering)],
                      ["Sist kjøpt", formatDate(selectedRow.sist_kjopt)],
                      ["Lagerverdi", kr(selectedRow.lagerverdi)],
                    ],
                  } : null}
                  fullHref={selectedRow ? stockFullHref(sp, selectedRow.raw_material_id) : undefined}
                  canWrite={canWrite}
                  onClose={() => setValgt(null)}
                  onCount={selectedRow ? () => openDialog(selectedRow, "count") : undefined}
                  onWaste={selectedRow ? () => openDialog(selectedRow, "waste") : undefined}
                />
              }
            />

          </div>
        )}

        <StockAdjustDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode={mode}
          rawMaterial={selected ? asRawMaterial(selected) : null}
        />
      </div>
    </TooltipProvider>
  );
}
