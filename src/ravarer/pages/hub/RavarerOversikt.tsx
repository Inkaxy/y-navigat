import { AlertTriangle, CheckCircle2, ClipboardList, FileWarning, Warehouse } from "lucide-react";
import { OrderDeskKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { QueryErrorState } from "@/components/common/QueryState";
import { useWorkSummary } from "@/ravarer/hooks/useWorkData";
import { paths } from "@/ravarer/lib/paths";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { RAVARER_EYEBROW } from "./hubTabs";

/** Oversikt (fase 1): én rad nøkkeltall fra `rm_work_summary`. Bygges ut i fase 2. */
export default function RavarerOversikt() {
  const q = useWorkSummary({ includeApproval: true });
  const s = q.data;
  const loading = q.isLoading;
  const dq = s?.data_quality;
  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Oversikt" subtitle="Det viktigste i Råvarer akkurat nå." embedsPage={false}>
      {q.isError ? (
        <QueryErrorState error={q.error} scope="ravarer:oversikt" onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(loading || s?.invoice_access) && (
            <OrderDeskKpi
              label="Å gjøre i priskontroll" value={s?.todo_total ?? 0} to={paths.priskontroll()} icon={ClipboardList}
              tone={(s?.todo_total ?? 0) > 0 ? "warning" : "ok"} loading={loading}
            />
          )}
          {(loading || s?.invoice_access) && (
            <OrderDeskKpi
              label="Avstemt automatisk (7 d)" value={s?.invoices?.reconciled_auto_7d ?? 0}
              sub={s?.invoices ? `av ${s.invoices.reconciled_7d} avstemt` : undefined}
              to={paths.alleFakturaer({ status: "reconciled" })} icon={CheckCircle2} tone="ok" loading={loading}
            />
          )}
          <OrderDeskKpi
            label="Varer med mangler" value={dq ? dq.missing_package + dq.missing_declaration + dq.missing_nutrition : 0}
            to={paths.pakninger()} icon={FileWarning} tone="warning" loading={loading}
          />
          <OrderDeskKpi
            label="Avtaler som utløper (30 d)" value={s?.other.agreements_expiring_30d ?? 0}
            to={paths.avtaler()} icon={AlertTriangle} tone={(s?.other.agreements_expiring_30d ?? 0) > 0 ? "warning" : "default"} loading={loading}
          />
          <OrderDeskKpi
            label="Under minimumslager" value={s?.other.stock_below_min ?? 0}
            to={paths.lager()} icon={Warehouse} tone={(s?.other.stock_below_min ?? 0) > 0 ? "warning" : "default"} loading={loading}
          />
        </div>
      )}
    </ModulePage>
  );
}
