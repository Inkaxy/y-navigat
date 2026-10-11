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
import { paths } from "@/ravarer/lib/paths";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { AllStockTable } from "@/ravarer/components/stock/AllStockTable";

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
      return p;
    }, { replace: true });
  const [q, setQ] = useState("");
  // Valgt vare i adressen (`valgt=<råvare-id>`): peek fra 1280 px, full bredde under.
  const selectedId = filter === "videresalg" ? sp.get("valgt") : null;
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Handelsvarer med lager</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{items.length}</p>
          </Card>
          <Card className={`p-4 ${belowMinAll ? "border-warning/50" : ""}`}>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Under minimum (alle lagerførte)</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{belowMinAll ?? "–"}</p>
          </Card>
          <Card className={`p-4 ${belowMin > 0 ? "border-warning/50" : ""}`}>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Videresalg: disponibelt under minimum</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{belowMin}</p>
          </Card>
          <Card className={`p-4 ${negatives > 0 ? "border-destructive/50" : ""}`}>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Oversolgt</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${negatives > 0 ? "text-destructive" : ""}`}>{negatives}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Lagerverdi</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{kr(totalValue)}</p>
          </Card>
        </div>

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

        {filter === "alle" ? (
          <AllStockTable />
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
              panel={<StockPeek row={selectedRow} canWrite={canWrite} onClose={() => setValgt(null)} onAdjust={openDialog} kr={kr} />}
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
