import { AlertTriangle, CheckCircle2, ClipboardList, FileWarning, TrendingUp, Warehouse } from "lucide-react";
import { OrderDeskKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { paths } from "@/ravarer/lib/paths";
import { autoReconciledPct, dataRydding } from "./logic";
import type { PriceMovers, WorkSummary } from "@/ravarer/lib/workRpcTypes";

export type KpiRowViewProps = {
  summary: WorkSummary | null;
  movers: PriceMovers | null;
  loading?: boolean;
};

function kr(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(Math.round(n)).toLocaleString("nb-NO")} kr`;
}

export function KpiRowView({ summary, movers, loading }: KpiRowViewProps) {
  const hasInvoice = summary?.invoice_access ?? false;
  const inv = summary?.invoices;
  const dq = summary?.data_quality;
  const approval = summary?.approval;
  const todo = summary?.todo_total ?? 0;
  const auto = inv?.reconciled_auto_7d ?? 0;
  const total = inv?.reconciled_7d ?? 0;
  const pct = autoReconciledPct(auto, total);
  const effect = movers?.summary.effect_nok ?? 0;
  const up = movers?.summary.up ?? 0;
  const down = movers?.summary.down ?? 0;
  const expiring30 = summary?.other.agreements_expiring_30d ?? 0;
  const expiring90 = summary?.other.agreements_expiring_90d ?? 0;

  return (
    <div className="-mx-page grid grid-flow-col auto-cols-[minmax(78%,1fr)] gap-3 overflow-x-auto px-page pb-1 sm:mx-0 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 2xl:grid-cols-6">
      {hasInvoice && (
        <>
          <OrderDeskKpi
            label="Å gjøre i priskontroll" value={todo}
            tone={todo > 0 ? "warning" : "ok"} loading={loading}
            icon={ClipboardList} to={paths.priskontroll({ fane: "gjore" })}
          />
          <OrderDeskKpi
            label="Avstemt automatisk" value={`${pct} %`}
            sub={`${auto} av ${total} siste 7 dager`} tone={pct >= 80 ? "ok" : "default"}
            loading={loading} icon={CheckCircle2}
            to={paths.alleFakturaer({ status: "reconciled" })}
          />
          <OrderDeskKpi
            label="Prisendringer 30 d" value={kr(effect)}
            sub={`${up} opp · ${down} ned`} tone={effect > 0 ? "warning" : "ok"}
            loading={loading} icon={TrendingUp} to="#prisbevegelser"
          />
          <OrderDeskKpi
            label="Klare til godkjenning" value={approval?.ready_to_approve ?? 0}
            tone={(approval?.ready_to_approve ?? 0) > 0 ? "info" : "default"}
            loading={loading} icon={ClipboardList} to={paths.godkjenning()}
          />
        </>
      )}
      <OrderDeskKpi
        label="Varer med mangler" value={dq ? dataRydding(dq) : 0}
        tone="warning" loading={loading} icon={FileWarning} to="#datakvalitet"
      />
      <OrderDeskKpi
        label="Avtaler som utløper" value={expiring30}
        sub={expiring90 > 0 ? `${expiring90} innen 90 dager` : undefined}
        tone={expiring30 > 0 ? "warning" : "default"} loading={loading}
        icon={AlertTriangle} to={paths.avtaler()}
      />
      {!hasInvoice && (
        <OrderDeskKpi
          label="Under minimumslager" value={summary?.other.stock_below_min ?? 0}
          tone={(summary?.other.stock_below_min ?? 0) > 0 ? "warning" : "default"}
          loading={loading} icon={Warehouse} to={paths.lager()}
        />
      )}
    </div>
  );
}
