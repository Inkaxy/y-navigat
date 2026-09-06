import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, AlertTriangle, RefreshCw } from "lucide-react";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";
import { formatNok, formatDate } from "@/fakturaer/lib/constants";
import { cn } from "@/lib/utils";
import { FALLBACK_TOLERANCE_PCT } from "@/fakturaer/hooks/useMatchTolerances";

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
}

interface Props {
  invoice: DocPanelInvoice | null;
  line?: DocPanelLine | null;
  onClose: () => void;
  className?: string;
  /** Prisavvik-toleranse i prosent — hentes fra `useMatchTolerances`. */
  tolerancePct?: number;
}

function num(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function InvoiceDocumentPanel({ invoice, line, onClose, className, tolerancePct = FALLBACK_TOLERANCE_PCT }: Props) {
  const path = invoice?.source_document_url ?? null;
  const { url, isLoading, error, refetch } = useInvoiceDocumentUrl(path);

  const total = num(invoice?.total_amount);
  const vat = num(invoice?.total_vat);
  const exclVat = total != null ? total - (vat ?? 0) : null;
  const mismatch = invoice?.lines_sum_status === "mismatch";
  const confidence = num(invoice?.extraction_confidence);
  const lowConfidence = confidence != null && confidence < 0.7;

  const variance = num(line?.price_variance_pct);
  const varianceTone =
    variance == null
      ? "text-ink-primary"
      : Math.abs(variance) <= tolerancePct
        ? "text-success"
        : Math.abs(variance) <= tolerancePct * 2
          ? "text-warning"
          : "text-destructive";

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl border border-line-subtle bg-card", className)}>
      {/* a) topplinje */}
      <div className="flex items-center gap-3 border-b border-line-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Faktura {invoice?.invoice_number ?? "—"}</div>
          <div className="truncate text-xs text-ink-secondary">
            {invoice?.supplier_name ?? "—"} • {formatDate(invoice?.invoice_date)}
          </div>
        </div>
        <InvoiceDocumentButton path={path} label="Åpne i ny fane" variant="ghost" />
        <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Lukk dokumentpanel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* b) varselbånd */}
      {(mismatch || lowConfidence) && (
        <div className="space-y-2 border-b border-line-subtle p-3">
          {mismatch && (
            <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Linjene summerer seg til {formatNok(num(invoice?.lines_sum_excl_vat))}, fakturaen er på{" "}
                {formatNok(exclVat)} eks. mva
                {invoice?.lines_sum_variance_pct != null &&
                  ` (${Number(invoice.lines_sum_variance_pct).toFixed(1)} % avvik)`}
                . Sjekk om en linje mangler eller er lest feil.
              </span>
            </div>
          )}
          {lowConfidence && (
            <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Usikker maskinlesing ({Math.round((confidence ?? 0) * 100)} %) — kontroller tallene nøye.
              </span>
            </div>
          )}
        </div>
      )}

      {/* c) kontrollkort */}
      {line && (
        <div className="sticky top-0 z-10 border-b border-line-subtle bg-muted/30 p-3">
          <div className="text-sm font-medium leading-snug">{line.description ?? "—"}</div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            <Cell label="SKU" value={line.supplier_sku ?? "—"} mono />
            <Cell label="Antall" value={`${line.quantity ?? "—"} ${line.unit ?? ""}`.trim()} />
            <Cell label="Pris/enhet" value={formatNok(num(line.unit_price))} />
            <Cell label="Sum" value={formatNok(num(line.total_amount))} />
            {line.package_size != null && (
              <Cell
                label="Pakning"
                value={`${line.package_size} ${line.package_unit ?? ""}${
                  line.count_per_package ? ` × ${line.count_per_package}` : ""
                }`.trim()}
              />
            )}
            {line.matched_name && <Cell label="Matchet vare" value={line.matched_name} />}
            <Cell label="Pris/baseenhet" value={formatNok(num(line.price_per_base_unit))} />
            <Cell label="Avtalepris" value={formatNok(num(line.expected_price_per_base_unit))} />
            <div>
              <dt className="text-ink-secondary">Avvik</dt>
              <dd className={cn("font-semibold tabular-nums", varianceTone)}>
                {variance == null ? "—" : `${variance > 0 ? "+" : ""}${variance.toFixed(1)} %`}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* d) selve dokumentet */}
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
          </div>
        ) : isLoading || !url ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-[60vh] w-full" />
          </div>
        ) : (
          <iframe
            key={path}
            src={`${url}#toolbar=1&navpanes=0&view=FitH`}
            title={`Originalfaktura ${invoice?.invoice_number ?? ""}`}
            className="h-full w-full border-0"
          >
            <div className="p-4 text-sm">
              Kunne ikke vise dokumentet her.
              <InvoiceDocumentButton path={path} label="Åpne i ny fane" />
            </div>
          </iframe>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-ink-secondary">{label}</dt>
      <dd className={cn("font-medium tabular-nums", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}
