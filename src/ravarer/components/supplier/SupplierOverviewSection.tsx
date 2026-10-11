import { useMemo } from "react";
import { Boxes, CalendarClock, CalendarDays, FileText, PieChart, TrendingUp, Wallet } from "lucide-react";
import { OrderDeskKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import { getAgreementStatus } from "@/ravarer/lib/agreementStatus";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { useSupplierItems, useSupplierPriceIndex, useSupplierSpend, useTotalSpend } from "@/ravarer/hooks/useSupplierDetail";
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
  const spend = useSupplierSpend(supplier.id);
  const total = useTotalSpend(legalEntityId);
  const index = useSupplierPriceIndex(supplier.id);

  const expiring = useMemo(
    () => (items.data ?? []).filter((i) => {
      const st = getAgreementStatus(i.agreement_valid_from, i.agreement_valid_to);
      return st === "expiring_30" || st === "expiring_90";
    }).length,
    [items.data],
  );
  const share = spend.data && total.data && total.data.nok > 0 && spend.data.otherCurrencyCount === 0 && total.data.otherCurrencyCount === 0
    ? (spend.data.nok / total.data.nok) * 100 : null;
  const shareSub = spend.isError || total.isError ? "Kunne ikke beregnes"
    : (spend.data?.otherCurrencyCount ?? 0) > 0 || (total.data?.otherCurrencyCount ?? 0) > 0 ? "Ikke beregnet: fakturaer i annen/ukjent valuta" : "Andel av alt innkjøp siste 12 mnd (NOK)";

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="supplier-kpis">
        <OrderDeskKpi icon={FileText} label="Fakturaer" value={supplier.invoice_count != null ? formatNumber(supplier.invoice_count, 0) : "—"} sub="Registrert i NBhub" />
        <OrderDeskKpi icon={CalendarDays} label="Siste faktura" value={formatDate(supplier.last_invoice_date)} />
        <OrderDeskKpi icon={Boxes} label="Varer koblet" value={kpi(items, (d) => String(d.length))} />
        <OrderDeskKpi icon={Wallet} label="Kjøpt 12 mnd (eks. mva)" value={kpi(spend, (d) => formatNok(d.nok))}
          sub={spend.data && spend.data.otherCurrencyCount > 0 ? `NOK-fakturaer. ${spend.data.otherCurrencyCount} i annen/ukjent valuta er ikke med` : "NOK, kreditnotaer trukket fra"} />
        <OrderDeskKpi icon={PieChart} label="Andel av innkjøp" value={spend.isLoading || total.isLoading ? "…" : share == null ? "—" : `${formatNumber(share, 1)} %`} sub={shareSub} />
        <OrderDeskKpi icon={CalendarClock} tone={expiring > 0 ? "warning" : "default"} label="Avtaler som utløper ≤ 90 d" value={kpi(items, () => String(expiring))} sub="Sluttdato innen 90 dager" />
        <OrderDeskKpi icon={TrendingUp} label="Prisindeks" value={kpi(index, (d) => (d.indexPct == null ? "—" : formatNumber(d.indexPct, 0)))}
          sub={index.data?.indexPct == null ? "For få fakturalinjer" : `Siste pris mot 12 mnd snitt, ${index.data.materials} varer (100 = uendret)`} />
      </div>
    </div>
  );
}
