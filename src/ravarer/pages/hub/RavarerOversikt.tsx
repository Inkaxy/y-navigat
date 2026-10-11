import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { QueryErrorState } from "@/components/common/QueryState";
import { useAuth } from "@/hooks/useAuth";
import { useHotkeys } from "@/ravarer/ui/hotkeys";
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
  const itemsQ = useWorkItems({ group: "alle", sort: "impact", limit: 7 });
  const activityQ = useActivityFeed({ days: 7 });
  const moversQ = usePriceMovers({ days: period });

  useHotkeys(
    useMemo(() => [
      { keys: ["p"], description: "Gå til priskontroll", handler: () => navigate(paths.priskontroll({ fane: "gjore" })) },
      { keys: ["v"], description: "Gå til varer", handler: () => navigate(paths.varer()) },
    ], [navigate]),
  );

  const first = firstNameFromEmail(user?.email);

  function setPeriod(p: 30 | 90 | 365) {
    const next = new URLSearchParams(sp);
    if (p === 30) next.delete("periode"); else next.set("periode", String(p));
    setSp(next, { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6 px-page py-6">
      <HeaderView summary={summaryQ.data ?? null} firstName={first} />

      {summaryQ.isError && (
        <QueryErrorState error={summaryQ.error} scope="ravarer:oversikt:summary" onRetry={() => summaryQ.refetch()} />
      )}
      <KpiRowView summary={summaryQ.data ?? null} movers={moversQ.data ?? null} loading={summaryQ.isLoading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {itemsQ.isError
          ? <QueryErrorState error={itemsQ.error} scope="ravarer:oversikt:items" onRetry={() => itemsQ.refetch()} />
          : <ToDoListView data={itemsQ.data ?? null} loading={itemsQ.isLoading} />}
        {activityQ.isError
          ? <QueryErrorState error={activityQ.error} scope="ravarer:oversikt:activity" onRetry={() => activityQ.refetch()} />
          : <ActivityView data={activityQ.data ?? null} loading={activityQ.isLoading} />}
      </div>

      {moversQ.isError
        ? <QueryErrorState error={moversQ.error} scope="ravarer:oversikt:movers" onRetry={() => moversQ.refetch()} />
        : <PriceMoversView data={moversQ.data ?? null} period={period} onPeriodChange={setPeriod} loading={moversQ.isLoading} />}

      <DataQualityView
        dq={summaryQ.data?.data_quality ?? null}
        supplier={summaryQ.data?.supplier_items ?? null}
        stockBelowMin={summaryQ.data?.other.stock_below_min ?? 0}
        loading={summaryQ.isLoading}
      />
    </div>
  );
}
