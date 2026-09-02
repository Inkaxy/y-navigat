import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  TruckIcon,
  ArrowRight,
  Mail,
  CalendarClock,
  AlertCircle,
} from "lucide-react";
import { TicketsInbox } from "@/ordre/components/shell/TicketsInbox";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDeliveryDayStats } from "@/ordre/hooks/useOrders";
import { useTicketCounts } from "@/ordre/hooks/useTickets";
import { usePendingRecurringOrderRows } from "@/ordre/hooks/usePendingRecurringOrders";
import { formatNOK, todayISO, tomorrow, formatDateLong } from "@/ordre/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { osloDateISO } from "@/lib/osloDate";

export default function Dashboard() {
  const today = todayISO();
  const tom = tomorrow();
  const [pendingDate, setPendingDate] = useState<string>(tom);

  const { data: todayStats, isLoading: todayLoading } = useDeliveryDayStats(today);
  const { data: tomStats, isLoading: tomLoading } = useDeliveryDayStats(tom);
  const { data: ticketCounts, isLoading: ticketsLoading } = useTicketCounts();
  const { data: pendingRows = [], isLoading: pendingLoading } = usePendingRecurringOrderRows(
    pendingDate,
    "all",
  );

  return (
    <>
      <AppBanner
        actions={
          <Button asChild size="sm" className="gap-2">
            <Link to="/ordre/ordrer/ny">
              <Plus className="h-4 w-4" />
              Ny ordre
            </Link>
          </Button>
        }
      />
      <div className="container mx-auto space-y-6 px-page py-6 sm:px-page">
        {/* KPI-strip */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Nye e-poster"
            value={ticketCounts?.newCount ?? 0}
            sub={`${ticketCounts?.inProgressCount ?? 0} pågår`}
            loading={ticketsLoading}
            icon={Mail}
            tone="info"
            to="/ordre/ticket?status=new"
          />
          <KpiCard
            label="Fastordre i dag (ikke kjørt)"
            value={pendingRows.length}
            sub={pendingDate === tom ? "for i morgen" : `for ${formatDateLong(pendingDate)}`}
            loading={pendingLoading}
            icon={AlertCircle}
            tone={pendingRows.length > 0 ? "warning" : "ok"}
            to={`/ordre/faste-rutiner?date=${pendingDate}`}
          />
          <KpiCard
            label="Levering i dag"
            value={todayStats?.count ?? 0}
            sub={formatNOK(todayStats?.total ?? 0)}
            loading={todayLoading}
            icon={TruckIcon}
            tone="default"
            to={`/ordre/ordrer?deliveryFrom=${today}&deliveryTo=${today}`}
          />
          <KpiCard
            label="Levering i morgen"
            value={tomStats?.count ?? 0}
            sub={formatNOK(tomStats?.total ?? 0)}
            loading={tomLoading}
            icon={CalendarClock}
            tone="default"
            to={`/ordre/ordrer?deliveryFrom=${tom}&deliveryTo=${tom}`}
          />
        </section>

        {/* Hovedrad: e-post + fastordre side ved side */}
        <section className="grid gap-6 xl:grid-cols-5">
          {/* Nye e-poster — bruker eksisterende TicketsInbox */}
          <div className="xl:col-span-3">
            <TicketsInbox />
          </div>

          {/* Fastordre i dag (ikke kjørt) */}
          <div className="xl:col-span-2">
            <PendingRecurringCard
              date={pendingDate}
              onChangeDate={setPendingDate}
              rows={pendingRows}
              loading={pendingLoading}
            />
          </div>
        </section>
      </div>
    </>
  );
}

function KpiCard({
  label,
  value,
  sub,
  loading,
  icon: Icon,
  tone,
  to,
}: {
  label: string;
  value: number;
  sub?: string;
  loading?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  tone: "info" | "warning" | "ok" | "default";
  to: string;
}) {
  const toneClass =
    tone === "info"
      ? "text-[hsl(var(--alert-info))] bg-[hsl(var(--alert-info))]/10"
      : tone === "warning"
        ? "text-[hsl(var(--alert-warning))] bg-[hsl(var(--alert-warning))]/10"
        : tone === "ok"
          ? "text-[hsl(var(--alert-success))] bg-[hsl(var(--alert-success))]/10"
          : "text-primary bg-primary/10";

  return (
    <Link
      to={to}
      className="group rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-caption uppercase tracking-wide text-muted-foreground">{label}</div>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <div className="mt-1 text-display font-semibold leading-none text-foreground">
              {value}
            </div>
          )}
          {sub && !loading && (
            <div className="mt-1.5 text-caption text-muted-foreground">{sub}</div>
          )}
        </div>
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-md", toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function PendingRecurringCard({
  date,
  onChangeDate,
  rows,
  loading,
}: {
  date: string;
  onChangeDate: (d: string) => void;
  rows: Array<{
    schedule_id: string;
    customer_id: string;
    customer_display_name: string;
    customer_number: string | null;
    tour_label: string | null;
  }>;
  loading: boolean;
}) {
  const today = todayISO();
  const tom = tomorrow();
  const dayAfter = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 2);
    return osloDateISO(d);
  })();

  const VISIBLE = 12;
  const visibleRows = rows.slice(0, VISIBLE);
  const overflow = rows.length - visibleRows.length;

  return (
    <Card className="h-full">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-[hsl(var(--alert-warning))]" />
              Fastordre i dag (ikke kjørt)
            </CardTitle>
            <p className="mt-1 text-caption text-muted-foreground">
              Kunder med fastordre som ennå ikke er bekreftet eller justert for valgt dato.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <DateChip label="I dag" active={date === today} onClick={() => onChangeDate(today)} />
          <DateChip label="I morgen" active={date === tom} onClick={() => onChangeDate(tom)} />
          <DateChip
            label="Overmorgen"
            active={date === dayAfter}
            onClick={() => onChangeDate(dayAfter)}
          />
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-body text-muted-foreground">
            Alle fastordrekunder er regulert for {formatDateLong(date)}.
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {visibleRows.map((row) => (
                <li key={row.schedule_id}>
                  <Link
                    to={`/kunder/kundeliste/${row.customer_id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-foreground">
                        {row.customer_display_name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
                        {row.customer_number && <span>#{row.customer_number}</span>}
                        {row.tour_label && (
                          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                            {row.tour_label}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-center justify-between text-caption">
              <span className="text-muted-foreground">
                {overflow > 0 ? `+${overflow} flere kunder` : `Viser alle ${rows.length}`}
              </span>
              <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                <Link to={`/ordre/faste-rutiner?date=${date}`}>
                  Åpne fastordre
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DateChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-caption font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

