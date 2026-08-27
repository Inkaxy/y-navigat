import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { AlertTriangle, ClipboardCheck, Info, Loader2, Package, Search, Trash } from "lucide-react";
import { RavarerHeaderBanner } from "@/ravarer/components/RavarerHeaderBanner";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useMissingBaseQuantityLines } from "@/ravarer/hooks/useStock";
import { availabilityRank, useResaleStockStatus, type ResaleStockRow } from "@/ravarer/hooks/useResaleStock";
import { StockAdjustDialog, type AdjustMode } from "@/ravarer/components/stock/StockAdjustDialog";
import { StockMovementsSheet } from "@/ravarer/components/stock/StockMovementsSheet";
import { ReorderSuggestions } from "@/ravarer/components/stock/ReorderSuggestions";
import { MarginTable } from "@/ravarer/components/stock/MarginTable";
import { formatDate, formatNumber } from "@/ravarer/lib/constants";
import { AllStockTable } from "@/ravarer/components/stock/AllStockTable";

const kr = (n: number | null) =>
  n == null ? "—" : new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(n);

export default function LagerPage() {
  const { canWrite } = useRavarer();
  const { data: items = [], isLoading } = useResaleStockStatus();
  const { data: missingLines = [] } = useMissingBaseQuantityLines();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<ResaleStockRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
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

        <div className="grid gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Handelsvarer med lager</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{items.length}</p>
          </Card>
          <Card className={`p-4 ${belowMin > 0 ? "border-warning/50" : ""}`}>
            <p className="text-xs uppercase tracking-wider text-ink-secondary">Under minimum</p>
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

        <Tabs defaultValue="lager" className="space-y-5">
          <TabsList>
            <TabsTrigger value="lager">Videresalg</TabsTrigger>
            <TabsTrigger value="alle">Alle lagerførte varer</TabsTrigger>
            <TabsTrigger value="fortjeneste">Fortjeneste</TabsTrigger>
          </TabsList>

          <TabsContent value="lager" className="space-y-5">
            <ReorderSuggestions />

            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
                  <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk navn eller SKU…" className="pl-9" />
                </div>
                {canWrite && rows.length > 0 && (
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm">
                        <ClipboardCheck className="mr-1.5 h-4 w-4" /> Registrer telling
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

            <Card className="overflow-hidden">
              {isLoading ? (
                <div className="flex items-center justify-center p-12 text-ink-secondary">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <Package className="mb-3 h-10 w-10 text-ink-secondary" />
                  <p className="text-ink-secondary">Ingen handelsvarer med lagerføring ennå.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                      <tr>
                        <th className="px-4 py-3">Vare</th>
                        <th className="px-4 py-3 text-right">Disponibelt</th>
                        <th className="px-4 py-3 text-right">Beholdning</th>
                        <th className="px-4 py-3 text-right">
                          <Tooltip>
                            <TooltipTrigger className="inline-flex items-center gap-1 uppercase">
                              Reservert <Info className="h-3 w-3" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[260px]">
                              Bestilt av kunder på ordrer som ennå ikke er levert.
                            </TooltipContent>
                          </Tooltip>
                        </th>
                        <th className="px-4 py-3 text-right">Min. beholdning</th>
                        <th className="px-4 py-3 text-right">Dager igjen</th>
                        <th className="px-4 py-3">Neste levering</th>
                        <th className="px-4 py-3">Sist kjøpt</th>
                        <th className="px-4 py-3 text-right">Lagerverdi</th>
                        <th className="px-4 py-3 text-right">Handling</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => {
                        const rank = availabilityRank(r);
                        return (
                          <tr
                            key={r.raw_material_id}
                            onClick={() => { setSelected(r); setSheetOpen(true); }}
                            className={`cursor-pointer border-t border-line-subtle transition-colors hover:bg-muted/40 ${
                              rank === 0 ? "bg-destructive/10" : rank === 1 ? "bg-warning/10" : ""
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-medium">{r.name}</div>
                              <div className="font-mono text-xs text-ink-secondary">{r.sku}</div>
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums text-base font-bold ${rank === 0 ? "text-destructive" : ""}`}>
                              {formatNumber(r.disponibelt, 3)}{" "}
                              <span className="text-xs font-normal text-ink-secondary">{r.base_unit}</span>
                              {rank === 0 && (
                                <div className="text-xs font-normal text-destructive">Solgt mer enn det finnes</div>
                              )}
                              {rank === 2 && (
                                <div className="text-xs font-normal text-warning">Under 7 dager igjen</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatNumber(r.beholdning, 3)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                              {r.reservert ? formatNumber(r.reservert, 3) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                              {r.min_stock == null ? "—" : formatNumber(r.min_stock, 3)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                              {r.dager_igjen == null ? "—" : `${formatNumber(r.dager_igjen, 0)} dager`}
                            </td>
                            <td className="px-4 py-3 text-ink-secondary">{formatDate(r.neste_levering)}</td>
                            <td className="px-4 py-3 text-ink-secondary">{formatDate(r.sist_kjopt)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{kr(r.lagerverdi)}</td>
                            <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                              {canWrite && (
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="outline" onClick={() => openDialog(r, "count")}>
                                    <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Telling
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => openDialog(r, "waste")}>
                                    <Trash className="mr-1.5 h-3.5 w-3.5" /> Svinn
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line-subtle bg-muted/30 font-semibold">
                        <td className="px-4 py-3" colSpan={8}>
                          Samlet lagerverdi ({rows.length} varer)
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{kr(totalValue)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>

            {missingLines.length > 0 && (
              <Card className="overflow-hidden border-warning/40">
                <div className="flex items-start gap-2 border-b border-line-subtle bg-warning/10 p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">Fakturalinjer uten mengde i baseenhet</p>
                    <p className="text-sm text-ink-secondary">
                      Siste 90 dager. Linjene er matchet mot en handelsvare med lagerføring, men ga ingen innkjøpsbevegelse fordi
                      pakningsstørrelsen mangler. Fyll inn pakningen på fakturalinjen for å få mengden inn på lageret.
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                      <tr>
                        <th className="px-4 py-3">Faktura</th>
                        <th className="px-4 py-3">Dato</th>
                        <th className="px-4 py-3">Beskrivelse</th>
                        <th className="px-4 py-3">Handelsvare</th>
                        <th className="px-4 py-3 text-right">Antall</th>
                      </tr>
                    </thead>
                    <tbody>
                      {missingLines.map(l => (
                        <tr key={l.id} className="border-t border-line-subtle">
                          <td className="px-4 py-3">
                            <Link to={`/ravarer/fakturaer/${l.invoice_id}`} className="text-primary hover:underline">
                              {l.invoice_number}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-ink-secondary">{formatDate(l.invoice_date)}</td>
                          <td className="px-4 py-3">{l.description ?? "—"}</td>
                          <td className="px-4 py-3 text-ink-secondary">{l.raw_material_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatNumber(l.quantity, 2)} <span className="text-xs text-ink-secondary">{l.unit ?? ""}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="alle">
            <AllStockTable />
          </TabsContent>

          <TabsContent value="fortjeneste">
            <MarginTable />
          </TabsContent>
        </Tabs>

        <StockMovementsSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          rawMaterial={selected ? { id: selected.raw_material_id, name: selected.name, base_unit: selected.base_unit } : null}
        />
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
