import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText } from "lucide-react";
import { ItemTypeBadge } from "@/ravarer/components/ItemTypeBadge";
import { formatNok } from "@/fakturaer/lib/constants";
import { resolveLineCost } from "@/fakturaer/lib/units";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkContext, SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import { cn } from "@/lib/utils";

export const REASON_LABELS: Record<string, string> = {
  unmatched: "Umatchet",
  low_confidence: "Lav tillit",
  price_variance: "Prisavvik",
  price_increase: "Prisøkning",
  price_drop: "Prisfall",
  uncertain_cost: "Usikker kostpris",
  unknown_package_size: "Ukjent pakningsstørrelse",
  sku_collision: "Konflikt",
  no_baseline: "Uten avtalepris",
};

export function reasonsOf(line: { review_reason: string | null }): string[] {
  return (line.review_reason ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

/** Pris per grunnenhet for linjen — lagret verdi, ellers beregnet. */
export function pricePerBaseUnitOf(line: ReviewLineRow, link: SupplierLinkRow | null): number | null {
  if (line.price_per_base_unit != null) return Number(line.price_per_base_unit);
  const baseUnit = link?.raw_material?.base_unit ?? line.suggestions?.[0]?.raw_material?.base_unit ?? null;
  if (!baseUnit) return null;
  const cost = resolveLineCost({
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unit_price,
    totalAmount: line.total_amount,
    packageSize: line.package_size,
    packageUnit: line.package_unit,
    countPerPackage: line.count_per_package,
    description: line.description,
    baseUnit,
    supplierPackage:
      link?.package_size != null
        ? { packageSize: Number(link.package_size), packageUnit: link.package_unit ?? baseUnit }
        : null,
  });
  return cost.needsInput ? null : cost.pricePerBaseUnit;
}

function packageLabel(line: ReviewLineRow, link: SupplierLinkRow | null): { text: string; confirmed: boolean } {
  if (link?.package_size != null) {
    return {
      text: `${link.package_size} ${link.package_unit ?? ""}`.trim(),
      confirmed: !!link.package_confirmed_at,
    };
  }
  if (line.package_size != null) {
    return {
      text: `${line.package_size} ${line.package_unit ?? ""}${line.count_per_package ? ` × ${line.count_per_package}` : ""}`.trim(),
      confirmed: false,
    };
  }
  return { text: "—", confirmed: false };
}

interface Props {
  lines: ReviewLineRow[];
  links: SupplierLinkContext;
  /** Toleranse per linje — slås opp mot linjens eget selskap. */
  toleranceFor: (legalEntityId: string | null, category?: string | null) => number;
  activeLineId: string | null;
  selected: Record<string, boolean>;
  onToggleSelect: (id: string, value: boolean) => void;
  onToggleSelectAll: (value: boolean) => void;
  onFocusLine: (line: ReviewLineRow) => void;
  onShowDocument: (line: ReviewLineRow) => void;
  onAction: (a: "match" | "create" | "not_rm" | "conflict", line: ReviewLineRow) => void;
  onAccept: (line: ReviewLineRow) => void;
  /** Vises som fakturakolonne når køen ikke er begrenset til én faktura. */
  showInvoiceColumn: boolean;
  canWrite: boolean;
}

export function QueueTable({
  lines,
  links,
  toleranceFor,
  activeLineId,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onFocusLine,
  onShowDocument,
  onAction,
  onAccept,
  showInvoiceColumn,
  canWrite,
}: Props) {
  const allSelected = lines.length > 0 && lines.every((l) => selected[l.id]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
          <tr>
            <th className="w-9 px-2 py-3">
              <Checkbox checked={allSelected} onCheckedChange={(v) => onToggleSelectAll(!!v)} aria-label="Velg alle" />
            </th>
            <th className="w-9 px-1 py-3"><span className="sr-only">Dokument</span></th>
            {showInvoiceColumn && <th className="px-3 py-3">Faktura</th>}
            <th className="px-3 py-3">Beskrivelse</th>
            <th className="px-3 py-3 text-right">Mengde</th>
            <th className="px-3 py-3 text-right">Linjepris</th>
            <th className="px-3 py-3 text-right">kr/grunnenhet</th>
            <th className="px-3 py-3">Forslag</th>
            <th className="px-3 py-3 text-right">Siste pris</th>
            <th className="px-3 py-3 text-right">Avtalepris</th>
            <th className="px-3 py-3 text-right">Avvik</th>
            <th className="px-3 py-3">Pakning</th>
            <th className="px-3 py-3">Årsaker</th>
            <th className="px-3 py-3 text-right">Handlinger</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const link = links.forLine(l);
            const top = l.suggestions?.[0];
            const category = l.matched_raw_material?.category ?? top?.raw_material?.category ?? link?.raw_material?.category ?? null;
            const tol = toleranceFor(l.invoice.legal_entity_id, category);
            const variance = l.price_variance_pct == null ? null : Number(l.price_variance_pct);
            const absVar = variance == null ? 0 : Math.abs(variance);
            const varColor =
              variance == null ? "text-ink-secondary" : absVar > tol * 2 ? "text-destructive" : absVar > tol ? "text-warning" : "text-ink-primary";
            const perBase = pricePerBaseUnitOf(l, link);
            const pkg = packageLabel(l, link);
            const isActive = activeLineId === l.id;
            const reasons = reasonsOf(l);

            return (
              <tr
                key={l.id}
                onClick={() => onFocusLine(l)}
                className={cn(
                  "cursor-pointer border-t border-line-subtle hover:bg-muted/30",
                  isActive && "border-l-2 border-l-primary bg-primary/5",
                )}
              >
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={!!selected[l.id]}
                    onCheckedChange={(v) => onToggleSelect(l.id, !!v)}
                    aria-label="Velg linje"
                  />
                </td>
                <td className="px-1 py-3" onClick={(e) => e.stopPropagation()}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={!l.invoice.source_document_url}
                          onClick={() => onShowDocument(l)}
                          aria-label="Vis faktura"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {l.invoice.source_document_url ? "Vis faktura" : "Originalfaktura ikke tilgjengelig"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
                {showInvoiceColumn && (
                  <td className="px-3 py-3 font-mono text-xs">{l.invoice.invoice_number}</td>
                )}
                <td className="max-w-[280px] px-3 py-3">
                  <div className="truncate font-medium">{l.description ?? "—"}</div>
                  <div className="font-mono text-xs text-ink-secondary">{l.supplier_sku ?? "uten SKU"}</div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {l.quantity ?? "—"} {l.unit ?? ""}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNok(l.total_amount)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNok(perBase)}</td>
                <td className="px-3 py-3">
                  {l.matched_raw_material ? (
                    <span className="inline-flex items-center gap-1.5">
                      {l.matched_raw_material.name}
                      <ItemTypeBadge itemType={l.matched_raw_material.item_type} />
                    </span>
                  ) : top ? (
                    <div>
                      <div className="flex items-center gap-1.5 font-medium">
                        {top.raw_material?.name ?? "—"}
                        <ItemTypeBadge itemType={top.raw_material?.item_type} />
                      </div>
                      <div className="text-xs text-ink-secondary">{Math.round((top.confidence ?? 0) * 100)} %</div>
                    </div>
                  ) : (
                    <span className="text-ink-secondary">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatNok(link?.last_invoice_price ?? null)}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatNok(link?.agreed_price_per_base_unit ?? l.expected_price_per_base_unit ?? null)}
                </td>
                <td className={cn("px-3 py-3 text-right font-medium tabular-nums", varColor)}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{variance == null ? "—" : `${variance > 0 ? "+" : ""}${variance.toFixed(1)} %`}</span>
                      </TooltipTrigger>
                      <TooltipContent>Toleranse for {category ?? "uten kategori"}: {tol} %</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </td>
                <td className="px-3 py-3 text-xs">
                  {pkg.text}
                  {pkg.text !== "—" && (
                    <span className={cn("ml-1", pkg.confirmed ? "text-success" : "text-warning")}>
                      {pkg.confirmed ? "bekreftet" : "parset"}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {reasons.length === 0 && l.variance_status !== "no_baseline" && (
                      <span className="text-xs text-ink-secondary">—</span>
                    )}
                    {reasons.map((r) => (
                      <Badge key={r} variant="outline" className="text-[10px]">
                        {REASON_LABELS[r] ?? r}
                      </Badge>
                    ))}
                    {l.variance_status === "no_baseline" && l.raw_material_id && (
                      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-[10px] text-warning">
                        Uten avtalepris
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1.5">
                    {reasons.includes("sku_collision") ? (
                      <Button size="sm" disabled={!canWrite} onClick={() => onAction("conflict", l)}>
                        Løs konflikt
                      </Button>
                    ) : (
                      <>
                        {top && (
                          <Button size="sm" disabled={!canWrite} onClick={() => onAccept(l)}>
                            Godta
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => onAction("match", l)}>
                          Match
                        </Button>
                        <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => onAction("create", l)}>
                          Ny vare
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => onAction("not_rm", l)}>
                          Ikke aktuell
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
