import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QueryErrorState } from "@/components/common/QueryState";
import { useAuth } from "@/hooks/useAuth";
import { useHotkeys, type HotkeyBinding } from "@/ravarer/ui/hotkeys";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { paths } from "@/ravarer/lib/paths";
import { useWorkSummary, useActivityFeed, usePriceMovers } from "@/ravarer/hooks/useWorkData";
import { useCompany } from "@/hooks/useCompany";
import { useFraFakturaCounts } from "@/ravarer/hooks/useFraFaktura";
import { ActivityView } from "@/ravarer/pages/oversikt/ActivityView";
import { PriceMoversView } from "@/ravarer/pages/oversikt/PriceMoversView";
import { DataQualityView } from "@/ravarer/pages/oversikt/DataQualityView";
import { FraFakturaOverviewCard } from "@/ravarer/pages/oversikt/FraFakturaOverviewCard";
import { InvoiceReadingAlert } from "@/ravarer/components/reading/InvoiceReadingAlert";
import { useInvoiceReadingHealth } from "@/ravarer/hooks/useInvoiceReadingHealth";
import { readingBannerState } from "@/ravarer/lib/invoiceReadingHealth";
import { loadKeyTestOk } from "@/ravarer/lib/keyTestMarker";

function firstNameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const left = email.split("@")[0].split(/[._-]/)[0];
  return left ? left[0].toUpperCase() + left.slice(1) : null;
}

/** Oversikt (opprydding demo D): bare Fra faktura-kortet og tall som peker til Fra faktura, Varer og Fakturaer. */
export default function RavarerOversikt() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const period = (Number(sp.get("periode")) === 90 ? 90 : Number(sp.get("periode")) === 365 ? 365 : 30) as 30 | 90 | 365;

  const summaryQ = useWorkSummary({ includeApproval: true });
  const invoiceAccess = summaryQ.data?.invoice_access === true;
  const { data: company } = useCompany();
  // Samme tellere som menyen og Fra faktura (delt hurtigbuffer, ingen egne listekall).
  const counts = useFraFakturaCounts(invoiceAccess);
  const [more, setMore] = useState(false);
  const activityQ = useActivityFeed({ days: 7, enabled: invoiceAccess && more });
  const moversQ = usePriceMovers({ days: period });
  const healthQ = useInvoiceReadingHealth(company?.id ?? null, invoiceAccess);
  const [helpOpen, setHelpOpen] = useState(false);
  const firstName = firstNameFromEmail(user?.email);

  const hotkeys = useMemo<HotkeyBinding[]>(() => [
    { keys: ["g f"], sequence: ["g", "f"], description: "Gå til Fra faktura", handler: () => navigate(paths.fraFaktura()) },
    { keys: ["g v"], sequence: ["g", "v"], description: "Gå til varer", handler: () => navigate(paths.varer()) },
    { keys: ["g p"], sequence: ["g", "p"], description: "Gå til fakturaer", handler: () => navigate(paths.alleFakturaer()) },
    { keys: ["?"], description: "Vis hurtigtaster", handler: () => setHelpOpen(true) },
  ], [navigate]);
  useHotkeys(hotkeys);

  function setPeriod(p: 30 | 90 | 365) {
    const next = new URLSearchParams(sp);
    if (p === 30) next.delete("periode"); else next.set("periode", String(p));
    setSp(next, { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-page py-5">
      <h1 className="font-display text-2xl leading-tight">{firstName ? `Hei, ${firstName}` : "Råvarer"}</h1>
      <InvoiceReadingAlert enabled={invoiceAccess} />
      {summaryQ.isError
        ? <QueryErrorState error={summaryQ.error} scope="ravarer:oversikt:summary" onRetry={() => summaryQ.refetch()} />
        : (
          <FraFakturaOverviewCard
            counts={invoiceAccess ? counts : null}
            summary={summaryQ.data ?? null}
            invoiceAccess={invoiceAccess}
            health={healthQ.data}
            healthError={healthQ.isError}
            banner={readingBannerState(healthQ.data, loadKeyTestOk())}
            movers={moversQ.data?.items ?? null}
            moversError={moversQ.isError}
            period={period}
          />
        )}

      <details className="rounded-lg border border-border bg-card" onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="flex min-h-[44px] cursor-pointer items-center px-4 text-sm font-medium">Mer: prisutvikling, aktivitet og datakvalitet</summary>
        <div className="space-y-6 p-4 pt-0">
          {moversQ.isError
            ? <QueryErrorState error={moversQ.error} scope="ravarer:oversikt:movers" onRetry={() => moversQ.refetch()} />
            : <PriceMoversView data={moversQ.data ?? null} period={period} onPeriodChange={setPeriod} loading={moversQ.isLoading} />}
          {invoiceAccess && more && (activityQ.isError
            ? <QueryErrorState error={activityQ.error} scope="ravarer:oversikt:activity" onRetry={() => activityQ.refetch()} />
            : <ActivityView data={activityQ.data ?? null} loading={activityQ.isLoading} />)}
          <DataQualityView
            dq={summaryQ.data?.data_quality ?? null}
            supplier={summaryQ.data?.supplier_items ?? null}
            stockBelowMin={summaryQ.data?.other.stock_below_min ?? 0}
            loading={summaryQ.isLoading}
            error={summaryQ.isError ? summaryQ.error : undefined}
            onRetry={() => void summaryQ.refetch()}
          />
        </div>
      </details>
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} bindings={hotkeys} />
    </div>
  );
}
