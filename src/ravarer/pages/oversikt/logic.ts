/**
 * Ren logikk for Oversikt — ingen React, lett å teste.
 */
import type { SupplierItemCounts, InvoiceCounts, DataQualityCounts } from "@/ravarer/lib/workRpcTypes";

export function varekortTodo(c: SupplierItemCounts | null): number {
  if (!c) return 0;
  return c.ukoblet + c.mangler_pakning + c.prisavvik + c.kontroll;
}

export function fakturaTodo(c: InvoiceCounts | null): number {
  if (!c) return 0;
  return c.missing_lines + c.sum_mismatch + c.ready_to_reconcile + c.flagged;
}

export function dataRydding(d: DataQualityCounts): number {
  return d.missing_package + d.unconfirmed_package + d.missing_declaration + d.missing_nutrition + d.datasheet_changes;
}

export type StatusLine = { headline: string; sub: string | null };

export function statusLine(args: {
  todo_total: number | null;
  hasInvoiceAccess: boolean;
  supplier: SupplierItemCounts | null;
  invoices: InvoiceCounts | null;
  dq: DataQualityCounts;
}): StatusLine {
  const todo = args.todo_total ?? 0;
  if (!args.hasInvoiceAccess) {
    const n = dataRydding(args.dq);
    return n === 0
      ? { headline: "Alt er kontrollert.", sub: null }
      : { headline: `${n} ting å rydde i varedata`, sub: null };
  }
  if (todo === 0) return { headline: "Alt er kontrollert.", sub: null };
  const vk = varekortTodo(args.supplier);
  const fk = fakturaTodo(args.invoices);
  const noun = todo === 1 ? "ting venter" : "ting venter på deg";
  return {
    headline: `${todo} ${noun}`,
    sub: `${vk} varer trenger en beslutning · ${fk} fakturaer trenger et menneske`,
  };
}

/** Andel avstemt automatisk av totalt avstemt (0–100 %). */
export function autoReconciledPct(auto: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((auto / total) * 100);
}

export type SparkPoint = { x: number; y: number };

/** Jevnt fordelte x-koordinater; y invertert slik at høy pris er øverst. */
export function sparklinePoints(
  before: number | null,
  points: { date: string; price: number }[],
  width = 100,
  height = 24,
): SparkPoint[] {
  const series: number[] = [];
  if (typeof before === "number") series.push(before);
  for (const p of points) series.push(p.price);
  if (series.length < 2) return [];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series.map((v, i) => ({
    x: (i / (series.length - 1)) * width,
    y: height - ((v - min) / span) * height,
  }));
}
