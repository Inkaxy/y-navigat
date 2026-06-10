import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, ShoppingBag, PlayCircle, Monitor } from "lucide-react";
import { fmtMoney } from "@/pos_styring/lib/dashboardQueries";

interface Props {
  loading?: boolean;
  grossNet: number;
  saleCount: number;
  openSessions: number;
  terminalsActive: number;
  terminalsTotal: number;
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: typeof Receipt;
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-app-pastel text-app-dark">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        )}
        {sub && !loading && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

export function DashboardKpiRow({
  loading,
  grossNet,
  saleCount,
  openSessions,
  terminalsActive,
  terminalsTotal,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi icon={Receipt} label="Omsetning i dag" value={fmtMoney(grossNet)} loading={loading} />
      <Kpi icon={ShoppingBag} label="Antall salg i dag" value={String(saleCount)} loading={loading} />
      <Kpi icon={PlayCircle} label="Aktive sesjoner" value={String(openSessions)} loading={loading} />
      <Kpi
        icon={Monitor}
        label="Terminaler"
        value={String(terminalsTotal)}
        sub={`${terminalsActive} aktive`}
        loading={loading}
      />
    </div>
  );
}
