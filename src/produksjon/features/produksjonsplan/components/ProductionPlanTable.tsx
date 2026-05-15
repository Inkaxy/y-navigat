import { Fragment } from "react";
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

export interface ColumnVisibility {
  mainGroup: boolean;
  doughType: boolean;
  unit: boolean;
  ordered: boolean;
  fromStock: boolean;
  liters: boolean;
  onStock: boolean;
}

interface Props {
  rows: ProductionPlanRow[];
  showByMainGroup: boolean;
  showTraysWithPlus: boolean;
  loading: boolean;
  columns: ColumnVisibility;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "";
  if (digits === 0) return Math.round(n).toLocaleString("nb-NO");
  return n.toLocaleString("nb-NO", { maximumFractionDigits: digits });
}

export function ProductionPlanTable({ rows, showByMainGroup, showTraysWithPlus, loading, columns }: Props) {
  // Skjerm: rowspans for hovedgruppe-kolonnen
  const groupSpans = new Map<number, number>();
  if (showByMainGroup && columns.mainGroup) {
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

  // Print: hvilken rad starter en ny hovedgruppe
  const printGroupStart = new Map<number, { code: string; name: string }>();
  if (showByMainGroup) {
    let prev = "__init__";
    rows.forEach((r, idx) => {
      const code = r.main_category_code ?? "";
      if (code !== prev) {
        printGroupStart.set(idx, {
          code,
          name: r.main_category_name ?? "",
        });
        prev = code;
      }
    });
  }

  const trayLabel = (r: ProductionPlanRow): string => {
    if (!r.pieces_per_tray || r.pieces_per_tray <= 0) return "";
    if (showTraysWithPlus) {
      if (r.trays_partial > 0) return `${r.trays_full} + ${r.trays_partial}`;
      return String(r.trays_full);
    }
    return (r.quantity_to_produce / r.pieces_per_tray).toFixed(2);
  };

  // Antall kolonner (for colSpan på tom-/loading-rader og section-rader)
  const colCount =
    (showByMainGroup && columns.mainGroup ? 1 : 0) +
    (columns.doughType ? 1 : 0) +
    1 + // varenr
    1 + // varenavn
    (columns.ordered ? 1 : 0) +
    (columns.fromStock ? 1 : 0) +
    1 + // produksjon
    (columns.unit ? 1 : 0) +
    (columns.liters ? 1 : 0) +
    1 + // plater
    (columns.onStock ? 1 : 0);

  return (
    <Table density="compact">
      <TableHeader sticky>
        <TableRow>
          {showByMainGroup && columns.mainGroup && (
            <TableHead className="w-20 print:hidden">Hovedgr.</TableHead>
          )}
          {columns.doughType && <TableHead className="w-24">Deigtype</TableHead>}
          <TableHead className="w-20">Varenr</TableHead>
          <TableHead>Varenavn</TableHead>
          {columns.ordered && <TableHead className="text-right w-20">I ordre</TableHead>}
          {columns.fromStock && <TableHead className="text-right w-20">Fra lager</TableHead>}
          <TableHead className="text-right w-24 font-semibold">Produksjon</TableHead>
          {columns.unit && <TableHead className="w-16">Enhet</TableHead>}
          {columns.liters && <TableHead className="text-right w-20">Liter</TableHead>}
          <TableHead className="text-right w-24">Plater</TableHead>
          {columns.onStock && <TableHead className="text-right w-20">På lager</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && (
          <TableRow>
            <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
              Laster…
            </TableCell>
          </TableRow>
        )}
        {!loading && rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={colCount} className="text-center text-muted-foreground py-8">
              Ingen ordre som matcher kriteriene.
            </TableCell>
          </TableRow>
        )}
        {rows.map((r, idx) => {
          const span = showByMainGroup && columns.mainGroup ? groupSpans.get(idx) ?? 1 : 1;
          const sectionStart = printGroupStart.get(idx);
          // Print colCount uten Hovedgr.-kolonne
          const printColCount = colCount - (showByMainGroup && columns.mainGroup ? 1 : 0);
          // Alternerende sebrastriper — restartes på hver hovedgruppe
          let zebraIdx = idx;
          if (showByMainGroup) {
            // finn forrige sectionStart
            for (let k = idx; k >= 0; k--) {
              if (printGroupStart.has(k)) { zebraIdx = idx - k; break; }
            }
          }
          const isZebra = zebraIdx % 2 === 1;
          return (
            <Fragment key={`${r.product_id}-${idx}`}>
              {sectionStart && (
                <TableRow className="hidden print:table-row print-section-row">
                  <TableCell colSpan={printColCount}>
                    {sectionStart.code?.toUpperCase()} {sectionStart.name}
                  </TableCell>
                </TableRow>
              )}
              <TableRow
                data-zebra={isZebra ? "1" : "0"}
                className={cn(isZebra && "bg-muted/50")}
              >
                {showByMainGroup && columns.mainGroup && span > 0 && (
                  <TableCell
                    rowSpan={span}
                    className={cn(
                      "align-top bg-muted/40 border-r border-line-subtle font-mono text-xs font-semibold print:hidden",
                    )}
                  >
                    {r.main_category_code ?? ""}
                  </TableCell>
                )}
                {columns.doughType && (
                  <TableCell className="text-xs text-muted-foreground">{r.dough_type ?? ""}</TableCell>
                )}
                <TableCell className="font-mono text-xs">{r.product_code ?? ""}</TableCell>
                <TableCell>{r.product_name}</TableCell>
                {columns.ordered && (
                  <TableCell className="text-right tabular-nums">{fmtNum(r.quantity_ordered)}</TableCell>
                )}
                {columns.fromStock && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.quantity_from_stock > 0 ? fmtNum(r.quantity_from_stock) : ""}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums font-semibold">
                  {fmtNum(r.quantity_to_produce)}
                  <span className="hidden print:inline"> {r.unit_of_sale ?? ""}</span>
                </TableCell>
                {columns.unit && (
                  <TableCell className="text-xs text-muted-foreground">{r.unit_of_sale ?? ""}</TableCell>
                )}
                {columns.liters && (
                  <TableCell className="text-right tabular-nums">
                    {r.liters !== null ? fmtNum(r.liters, 1) : ""}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">{trayLabel(r)}</TableCell>
                {columns.onStock && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.on_stock !== null ? fmtNum(r.on_stock) : ""}
                  </TableCell>
                )}
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
