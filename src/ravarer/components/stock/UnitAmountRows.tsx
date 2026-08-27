import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { RawMaterialUnitRow } from "@/ravarer/hooks/useRawMaterialUnits";
import { formatNumber } from "@/ravarer/lib/constants";

export interface UnitAmountRow {
  /** Fritekst slik brukeren skrev den (støtter komma). */
  amount: string;
  /** Enhetsnøkkel: "__base" eller unit-id. */
  unitKey: string;
}

export const BASE_KEY = "__base";

export const emptyRow = (): UnitAmountRow => ({ amount: "", unitKey: BASE_KEY });

export function parseAmount(value: string): number | null {
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Regner delsummene om til baseenhet. Returnerer null når ingenting er tastet inn. */
export function rowsToBase(rows: UnitAmountRow[], units: RawMaterialUnitRow[]): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const n = parseAmount(r.amount);
    if (n == null) continue;
    any = true;
    if (r.unitKey === BASE_KEY) total += n;
    else {
      const u = units.find(x => x.id === r.unitKey);
      total += n * (u ? Number(u.units_in_base) || 1 : 1);
    }
  }
  return any ? total : null;
}

interface Props {
  rows: UnitAmountRow[];
  onChange: (rows: UnitAmountRow[]) => void;
  units: RawMaterialUnitRow[];
  baseUnit: string;
  /** Skjul «Legg til delsum» når bare én rad er ønsket. */
  allowMultiple?: boolean;
  compact?: boolean;
}

/** Mengde-input med enhetsvelger og valgfrie delsummer («4 sekker» + «12,5 kg»). */
export function UnitAmountRows({ rows, onChange, units, baseUnit, allowMultiple = true, compact }: Props) {
  const setRow = (i: number, patch: Partial<UnitAmountRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            className={compact ? "h-11 w-28 text-right tabular-nums" : "h-11 text-right tabular-nums"}
            value={row.amount}
            placeholder="0"
            onChange={e => setRow(i, { amount: e.target.value })}
          />
          <Select value={row.unitKey} onValueChange={v => setRow(i, { unitKey: v })}>
            <SelectTrigger className="h-11 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BASE_KEY}>{baseUnit}</SelectItem>
              {units.map(u => (
                <SelectItem key={u.id} value={u.id}>
                  {u.unit_label} ({formatNumber(Number(u.units_in_base), 2)} {baseUnit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {allowMultiple && rows.length > 1 && (
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {allowMultiple && units.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => onChange([...rows, emptyRow()])}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Legg til delsum
        </Button>
      )}
    </div>
  );
}
