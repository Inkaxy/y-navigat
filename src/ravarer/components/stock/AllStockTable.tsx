import { KpiStrip, MobileKpis } from "./MobileKpis";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck } from "lucide-react";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useAllStockStatus, type AllStockRow } from "@/ravarer/hooks/useAllStockStatus";
import { defaultCountUnit, describeInCountUnit, useRawMaterialUnitsFor } from "@/ravarer/hooks/useRawMaterialUnits";
import { StockAdjustDialog } from "./StockAdjustDialog";
import { StockPeek, type StockPeekItem } from "./StockPeek";
import { DataTable, type Column } from "@/ravarer/ui/DataTable";
import { SplitView } from "@/ravarer/ui/SplitView";
import { stockFullHref } from "@/ravarer/lib/lagerReturn";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";

const ITEM_TYPE_LABEL: Record<string, string> = {
  ravare: "Råvare",
  emballasje: "Emballasje",
  forbruksvare: "Forbruksvare",
  videresalg: "Videresalg",
};

/**
 * Alle lagerførte varer — råvarer, emballasje og handelsvarer. Søk (`q`) og valgt vare (`valgt`) ligger i
 * adressen, som for videresalg. Beholdning vises i varens telleenhet; lasting/feil gir aldri tall som 0.
 */
