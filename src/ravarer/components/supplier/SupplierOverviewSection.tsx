import { useMemo } from "react";
import { Boxes, CalendarClock, CalendarDays, FileText, PieChart, TrendingUp, Wallet } from "lucide-react";
import { OrderDeskKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import { getAgreementStatus } from "@/ravarer/lib/agreementStatus";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSupplierItems, useSupplierSpend, useTotalSpend } from "@/ravarer/hooks/useSupplierDetail";
import { spendShare, type SupplierSpendSummary } from "@/ravarer/lib/supplierSpend";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";
import { SupplierStatusBadge, TrackInvoiceToggle, TRACK_HELP_SHORT } from "./TrackInvoiceToggle";

/** Verdi for en KPI: laster → «…», feil → «Feil», aldri 0 som stedfortreder. */
function kpi<T>(q: { isLoading: boolean; isError: boolean; data: T | undefined }, show: (d: T) => string): string {
  if (q.isLoading) return "…";
  if (q.isError || q.data === undefined) return "Feil";
  return show(q.data);
}

export function SupplierOverviewSection({ supplier }: { supplier: SupplierRow }) {
  const { canWrite, legalEntityId } = useRavarer();
  const items = useSupplierItems(supplier.id);
  const spend = useSupplierSpend(supplier.id, legalEntityId);
  const total = useTotalSpend(legalEntityId);

  const expiring = useMemo(
    () => (items.data ?? []).filter((i) => {
      const st = getAgreementStatus(i.agreement_valid_from, i.agreement_valid_to);
      return st === "expiring_30" || st === "expiring_90";
    }).length,
    [items.data],
  );
  // Feil eller henting gir aldri en bufret prosent.
  const shareUsable = !spend.isError && !total.isError && !spend.isFetching && !total.isFetching;
  const share = shareUsable ? spendShare(spend.data, total.data) : null;
  const shareSub = spend.isError || total.isError ? "Kunne ikke beregnes"
    : (spend.data?.otherCurrencyCount ?? 0) > 0 || (total.data?.otherCurrencyCount ?? 0) > 0 ? "Ikke beregnet: fakturaer i annen/ukjent valuta"
    : spend.data?.netNok == null || total.data?.netNok == null ? "Ikke beregnet: ufullstendig grunnlag"
    : "Andel av alt innkjøp siste 12 mnd (NOK)";

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-line-subtle p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SupplierStatusBadge s={supplier} />
          {supplier.tripletex_supplier_number && <span className="text-caption text-ink-secondary">Tripletex #{supplier.tripletex_supplier_number}</span>}
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-caption text-ink-secondary">Org.nr</dt><dd className="font-mono">{supplier.org_number ?? "—"}</dd></div>
          <div className="min-w-0"><dt className="text-caption text-ink-secondary">E-post</dt><dd className="[overflow-wrap:anywhere]">
            {supplier.contact_email ? <a className="inline-flex min-h-[44px] items-center text-primary hover:underline md:min-h-0" href={`mailto:${supplier.contact_email}`}>{supplier.contact_email}</a> : "—"}
          </dd></div>
          <div><dt className="text-caption text-ink-secondary">Telefon</dt><dd>
            {supplier.contact_phone ? <a className="inline-flex min-h-[44px] items-center text-primary hover:underline md:min-h-0" href={`tel:${supplier.contact_phone}`}>{supplier.contact_phone}</a> : "—"}
          </dd></div>
        </dl>
        <div className="flex items-center gap-2 text-sm">
          <TrackInvoiceToggle supplier={supplier} canWrite={canWrite} />
          <span>Følg fakturalinjer</span>
        </div>
        <p className="text-caption text-ink-secondary">{TRACK_HELP_SHORT}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="supplier-kpis">
        <OrderDeskKpi wrapSub icon={FileText} label="Fakturaer" value={supplier.invoice_count != null ? formatNumber(supplier.invoice_count, 0) : "—"} sub="Registrert i NBhub" />
        <OrderDeskKpi wrapSub icon={CalendarDays} label="Siste faktura" value={formatDate(supplier.last_invoice_date)} />
        <OrderDeskKpi wrapSub icon={Boxes} label="Varer koblet" value={kpi(items, (d) => String(d.length))} />
        <OrderDeskKpi wrapSub icon={Wallet} label="Kjøpt 12 mnd (eks. mva)" value={kpi(spend, (d) => (d.netNok == null ? "Ukjent" : formatNok(d.netNok)))}
          sub={spend.isError ? "Kunne ikke hentes" : spend.data ? spendSub(spend.data) : undefined} />
        <OrderDeskKpi wrapSub icon={PieChart} label="Andel av innkjøp" value={spend.isLoading || total.isLoading ? "…" : share == null ? "—" : `${formatNumber(share, 1)} %`} sub={shareSub} />
        <OrderDeskKpi wrapSub icon={CalendarClock} tone={expiring > 0 ? "warning" : "default"} label="Avtaler som utløper ≤ 90 d" value={kpi(items, () => String(expiring))} sub="Sluttdato innen 90 dager" />
        {/* Prisindeksen holdes tilbake til kontrollert sammenlignbar historikk finnes; prisutvikling per vare ligger på råvarekortet. */}
        <OrderDeskKpi wrapSub icon={TrendingUp} label="Prisindeks" value="Ukjent" sub="Ikke beregnet: fakturapriser er ikke kontrollert som sammenlignbare. Se prisutvikling per vare." />
      </div>
    </div>
  );
}

function spendSub(d: SupplierSpendSummary): string {
  const parts: string[] = [`${d.periodStart} – ${d.periodEnd}, NOK, kreditnotaer trukket fra`];
  if (d.missingVatCount > 0) parts.push(`${d.missingVatCount} uten mva`);
  if (d.missingAmountCount + d.invalidAmountCount > 0) parts.push(`${d.missingAmountCount + d.invalidAmountCount} med ukjent beløp`);
  if (d.netNok == null) parts.push(`kjent delsum ${formatNok(d.knownNetNokSubtotal)}`);
  if (d.otherCurrencyCount > 0) parts.push(`${d.otherCurrencyCount} i annen/ukjent valuta ikke med`);
  if (d.excludedCancelledCount > 0) parts.push(`${d.excludedCancelledCount} kansellerte ikke med`);
  return parts.join(" · ");
}
