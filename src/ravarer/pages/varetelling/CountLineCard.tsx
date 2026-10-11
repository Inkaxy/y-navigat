import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AllStockRow } from "@/ravarer/hooks/useAllStockStatus";
import type { RawMaterialUnitRow } from "@/ravarer/hooks/useRawMaterialUnits";
import { UnitAmountRows, type UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";

/**
 * Ett tellekort. Ren visning: all tilstand og alle handlere eies av tellesiden (utkast, frosset grunnlag, låsing).
 * På mobil stables navn, lokasjon/notat og mengde i full bredde; fra `sm` ligger mengden til høyre.
 */
export function CountLineCard({
  row: r, unitText, frozenBase, onUseNewStock, location, onLocation, note, onNote, rows, onRows, units, diff,
}: {
  row: Pick<AllStockRow, "raw_material_id" | "name" | "current_stock" | "base_unit" | "current_cost_price">;
  unitText: string | null;
  /** Frosset forventet beholdning når den avviker fra dagens; ellers null. */
  frozenBase: number | null;
  onUseNewStock: () => void;
  location: string;
  onLocation: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
  rows: UnitAmountRow[];
  onRows: (rows: UnitAmountRow[]) => void;
  units: RawMaterialUnitRow[];
  diff: number | null;
}) {
  return (
    <Card className="p-4" data-testid="count-line-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="w-full min-w-0 sm:w-auto sm:min-w-[200px] sm:flex-1">
          <p className="break-words font-medium">{r.name}</p>
          <p className="text-xs text-ink-secondary">
            Bokført: {formatNumber(r.current_stock, 2)} {r.base_unit}
            {unitText && <> · {unitText}</>}
          </p>
          {frozenBase != null && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-warning">
              <span>
                Talt mot {formatNumber(frozenBase, 2)} {r.base_unit} — beholdningen er nå {formatNumber(r.current_stock, 2)}
              </span>
              <Button size="sm" variant="outline" className="min-h-[44px] sm:min-h-0" onClick={onUseNewStock}>
                Bruk ny beholdning
              </Button>
            </div>
          )}
          <Input
            value={location}
            onChange={e => onLocation(e.target.value)}
            placeholder="Lokasjon"
            aria-label={`Lokasjon for ${r.name}`}
            className="mt-2 h-[44px] w-full text-sm sm:h-9"
          />
          <Input
            value={note}
            onChange={e => onNote(e.target.value)}
            placeholder="Notat"
            aria-label={`Notat for ${r.name}`}
            className="mt-2 h-[44px] w-full text-sm sm:h-9"
          />
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <UnitAmountRows label={`Telt mengde for ${r.name}`} rows={rows} onChange={onRows} units={units} baseUnit={r.base_unit} compact />
          {diff != null && (
            <Badge
              variant="outline"
              className={"self-start sm:self-auto " + (diff < 0 ? "border-destructive/50 text-destructive" : diff > 0 ? "border-success/50 text-success" : "")}
            >
              {diff > 0 ? "+" : ""}
              {formatNumber(diff, 2)} {r.base_unit}
              {r.current_cost_price != null && <> · {formatNok(diff * r.current_cost_price)}</>}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