export function AllStockTable({ q, selectedId, onSelect }: { q: string; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { canWrite } = useRavarer();
  const [sp] = useSearchParams();
  const query = useAllStockStatus();
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const { data: unitsByRm } = useRawMaterialUnitsFor(rows.map(r => r.raw_material_id));
  const [countRow, setCountRow] = useState<AllStockRow | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => !needle || `${r.name} ${r.sku} ${r.category ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const ready = !!query.data && !query.isError;
  const belowMin = filtered.filter(r => r.min_stock != null && r.current_stock <= r.min_stock).length;
  const totalValue = filtered.reduce((s, r) => s + (r.stock_value ?? 0), 0);
  const kpi = (v: string) => (ready ? v : query.isError ? "–" : "…");
  const stockText = (r: AllStockRow) => describeInCountUnit(r.current_stock, r.base_unit, defaultCountUnit(unitsByRm?.get(r.raw_material_id)), formatNumber);
  const under = (r: AllStockRow) => r.min_stock != null && r.current_stock <= r.min_stock;

  const columns: Column<AllStockRow>[] = [
    { id: "name", header: "Vare", alwaysVisible: true, sortKey: r => r.name, cell: r => (
      <span className="flex flex-col"><span className="font-medium">{r.name}</span><span className="font-mono text-xs text-ink-secondary">{r.sku}</span></span>
    ) },
    { id: "type", header: "Type", sortKey: r => r.item_type, cell: r => <span className="text-ink-secondary">{ITEM_TYPE_LABEL[r.item_type] ?? r.item_type}</span> },
    { id: "beh", header: "Beholdning", align: "right", sortKey: r => r.current_stock, cell: r => (
      <span className={`tabular-nums font-medium ${r.current_stock < 0 ? "text-destructive" : ""}`}>
        {stockText(r)}
        {under(r) && <span className="block text-xs font-normal text-warning">Under minimum</span>}
      </span>
    ) },
    { id: "min", header: "Min.", align: "right", sortKey: r => r.min_stock ?? -1, cell: r => <span className="tabular-nums text-ink-secondary">{r.min_stock == null ? "—" : `${formatNumber(r.min_stock, 3)} ${r.base_unit}`}</span> },
    { id: "verdi", header: "Lagerverdi", align: "right", sortKey: r => r.stock_value ?? -1, cell: r => <span className="tabular-nums">{formatNok(r.stock_value)}</span> },
    { id: "inn", header: "Sist inn", sortKey: r => r.last_in ?? "", cell: r => <span className="text-ink-secondary">{formatDate(r.last_in)}</span> },
    { id: "ut", header: "Sist ut", sortKey: r => r.last_out ?? "", cell: r => <span className="text-ink-secondary">{formatDate(r.last_out)}</span> },
    { id: "act", header: "Handling", align: "right", cell: r => canWrite ? (
      <Button size="sm" variant="outline" className="min-h-[44px] xl:min-h-8" onClick={e => { e.stopPropagation(); setCountRow(r); }}>
        <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Telling
      </Button>
    ) : null },
  ];

  const selectedRow = selectedId ? rows.find(r => r.raw_material_id === selectedId) ?? null : null;
  const peekItem: StockPeekItem | null = selectedRow ? {
    rawMaterialId: selectedRow.raw_material_id,
    name: selectedRow.name,
    sku: selectedRow.sku,
    facts: [
      ["Type", ITEM_TYPE_LABEL[selectedRow.item_type] ?? selectedRow.item_type],
      ["Beholdning", stockText(selectedRow)],
      ["Min. beholdning", selectedRow.min_stock == null ? "—" : `${formatNumber(selectedRow.min_stock, 3)} ${selectedRow.base_unit}`],
      ["Lagerverdi", formatNok(selectedRow.stock_value)],
      ["Sist inn", formatDate(selectedRow.last_in)],
      ["Sist ut", formatDate(selectedRow.last_out)],
    ],
  } : null;

  return (
    <div className="space-y-5">
      <MobileKpis testId="all-stock-kpis-mobile" secondaryLabel="Lagerverdi"
        primary={[
          { label: "Lagerførte varer", value: kpi(String(rows.length)) },
          { label: "Under minimum", value: kpi(String(belowMin)), tone: ready && belowMin > 0 ? "warning" : undefined },
        ]}
        secondary={[{ label: "Samlet lagerverdi", value: kpi(formatNok(totalValue)) }]} />
      <KpiStrip testId="all-stock-kpis" items={[
        { label: "Lagerførte varer", value: kpi(String(rows.length)) },
        { label: "Under minimum", value: kpi(String(belowMin)), tone: ready && belowMin > 0 ? "warning" : undefined },
        { label: "Samlet lagerverdi", value: kpi(formatNok(totalValue)) },
      ]} />

      <SplitView
        selected={!!selectedId}
        list={
          <div className="space-y-2">
            <DataTable
              ariaLabel="Alle lagerførte varer"
              rows={ready ? filtered : undefined}
              columns={columns}
              getId={r => r.raw_material_id}
              isLoading={query.isLoading}
              error={query.error}
              onRetry={() => void query.refetch()}
              emptyText={q.trim() ? "Ingen treff." : "Ingen varer med lagerføring."}
              activeId={selectedId}
              onActiveChange={id => onSelect(id)}
              onRowClick={r => onSelect(r.raw_material_id)}
              preferenceScope="ravarer:lager-alle:kolonner"
              renderMobileCard={r => (
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span>
                    <span className={`shrink-0 tabular-nums font-semibold ${r.current_stock < 0 ? "text-destructive" : ""}`}>{stockText(r)}</span>
                  </div>
                  <div className="text-caption text-ink-secondary">
                    {ITEM_TYPE_LABEL[r.item_type] ?? r.item_type} · min {r.min_stock == null ? "—" : `${formatNumber(r.min_stock, 3)} ${r.base_unit}`} · {formatNok(r.stock_value)}
                  </div>
                  {under(r) && <div className="text-caption text-warning">Under minimum</div>}
                </div>
              )}
            />
            {ready && filtered.length > 0 && (
              <p className="text-sm text-ink-secondary">Samlet lagerverdi ({filtered.length} varer): <span className="font-semibold tabular-nums text-ink-primary">{formatNok(totalValue)}</span></p>
            )}
          </div>
        }
        panel={
          <StockPeek
            item={peekItem}
            fullHref={selectedRow ? stockFullHref(sp, selectedRow.raw_material_id) : undefined}
            canWrite={canWrite}
            onClose={() => onSelect(null)}
            onCount={selectedRow ? () => setCountRow(selectedRow) : undefined}
          />
        }
      />

      <StockAdjustDialog
        open={!!countRow}
        onOpenChange={v => { if (!v) setCountRow(null); }}
        mode="count"
        rawMaterial={countRow ? { id: countRow.raw_material_id, name: countRow.name, base_unit: countRow.base_unit, current_stock: countRow.current_stock } : null}
      />
    </div>
  );
}
