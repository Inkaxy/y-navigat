import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X, AlertTriangle, RefreshCw } from "lucide-react";
import { PdfDocumentViewer } from "@/fakturaer/components/PdfDocumentViewer";
import { invoiceFigures, type PriceGate } from "@/fakturaer/lib/financialPresentation";
import { InvoiceDocumentButton } from "@/fakturaer/components/InvoiceDocumentButton";
import { InvoiceShareActions } from "@/fakturaer/components/InvoiceShareActions";
import { useInvoiceDocumentUrl } from "@/fakturaer/hooks/useInvoiceDocument";
import { useInvoiceDocumentVersion } from "@/fakturaer/hooks/useInvoiceDocumentVersion";
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
  /** Kallerens faktiske faktura-ID (brukes til versjonsoppslag). */
  invoiceId: string | null;
  invoice: DocPanelInvoice | null;
  line?: DocPanelLine | null;
  onClose: () => void;
  className?: string;
  /** Beholdt for bakoverkompatibilitet; prisvurderingen vises i inspektøren. */
  tolerancePct?: number;
  /** Vis sumavvik-varsel i panelet (bare der ingen egen kontrollblokk finnes). */
  showSumWarning?: boolean;
  /** Holdt-tilbake-status for valgt linjes prisobservasjon (null = ukjent). */
  /** Serverens prisstatus for valgt linje (ukjent uten). */
  gate?: PriceGate | null;
  /** Valgt linje er holdt utenfor (selv eller via dokumentet): ikke prisgrunnlag. */
  lineHeldOutside?: boolean;
  /** HELE dokumentet er holdt utenfor: sumvarselet er bare historikk. Aldri sant for én utelatt linje. */
  documentHeldOutside?: boolean;
}

function num(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function InvoiceDocumentPanel({ invoiceId, invoice, line, onClose, className, showSumWarning, gate: gateIn, lineHeldOutside, documentHeldOutside }: Props) {
  // Gjeldende identitet hentes fersk; uten den vises aldri bufret (mulig gammel) original.
  const ver = useInvoiceDocumentVersion(invoice?.source_document_url ? invoiceId : null);
  // Alt (sti, signering, åpne-knapp, visning) kommer BARE fra identitet bekreftet i denne epoken.
  const verified = ver.verifiedCurrent;
  const current = verified?.available ? verified : null;
  const path = current?.path ?? null;
  const { url, isLoading: urlLoading, error: urlError, refetch: refetchUrl } = useInvoiceDocumentUrl(path, current?.version ?? null, ver.accessScope);
  const metaError = ver.isError;
  const isLoading = !verified || urlLoading;
  const error = metaError ? ver.error : urlError;
  // Metadata først; signering prøves bare på nytt etter bekreftet identitet.
  const refetch = () => { if (metaError || !verified) void ver.refetch(); else void refetchUrl(); };
  const missing = !invoice?.source_document_url || !invoiceId || verified?.available === false;
  const fig = invoiceFigures(invoice ?? {});
  const cur = fig.currency;
  const mismatch = showSumWarning && invoice?.lines_sum_status === "mismatch";
  const gate = line ? gateIn ?? null : null;
  const open = <InvoiceDocumentButton path={path} label="Åpne originalen i ny fane" variant="outline" className="min-h-[44px]" />;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl border border-line-subtle bg-card", className)}>
      <div className="flex items-center gap-3 border-b border-line-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Faktura {invoice?.invoice_number ?? "—"}{invoice?.is_credit_note ? " · kreditnota" : ""}</div>
          <div className="truncate text-xs text-ink-secondary">
            {invoice?.supplier_name ?? "—"} • {formatDate(invoice?.invoice_date)}
          </div>
        </div>
        <InvoiceShareActions invoiceId={invoiceId} invoiceNumber={invoice?.invoice_number} url={missing ? null : url} />
        <InvoiceDocumentButton path={path} label="Åpne i ny fane" variant="ghost" className="min-h-[44px]" />
        <Button type="button" size="icon" variant="ghost" className="min-h-[44px] min-w-[44px]" onClick={onClose} aria-label="Lukk dokumentpanel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {mismatch && (
        <div className="flex gap-2 border-b border-line-subtle bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Linjene summerer seg til {formatMoney(fig.linesSum, cur)}, fakturaen er på {fig.net == null ? "ukjent beløp (mva mangler)" : `${formatMoney(fig.net, cur)} eks. mva`}. {documentHeldOutside ? "Historisk sumvarsel – dokumentet er holdt utenfor og krever ingen retting." : "Sjekk om en linje mangler eller er lest feil."}
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
          {lineHeldOutside ? (
            <p className="mt-1 text-xs text-ink-secondary">Holdt utenfor råvarebehandling — ikke prisgrunnlag.</p>
          ) : <p className={cn("mt-1 text-xs", gate?.ok ? "text-ink-secondary" : "text-warning")}>
            {gate?.ok
              ? `Kontrollert pris/grunnenhet ${formatMoney(gate.safety.price_per_base_unit, "NOK")} mot ${formatMoney(gate.safety.expected_price_per_base_unit, "NOK")} · beregnet prisavvik ${formatMoney(gate.safety.effect_nok, "NOK")}`
              : `${gate?.label ?? "Prisgrunnlag ikke kontrollert"} — prisavvik vises ikke.`}
          </p>}
        </div>
      )}

      <div className="min-h-0 flex-1 bg-muted/20">
        {missing ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-secondary">
            {verified?.available === false && verified.reason === "document_path_invalid" ? "Originalens lagringssti er ugyldig. Dokumentet vises ikke." : "Originalfaktura ikke tilgjengelig."}
          </div>
        ) : ver.revoked ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink-secondary">
            <span>Originalen er endret eller kunne ikke kontrolleres. Ingenting fra den gamle versjonen vises.</span>
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => ver.refresh()}>
              <RefreshCw className="h-4 w-4" /> Hent på nytt
            </Button>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink-secondary">
            <span>Kunne ikke hente dokumentet.</span>
            <Button size="sm" variant="outline" className="min-h-[44px]" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Prøv igjen
            </Button>
            {!metaError && current && open}
          </div>
        ) : isLoading || !url || !path || !current ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-[60vh] w-full" />
          </div>
        ) : (
          <PdfDocumentViewer url={url} cacheKey={path} version={current.version} accessScope={ver.accessScope} verifyIdentity={ver.recheck} generation={ver.generation} onIdentityChanged={ver.refresh} title={`Originalfaktura ${invoice?.invoice_number ?? ""}`} fallback={open} />
        )}
      </div>
    </div>
  );
}
