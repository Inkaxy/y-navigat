import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ProductionPlanRow } from "../types";
import {
  PLAN_SOURCE_LABEL,
  PLAN_SOURCE_SHORT,
  PLAN_SOURCE_TOOLTIP,
} from "../lib/planSource";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useCakeImagesByProduct } from "../hooks/useCakeImagesByProduct";

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
  /** Leveringsdato — brukes for å hente kakebilder til varelinjene. */
  deliveryDate?: string;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "";
  if (digits === 0) return Math.round(n).toLocaleString("nb-NO");
  return n.toLocaleString("nb-NO", { maximumFractionDigits: digits });
}

export function ProductionPlanTable({ rows, showByMainGroup, showTraysWithPlus, loading, columns, deliveryDate }: Props) {
  const { data: cakeByProduct = {} } = useCakeImagesByProduct(deliveryDate);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
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
    <Table density="compact" className="production-zebra-table">
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
          // Alternerende sebrastriper — basert på faktisk produktlinje-indeks
          const isZebra = idx % 2 === 1;
          const rowKey = `${r.product_id}-${idx}`;
          const isExpanded = expanded.has(rowKey);
          const hasDetails = (r.details?.length ?? 0) > 0;
          const detailColSpan = printColCount; // strekker over alle "data"-kolonner (uten Hovedgr.)
          return (
            <Fragment key={rowKey}>
              {sectionStart && (
                <TableRow className="hidden print:table-row print-section-row">
                  <TableCell colSpan={printColCount}>
                    {sectionStart.code?.toUpperCase()} {sectionStart.name}
                  </TableCell>
                </TableRow>
              )}
              <TableRow
                data-zebra={isZebra ? "1" : "0"}
                className={cn(
                  hasDetails && "cursor-pointer print:cursor-auto hover:bg-muted/60",
                  isExpanded && "bg-accent/30",
                  r.quantity_from_stock > 0 && r.quantity_to_produce === 0 && "bg-success/10",
                )}
                onClick={() => hasDetails && toggle(rowKey)}
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
                <TableCell className="font-mono text-xs">
                  <span className="inline-flex items-center gap-1">
                    {hasDetails && (
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 text-muted-foreground transition-transform print:hidden",
                          isExpanded && "rotate-90",
                        )}
                      />
                    )}
                    {r.product_code ?? ""}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{r.product_name}</span>
                    {(r.sources ?? []).map((s) => (
                      <span
                        key={s}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold print:hidden",
                          s === "ny_etter_kjoring"
                            ? "bg-warning/15 text-warning"
                            : "bg-muted text-muted-foreground",
                        )}
                        title={PLAN_SOURCE_TOOLTIP[s]}
                        aria-label={PLAN_SOURCE_LABEL[s]}
                      >
                        {PLAN_SOURCE_SHORT[s]}
                      </span>
                    ))}
                    {r.quantity_from_stock > 0 && (
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          r.quantity_to_produce === 0
                            ? "bg-success/15 text-success"
                            : "bg-warning/15 text-warning",
                        )}
                        title={`Dekkes av lager: ${fmtNum(r.quantity_from_stock)} av ${fmtNum(r.quantity_ordered)}`}
                      >
                        {r.quantity_to_produce === 0
                          ? "Dekket av lager"
                          : `Fra lager ${fmtNum(r.quantity_from_stock)}/${fmtNum(r.quantity_ordered)}`}
                      </span>
                    )}
                    {(cakeByProduct[r.product_id] ?? []).slice(0, 4).map((ci) => (

                      <span
                        key={ci.id}
                        className="inline-flex items-center gap-1 rounded border border-border bg-muted/50 px-1 py-0.5"
                        title={`Kakebilde${ci.label_number ? ` #${ci.label_number}` : ""}`}
                      >
                        {ci.url && (
                          <img
                            src={ci.url}
                            alt={`Kakebilde ${ci.label_number ?? ""}`}
                            className="h-7 w-9 rounded-sm object-contain"
                            loading="lazy"
                          />
                        )}
                        {ci.label_number && (
                          <span className="font-mono text-[10px] font-semibold">
                            #{ci.label_number}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </TableCell>
                {columns.ordered && (
                  <TableCell className="text-right tabular-nums">{fmtNum(r.quantity_ordered)}</TableCell>
                )}
                {columns.fromStock && (
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      r.quantity_from_stock > 0 ? "font-medium text-success" : "text-muted-foreground",
                    )}
                    title={
                      r.quantity_from_stock > 0
                        ? `Dekkes av lager: ${fmtNum(r.quantity_from_stock)} av ${fmtNum(r.quantity_ordered)}`
                        : undefined
                    }
                  >
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
              {isExpanded && hasDetails && (
                <TableRow className="print:hidden bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={detailColSpan + (showByMainGroup && columns.mainGroup ? 1 : 0)} className="p-0">
                    <div className="px-4 py-2">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr className="border-b border-line-subtle">
                            <th className="text-left font-medium py-1 pr-3">Kundenr</th>
                            <th className="text-left font-medium py-1 pr-3">Kunde</th>
                            <th className="text-left font-medium py-1 pr-3">Tur</th>
                            <th className="text-left font-medium py-1 pr-3">Varenr</th>
                            <th className="text-right font-medium py-1 pr-3">Antall</th>
                            <th className="text-left font-medium py-1 pr-3">Enhet</th>
                            <th className="text-left font-medium py-1 pr-3">Kilde</th>
                            <th className="text-left font-medium py-1 pr-3">Rute</th>
                            <th className="text-left font-medium py-1">Adresse</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.details.map((d, di) => (
                            <tr key={`${d.customer_id}-${d.product_id}-${di}`} className="border-b border-line-subtle/50 last:border-0">
                              <td className="font-mono py-1 pr-3">{d.customer_number ?? ""}</td>
                              <td className="py-1 pr-3">{d.customer_name}</td>
                              <td className="py-1 pr-3 text-muted-foreground">
                                {d.tour_number != null ? `tur ${d.tour_number}` : "henting"}
                              </td>
                              <td className="font-mono py-1 pr-3">{d.product_code ?? ""}</td>
                              <td className="text-right tabular-nums py-1 pr-3">{fmtNum(d.quantity)}</td>
                              <td className="py-1 pr-3 text-muted-foreground">{d.unit_of_sale ?? ""}</td>
                              <td className="py-1 pr-3 text-muted-foreground" title={PLAN_SOURCE_TOOLTIP[d.source]}>
                                {PLAN_SOURCE_LABEL[d.source]}
                              </td>
                              <td className="py-1 pr-3 text-muted-foreground">
                                {d.tour_name ?? (d.tour_number == null ? "Henting / uten tur" : "")}
                              </td>
                              <td className="py-1 text-muted-foreground">{d.address ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
