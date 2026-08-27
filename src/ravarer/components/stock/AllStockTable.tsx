import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Loader2, Package, Search } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useAllStockStatus, type AllStockRow } from "@/ravarer/hooks/useAllStockStatus";
import {
  defaultCountUnit,
  describeInCountUnit,
  useRawMaterialUnitsFor,
} from "@/ravarer/hooks/useRawMaterialUnits";
import { StockAdjustDialog } from "./StockAdjustDialog";
import { StockMovementsSheet } from "./StockMovementsSheet";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";

const ITEM_TYPE_LABEL: Record<string, string> = {
  ravare: "Råvare",
  emballasje: "Emballasje",
  forbruksvare: "Forbruksvare",
  videresalg: "Videresalg",
};

/** Alle lagerførte varer — råvarer, emballasje og handelsvarer. */
export function AllStockTable() {
  const { canWrite } = useRavarer();
  const { data: rows = [], isLoading } = useAllStockStatus();
  const { data: unitsByRm } = useRawMaterialUnitsFor(rows.map(r => r.raw_material_id));
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<AllStockRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => !needle || `${r.name} ${r.sku} ${r.category ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const belowMin = filtered.filter(r => r.min_stock != null && r.current_stock <= r.min_stock).length;
  const totalValue = filtered.reduce((s, r) => s + (r.stock_value ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Lagerførte varer</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{rows.length}</p>
        </Card>
        <Card className={`p-4 ${belowMin > 0 ? "border-warning/50" : ""}`}>
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Under minimum</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{belowMin}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-ink-secondary">Samlet lagerverdi</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNok(totalValue)}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk navn, SKU eller kategori…" className="pl-9" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-ink-secondary">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laster…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Package className="mb-3 h-10 w-10 text-ink-secondary" />
            <p className="text-ink-secondary">Ingen varer med lagerføring.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Vare</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Beholdning</th>
                  <th className="px-4 py-3 text-right">Min.</th>
                  <th className="px-4 py-3 text-right">Lagerverdi</th>
                  <th className="px-4 py-3">Sist inn</th>
                  <th className="px-4 py-3">Sist ut</th>
                  <th className="px-4 py-3 text-right">Handling</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const under = r.min_stock != null && r.current_stock <= r.min_stock;
                  const countUnit = defaultCountUnit(unitsByRm?.get(r.raw_material_id));
                  return (
                    <tr
                      key={r.raw_material_id}
                      onClick={() => { setSelected(r); setSheetOpen(true); }}
                      className={`cursor-pointer border-t border-line-subtle transition-colors hover:bg-muted/40 ${
                        r.current_stock < 0 ? "bg-destructive/10" : under ? "bg-warning/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-xs text-ink-secondary">{r.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{ITEM_TYPE_LABEL[r.item_type] ?? r.item_type}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${r.current_stock < 0 ? "text-destructive" : ""}`}>
                        {describeInCountUnit(r.current_stock, r.base_unit, countUnit, formatNumber)}
                        {under && <div className="text-xs font-normal text-warning">Under minimum</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">
                        {r.min_stock == null ? "—" : `${formatNumber(r.min_stock, 3)} ${r.base_unit}`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNok(r.stock_value)}</td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDate(r.last_in)}</td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDate(r.last_out)}</td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {canWrite && (
                          <Button size="sm" variant="outline" onClick={() => { setSelected(r); setCountOpen(true); }}>
                            <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Telling
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-subtle bg-muted/30 font-semibold">
                  <td className="px-4 py-3" colSpan={4}>Samlet lagerverdi ({filtered.length} varer)</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNok(totalValue)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <StockMovementsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        rawMaterial={selected ? { id: selected.raw_material_id, name: selected.name, base_unit: selected.base_unit } : null}
      />
      <StockAdjustDialog
        open={countOpen}
        onOpenChange={setCountOpen}
        mode="count"
        rawMaterial={
          selected
            ? {
                id: selected.raw_material_id,
                name: selected.name,
                base_unit: selected.base_unit,
                current_stock: selected.current_stock,
              }
            : null
        }
      />
    </div>
  );
}
