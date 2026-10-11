import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { QueryErrorState } from "@/components/common/QueryState";
import { useAuth } from "@/hooks/useAuth";
import { useHotkeys, type HotkeyBinding } from "@/ravarer/ui/hotkeys";
import { ShortcutHelp } from "@/ravarer/ui/ShortcutHelp";
import { useNavigate } from "react-router-dom";
import { paths } from "@/ravarer/lib/paths";
import { useWorkSummary, useWorkItems, useActivityFeed, usePriceMovers } from "@/ravarer/hooks/useWorkData";
import { HeaderView } from "@/ravarer/pages/oversikt/HeaderView";
import { KpiRowView } from "@/ravarer/pages/oversikt/KpiRowView";
import { ToDoListView } from "@/ravarer/pages/oversikt/ToDoListView";
import { ActivityView } from "@/ravarer/pages/oversikt/ActivityView";
import { PriceMoversView } from "@/ravarer/pages/oversikt/PriceMoversView";
import { DataQualityView } from "@/ravarer/pages/oversikt/DataQualityView";

function firstNameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const left = email.split("@")[0].split(/[._-]/)[0];
  return left ? left[0].toUpperCase() + left.slice(1) : null;
}

/** Oversikt — svarer på «Hva venter? Hva skjedde? Hva endret seg?» */
export default function RavarerOversikt() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const period = (Number(sp.get("periode")) === 90 ? 90 : Number(sp.get("periode")) === 365 ? 365 : 30) as 30 | 90 | 365;

  const summaryQ = useWorkSummary({ includeApproval: true });
  // rm_work_items / rm_activity_feed krever fakturatilgang — kall dem bare når den er bekreftet.
  const invoiceAccess = summaryQ.data?.invoice_access === true;
  const accessKnown = !!summaryQ.data;
  const itemsQ = useWorkItems({ group: "alle", sort: "impact", limit: 7, enabled: invoiceAccess });
  const activityQ = useActivityFeed({ days: 7, enabled: invoiceAccess });
  const moversQ = usePriceMovers({ days: period });
  // KPI-flisen er alltid 30 dager, uavhengig av periodevelgeren.
  const movers30Q = usePriceMovers({ days: 30 });
  const [helpOpen, setHelpOpen] = useState(false);

  const hotkeys = useMemo<HotkeyBinding[]>(() => [
    { keys: ["g p"], sequence: ["g", "p"], description: "Gå til priskontroll", handler: () => navigate(paths.priskontroll({ fane: "gjore" })) },
    { keys: ["g v"], sequence: ["g", "v"], description: "Gå til varer", handler: () => navigate(paths.varer()) },
    { keys: ["?"], description: "Vis hurtigtaster", handler: () => setHelpOpen(true) },
  ], [navigate]);
  useHotkeys(hotkeys);

  const first = firstNameFromEmail(user?.email);

  function setPeriod(p: 30 | 90 | 365) {
    const next = new URLSearchParams(sp);
    if (p === 30) next.delete("periode"); else next.set("periode", String(p));
    setSp(next, { replace: true });
  }

  const dataQuality = (
    <DataQualityView
      dq={summaryQ.data?.data_quality ?? null}
      supplier={summaryQ.data?.supplier_items ?? null}
      stockBelowMin={summaryQ.data?.other.stock_below_min ?? 0}
      loading={summaryQ.isLoading}
      error={summaryQ.isError ? summaryQ.error : undefined}
      onRetry={() => void summaryQ.refetch()}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-page py-6">
      <HeaderView summary={summaryQ.data ?? null} firstName={first} />

      {summaryQ.isError && (
        <QueryErrorState error={summaryQ.error} scope="ravarer:oversikt:summary" onRetry={() => summaryQ.refetch()} />
      )}
      <KpiRowView summary={summaryQ.data ?? null} movers={movers30Q.data ?? null} loading={summaryQ.isLoading} />

      {accessKnown && !invoiceAccess && dataQuality}

      {invoiceAccess && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          {itemsQ.isError
            ? <QueryErrorState error={itemsQ.error} scope="ravarer:oversikt:items" onRetry={() => itemsQ.refetch()} />
            : <ToDoListView data={itemsQ.data ?? null} loading={itemsQ.isLoading} />}
          {activityQ.isError
            ? <QueryErrorState error={activityQ.error} scope="ravarer:oversikt:activity" onRetry={() => activityQ.refetch()} />
            : <ActivityView data={activityQ.data ?? null} loading={activityQ.isLoading} />}
        </div>
      )}

      {moversQ.isError
        ? <QueryErrorState error={moversQ.error} scope="ravarer:oversikt:movers" onRetry={() => moversQ.refetch()} />
        : <PriceMoversView data={moversQ.data ?? null} period={period} onPeriodChange={setPeriod} loading={moversQ.isLoading} />}

      {(invoiceAccess || !accessKnown) && dataQuality}
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} bindings={hotkeys} />
    </div>
  );
}
