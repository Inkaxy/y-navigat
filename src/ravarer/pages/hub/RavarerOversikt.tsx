import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { QueryErrorState } from "@/components/common/QueryState";
import { useAuth } from "@/hooks/useAuth";
import { useHotkeys, type HotkeyBinding } from "@/ravarer/ui/hotkeys";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { paths } from "@/ravarer/lib/paths";
import { useWorkSummary, useWorkItems, useActivityFeed, usePriceMovers } from "@/ravarer/hooks/useWorkData";
import { useCompany } from "@/hooks/useCompany";
import { useInboxInvoices } from "@/fakturaer/hooks/useInboxInvoices";
import { openWorkCounts } from "@/ravarer/pages/priskontroll/fakturaer/useFakturaListe";
import { WorkStartView } from "@/ravarer/pages/oversikt/WorkStartView";
import { ToDoListView } from "@/ravarer/pages/oversikt/ToDoListView";
import { ActivityView } from "@/ravarer/pages/oversikt/ActivityView";
import { PriceMoversView } from "@/ravarer/pages/oversikt/PriceMoversView";
import { DataQualityView } from "@/ravarer/pages/oversikt/DataQualityView";

function firstNameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const left = email.split("@")[0].split(/[._-]/)[0];
  return left ? left[0].toUpperCase() + left.slice(1) : null;
}

/** Oversikt = arbeidsstart: statusstripe, én «Start behandling», neste oppgaver (eldste først), snarveier. */
export default function RavarerOversikt() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const period = (Number(sp.get("periode")) === 90 ? 90 : Number(sp.get("periode")) === 365 ? 365 : 30) as 30 | 90 | 365;

  const summaryQ = useWorkSummary({ includeApproval: true });
  const invoiceAccess = summaryQ.data?.invoice_access === true;
  // «Trenger deg»/«Klare» med nøyaktig samme filter som Fakturaer-flaten (komplett liste, uten internt godkjente).
  const { data: company } = useCompany();
  const openQ = useInboxInvoices({ legalEntityId: invoiceAccess ? company?.id ?? null : null, supplierId: null });
  const openCounts = invoiceAccess && company?.id && openQ.data && !openQ.isError ? openWorkCounts(openQ.data) : null;
  const itemsQ = useWorkItems({ group: "alle", sort: "oldest", limit: 5, enabled: invoiceAccess });
  const [more, setMore] = useState(false);
  const activityQ = useActivityFeed({ days: 7, enabled: invoiceAccess && more });
  const moversQ = usePriceMovers({ days: period });
  const [helpOpen, setHelpOpen] = useState(false);

  const hotkeys = useMemo<HotkeyBinding[]>(() => [
    { keys: ["g p"], sequence: ["g", "p"], description: "Gå til fakturaer", handler: () => navigate(paths.priskontroll({ fane: "gjore" })) },
    { keys: ["g v"], sequence: ["g", "v"], description: "Gå til varer", handler: () => navigate(paths.varer()) },
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
      {summaryQ.isError
        ? <QueryErrorState error={summaryQ.error} scope="ravarer:oversikt:summary" onRetry={() => summaryQ.refetch()} />
        : <WorkStartView summary={summaryQ.data ?? null} open={openCounts} firstName={firstNameFromEmail(user?.email)} />}

      {invoiceAccess && (itemsQ.isError
        ? <QueryErrorState error={itemsQ.error} scope="ravarer:oversikt:items" onRetry={() => itemsQ.refetch()} />
        : <ToDoListView data={itemsQ.data ?? null} loading={itemsQ.isLoading} />)}

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
