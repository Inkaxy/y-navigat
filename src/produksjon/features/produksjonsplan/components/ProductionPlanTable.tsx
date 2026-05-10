import type { ProductionPlanRow } from "../types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Props {
  rows: ProductionPlanRow[];
  showByMainGroup: boolean;
  showTraysWithPlus: boolean;
  loading: boolean;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "";
  if (digits === 0) return Math.round(n).toLocaleString("nb-NO");
  return n.toLocaleString("nb-NO", { maximumFractionDigits: digits });
}

export function ProductionPlanTable({ rows, showByMainGroup, showTraysWithPlus, loading }: Props) {
  // Beregn rowspans for hovedgruppe-kolonnen
  const groupSpans = new Map<number, number>(); // index → span (0 = skip)
  if (showByMainGroup) {
    let i = 0;
    while (i < rows.length) {
      const code = rows[i].main_category_code ?? "";
      let j = i;
      while (j < rows.length && (rows[j].main_category_code ?? "") === code) j++;
      groupSpans.set(i, j - i);
      for (let k = i + 1; k < j; k++) groupSpans.set(k, 0);
      i = j;
    }
  }

  const trayLabel = (r: ProductionPlanRow): string => {
    if (!r.pieces_per_tray || r.pieces_per_tray <= 0) return "";
    if (showTraysWithPlus) {
      if (r.trays_partial > 0) return `${r.trays_full} + ${r.trays_partial}`;
      return String(r.trays_full);
    }
    // Vis decimal
    return (r.quantity_to_produce / r.pieces_per_tray).toFixed(2);
  };

  return (
    <Table density="compact">
      <TableHeader sticky>
        <TableRow>
          {showByMainGroup && <TableHead className="w-20">Hovedgr.</TableHead>}
          <TableHead className="w-24">Deigtype</TableHead>
          <TableHead className="w-20">Varenr</TableHead>
          <TableHead>Varenavn</TableHead>
          <TableHead className="text-right w-20">I ordre</TableHead>
          <TableHead className="text-right w-20">Fra lager</TableHead>
          <TableHead className="text-right w-24 font-semibold">Produksjon</TableHead>
          <TableHead className="w-16">Enhet</TableHead>
          <TableHead className="text-right w-20">Liter</TableHead>
          <TableHead className="text-right w-24">Plater</TableHead>
          <TableHead className="text-right w-20">På lager</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
              Laster…
            </TableCell>
          </TableRow>
        )}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
              Ingen ordre som matcher kriteriene.
            </TableCell>
          </TableRow>
        )}
        {rows.map((r, idx) => {
          const span = showByMainGroup ? groupSpans.get(idx) ?? 1 : 1;
          return (
            <TableRow key={`${r.product_id}-${idx}`}>
              {showByMainGroup && span > 0 && (
                <TableCell
                  rowSpan={span}
                  className={cn(
                    "align-top bg-muted/40 border-r border-line-subtle font-mono text-xs font-semibold",
                  )}
                >
                  {r.main_category_code ?? ""}
                </TableCell>
              )}
              <TableCell className="text-xs text-muted-foreground">{r.dough_type ?? ""}</TableCell>
              <TableCell className="font-mono text-xs">{r.product_code ?? ""}</TableCell>
              <TableCell>{r.product_name}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtNum(r.quantity_ordered)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.quantity_from_stock > 0 ? fmtNum(r.quantity_from_stock) : ""}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {fmtNum(r.quantity_to_produce)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.unit_of_sale ?? ""}</TableCell>
              <TableCell className="text-right tabular-nums">{r.liters !== null ? fmtNum(r.liters, 1) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{trayLabel(r)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.on_stock !== null ? fmtNum(r.on_stock) : ""}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
