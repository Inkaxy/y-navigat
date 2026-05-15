import { Fragment } from "react";
import type { ProductionPlanRow, ProduksjonsplanCriteria } from "../types";
import { categoryColor } from "../lib/categoryColor";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ColumnVisibility } from "./ProductionPlanTable";
import { buildRowKey, type SnapshotItem } from "../hooks/useProductionPlanSnapshots";

interface Props {
  rows: ProductionPlanRow[];
  showByMainGroup: boolean;
  showTraysWithPlus: boolean;
  columns: ColumnVisibility;
  previousItems: Map<string, SnapshotItem>;
  criteria: ProduksjonsplanCriteria;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "";
  if (digits === 0) return Math.round(n).toLocaleString("nb-NO");
  return n.toLocaleString("nb-NO", { maximumFractionDigits: digits });
}

function fmtDiff(n: number, digits = 0): string {
  if (n === 0) return "";
  const s = n > 0 ? "+" : "−";
  const v = Math.abs(n);
  return s + (digits === 0 ? Math.round(v).toLocaleString("nb-NO") : v.toLocaleString("nb-NO", { maximumFractionDigits: digits }));
}

export function CorrectionPlanTable({ rows, showByMainGroup, showTraysWithPlus, columns, previousItems, criteria }: Props) {
  const printGroupStart = new Map<number, { code: string; name: string }>();
  if (showByMainGroup) {
    let prev = "__init__";
    rows.forEach((r, idx) => {
      const code = r.main_category_code ?? "";
      if (code !== prev) {
        printGroupStart.set(idx, { code, name: r.main_category_name ?? "" });
        prev = code;
      }
    });
  }

  const trayLabel = (trays_full: number, trays_partial: number, qty: number, ppt: number | null): string => {
    if (!ppt || ppt <= 0) return "";
    if (showTraysWithPlus) {
      if (trays_partial > 0) return `${trays_full} + ${trays_partial}`;
      return String(trays_full);
    }
    return (qty / ppt).toFixed(2);
  };

  const colCount =
    (columns.doughType ? 1 : 0) +
    1 + 1 +
    (columns.ordered ? 1 : 0) +
    (columns.fromStock ? 1 : 0) +
    1 +
    (columns.unit ? 1 : 0) +
    (columns.liters ? 1 : 0) +
    1 +
    (columns.onStock ? 1 : 0) +
    1; // Endring

  // Bygg liste over rader som finnes i forrige snapshot men ikke i nåværende → vises som "fjernet"
  const currentKeys = new Set(rows.map((r) => buildRowKey(r, criteria)));
  const removedKeys = Array.from(previousItems.keys()).filter((k) => !currentKeys.has(k));

  return (
    <Table density="compact">
      <TableHeader>
        <TableRow>
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
          <TableHead className="text-right w-20 font-semibold">Endring</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, idx) => {
          const sectionStart = printGroupStart.get(idx);
          const prev = previousItems.get(buildRowKey(r, criteria));
          const qtyDiff = r.quantity_to_produce - (prev?.quantity_to_produce ?? 0);
          const traysFullDiff = r.trays_full - (prev?.trays_full ?? 0);
          const traysPartialDiff = r.trays_partial - (prev?.trays_partial ?? 0);
          const showTrayDiffRow = traysFullDiff !== 0 || traysPartialDiff !== 0;
          const isNew = !prev;
          let zebraIdx = idx;
          for (let k = idx; k >= 0; k--) {
            if (printGroupStart.has(k)) { zebraIdx = idx - k; break; }
          }
          const isZebra = zebraIdx % 2 === 1;

          return (
            <Fragment key={`${r.product_id}-${idx}`}>
              {sectionStart && (
                <TableRow className="print-section-row">
                  <TableCell colSpan={colCount}>
                    {sectionStart.code?.toUpperCase()} {sectionStart.name}
                  </TableCell>
                </TableRow>
              )}
              <TableRow
                data-zebra={isZebra ? "1" : "0"}
                data-cat-color={categoryColor(r.main_category_code) ? "1" : "0"}
                style={(() => {
                  const c = categoryColor(r.main_category_code);
                  return c
                    ? ({
                        backgroundColor: c.bg,
                        ["--print-bg" as string]: c.print,
                      } as React.CSSProperties)
                    : undefined;
                })()}
                className={
                  categoryColor(r.main_category_code)
                    ? (isZebra ? "brightness-95" : undefined)
                    : (isZebra ? "bg-muted/50" : undefined)
                }
              >
                {columns.doughType && (
                  <TableCell className="text-xs text-muted-foreground">{r.dough_type ?? ""}</TableCell>
                )}
                <TableCell className="font-mono text-xs">{r.product_code ?? ""}</TableCell>
                <TableCell>
                  {r.product_name}
                  {isNew && <span className="ml-2 text-xs italic">(ny)</span>}
                </TableCell>
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
                <TableCell className="text-right tabular-nums">
                  {trayLabel(r.trays_full, r.trays_partial, r.quantity_to_produce, r.pieces_per_tray)}
                </TableCell>
                {columns.onStock && (
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.on_stock !== null ? fmtNum(r.on_stock) : ""}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums font-semibold">
                  {fmtDiff(qtyDiff)}
                </TableCell>
              </TableRow>
              {showTrayDiffRow && (
                <TableRow>
                  <TableCell colSpan={colCount - 2} className="text-xs italic text-muted-foreground pl-8">
                    Plater: {traysFullDiff !== 0 ? fmtDiff(traysFullDiff) : ""}
                    {traysPartialDiff !== 0 ? ` (delvis ${fmtDiff(traysPartialDiff)})` : ""}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              )}
            </Fragment>
          );
        })}
        {removedKeys.map((key) => {
          const prev = previousItems.get(key)!;
          return (
            <TableRow key={`removed-${key}`} className="text-muted-foreground">
              {columns.doughType && <TableCell />}
              <TableCell className="font-mono text-xs line-through">{prev.product_id.slice(0, 8)}</TableCell>
              <TableCell className="line-through">(fjernet fra plan)</TableCell>
              {columns.ordered && <TableCell className="text-right tabular-nums">{fmtNum(prev.quantity_ordered)}</TableCell>}
              {columns.fromStock && <TableCell />}
              <TableCell className="text-right tabular-nums">0</TableCell>
              {columns.unit && <TableCell />}
              {columns.liters && <TableCell />}
              <TableCell />
              {columns.onStock && <TableCell />}
              <TableCell className="text-right tabular-nums font-semibold">
                {fmtDiff(-prev.quantity_to_produce)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
