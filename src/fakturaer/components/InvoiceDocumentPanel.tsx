import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, AlertTriangle, RefreshCw } from "lucide-react";
import { PdfDocumentViewer } from "@/fakturaer/components/PdfDocumentViewer";
import { invoiceFigures, linePriceGate, type HoldState } from "@/fakturaer/lib/financialPresentation";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";
import { formatMoney, formatDate } from "@/fakturaer/lib/constants";
import { cn } from "@/lib/utils";

export interface DocPanelInvoice {
  invoice_number: string;
  invoice_date: string;
  supplier_name?: string | null;
  source_document_url?: string | null;
  total_amount?: number | null;
  total_vat?: number | null;
  lines_sum_status?: string | null;
  lines_sum_excl_vat?: number | null;
  lines_sum_variance_pct?: number | null;
  extraction_confidence?: number | null;
  currency?: string | null;
  is_credit_note?: boolean | null;
  flagged_at?: string | null;
  extraction_issues?: unknown;
}

export interface DocPanelLine {
  description?: string | null;
  supplier_sku?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
  total_amount?: number | null;
  package_size?: number | null;
  package_unit?: string | null;
  count_per_package?: number | null;
  price_per_base_unit?: number | null;
  expected_price_per_base_unit?: number | null;
  price_variance_pct?: number | null;
  matched_name?: string | null;
  raw_material_id?: string | null;
  base_quantity?: number | null;
  extraction_issues?: unknown;
}

interface Props {
  invoice: DocPanelInvoice | null;
  line?: DocPanelLine | null;
  onClose: () => void;
  className?: string;
  /** Beholdt for bakoverkompatibilitet; prisvurderingen vises i inspektøren. */
  tolerancePct?: number;
  /** Vis sumavvik-varsel i panelet (bare der ingen egen kontrollblokk finnes). */
  showSumWarning?: boolean;
  /** Holdt-tilbake-status for valgt linjes prisobservasjon (null = ukjent). */
  held?: HoldState;
}

function num(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function InvoiceDocumentPanel({ invoice, line, onClose, className, showSumWarning, held }: Props) {
  const path = invoice?.source_document_url ?? null;
  const { url, isLoading, error, refetch } = useInvoiceDocumentUrl(path);
  const fig = invoiceFigures(invoice ?? {});
  const cur = fig.currency;
  const mismatch = showSumWarning && invoice?.lines_sum_status === "mismatch";
  const gate = line && invoice ? linePriceGate(invoice, line, held) : null;
  const variance = gate?.ok ? num(line?.price_variance_pct) : null;
  const open = <InvoiceDocumentButton path={path} label="Åpne originalen i ny fane" variant="outline" />;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl border border-line-subtle bg-card", className)}>
      <div className="flex items-center gap-3 border-b border-line-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Faktura {invoice?.invoice_number ?? "—"}{invoice?.is_credit_note ? " · kreditnota" : ""}</div>
          <div className="truncate text-xs text-ink-secondary">
            {invoice?.supplier_name ?? "—"} • {formatDate(invoice?.invoice_date)}
          </div>
        </div>
        <InvoiceDocumentButton path={path} label="Åpne i ny fane" variant="ghost" />
        <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Lukk dokumentpanel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {mismatch && (
        <div className="flex gap-2 border-b border-line-subtle bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Linjene summerer seg til {formatMoney(fig.linesSum, cur)}, fakturaen er på {fig.net == null ? "ukjent beløp (mva mangler)" : `${formatMoney(fig.net, cur)} eks. mva`}. Sjekk om en linje mangler eller er lest feil.
          </span>
        </div>
      )}

      {/* Valgt linje — kompakt; originalbeløp i dokumentets valuta og fortegn. */}
      {line && (
        <div className="border-b border-line-subtle bg-muted/30 px-3 py-2 text-sm">
          <div className="truncate font-medium" title={line.description ?? undefined}>{line.description ?? "—"}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-secondary tabular-nums">
            {line.supplier_sku && <span className="font-mono">{line.supplier_sku}</span>}
            <span>{`${line.quantity ?? "—"} ${line.unit ?? ""}`.trim()} × {formatMoney(num(line.unit_price), cur)}</span>
            <span>Sum {formatMoney(num(line.total_amount), cur)}</span>
            {line.matched_name && <span>→ {line.matched_name}</span>}
          </div>
          <p className={cn("mt-1 text-xs", gate?.ok ? "text-ink-secondary" : "text-warning")}>
            {gate?.ok
              ? `Pris/grunnenhet ${formatMoney(num(line.price_per_base_unit), cur)} mot ${formatMoney(num(line.expected_price_per_base_unit), cur)}${variance == null ? "" : ` (${variance > 0 ? "+" : ""}${variance.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %)`}`
              : gate ? `${gate.label} — prisavvik vises ikke.` : null}
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 bg-muted/20">
        {!path ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-secondary">
            Originalfaktura ikke tilgjengelig.
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink-secondary">
            <span>Kunne ikke hente dokumentet.</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Prøv igjen
            </Button>
            {open}
          </div>
        ) : isLoading || !url ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-[60vh] w-full" />
          </div>
        ) : (
          <PdfDocumentViewer url={url} cacheKey={path} title={`Originalfaktura ${invoice?.invoice_number ?? ""}`} fallback={open} />
        )}
      </div>
    </div>
  );
}
