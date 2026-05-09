import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  TruckIcon,
  PauseCircle,
  FileEdit,
  Package,
  ArrowRight,
  
} from "lucide-react";
import { TicketsInbox } from "@/ordre/components/shell/TicketsInbox";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { DateContextChips } from "@/ordre/components/shell/DateContextChips";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useStatusCounts,
  useDeliveryDayStats,
  useActionQueueCounts,
} from "@/ordre/hooks/useOrders";
import { ORDER_STATUSES } from "@/ordre/lib/orderStatus";
import { formatNOK, todayISO, tomorrow, formatDateLong } from "@/ordre/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const [contextDate, setContextDate] = useState<string>(todayISO());
  const { data: counts, isLoading: countsLoading } = useStatusCounts();
  const today = todayISO();
  const tom = tomorrow();
  const { data: ctxStats, isLoading: ctxLoading } = useDeliveryDayStats(contextDate);
  const { data: tomStats, isLoading: tomLoading } = useDeliveryDayStats(tom);
  const { data: queue, isLoading: queueLoading } = useActionQueueCounts();
  

  const countOf = (status: string) => counts?.find((c) => c.status === status)?.count ?? 0;
  const ctxCountOf = (status: string) =>
    ctxStats?.statusBreakdown?.find((s) => s.status === status)?.count ?? 0;

  const isToday = contextDate === today;

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
        {/* Dato-kontekst */}
        <DateContextChips date={contextDate} onChange={setContextDate} />

        {/* Hero: Innboks (tickets) — ordrekontorets primære arbeidsflate */}
        <TicketsInbox />

        {/* Hero-rad: valgt dato + i morgen + tiltakskø */}
        <section className="grid gap-4 lg:grid-cols-3">
          {/* Valgt dato (default i dag) */}
          <Card className="lg:col-span-2 border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-caption uppercase tracking-wide text-muted-foreground">
                  {isToday ? "Levering i dag" : `Levering ${formatDateLong(contextDate)}`}
                </CardTitle>
                <div className="mt-1 flex items-baseline gap-3">
                  {ctxLoading ? (
                    <Skeleton className="h-9 w-16" />
                  ) : (
                    <>
                      <span className="text-display font-semibold text-foreground">
                        {ctxStats?.count ?? 0}
                      </span>
                      <span className="text-body text-muted-foreground">
                        {formatNOK(ctxStats?.total ?? 0)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <TruckIcon className="h-6 w-6 text-primary" />
            </CardHeader>
            <CardContent>
              {ctxLoading ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    "confirmed",
                    "in_production",
                    "packed",
                    "partial_delivery",
                    "delivered",
                  ].map((status) => {
                    const meta = ORDER_STATUSES.find((s) => s.value === status)!;
                    const c = ctxCountOf(status);
                    return (
                      <Link
                        key={status}
                        to={`/ordre/ordrer?status=${status}&deliveryFrom=${contextDate}&deliveryTo=${contextDate}`}
                        className={cn(
                          "rounded-md border border-border bg-background px-2.5 py-2 transition-colors hover:border-primary/50 hover:bg-muted/50",
                          c === 0 && "opacity-50",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: `hsl(var(${meta.tokenVar}))` }}
                          />
                          <span className="truncate text-caption text-muted-foreground">
                            {meta.label}
                          </span>
                        </div>
                        <div className="mt-1 text-title font-semibold leading-none">{c}</div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* I morgen */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-caption uppercase tracking-wide text-muted-foreground">
                Levering i morgen
              </CardTitle>
              <div className="mt-1 flex items-baseline gap-3">
                {tomLoading ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <>
                    <span className="text-display font-semibold text-foreground">
                      {tomStats?.count ?? 0}
                    </span>
                    <span className="text-body text-muted-foreground">
                      {formatNOK(tomStats?.total ?? 0)}
                    </span>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Link
                to={`/ordre/ordrer?deliveryFrom=${tom}&deliveryTo=${tom}`}
                className="inline-flex items-center gap-1 text-body text-primary hover:underline"
              >
                Vis ordrer for i morgen
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </section>

        {/* Tiltakskø — innboks med AI-forslag */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Tiltaksinnboks
            <span className="rounded-full bg-app/10 px-2 py-0.5 text-[10px] font-medium text-app">
              AI-assistert
            </span>
          </h2>
          <OrderActionInbox />
        </section>

        {/* Tiltakskø — kompakte tellere */}
        <section>
          <h2 className="mb-3 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Tiltakskø
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ActionTile
              icon={PauseCircle}
              label="På vent"
              count={queue?.onHold ?? 0}
              loading={queueLoading}
              tokenVar="--status-on-hold"
              to="/ordre/ordrer?status=on_hold"
            />
            {(queue?.drafts ?? 0) > 0 && (
              <ActionTile
                icon={FileEdit}
                label="Utkast (parkerte ordre)"
                count={queue?.drafts ?? 0}
                loading={queueLoading}
                tokenVar="--status-draft"
                to="/ordre/ordrer?status=draft"
              />
            )}
            <ActionTile
              icon={Package}
              label="Pakket i dag"
              count={queue?.packedToday ?? 0}
              loading={queueLoading}
              tokenVar="--status-packed"
              to={`/ordre/ordrer?status=packed&deliveryFrom=${today}&deliveryTo=${today}`}
            />
          </div>
        </section>


        {/* Kompakt status-strip — alle 10 statuser */}
        <section>
          <h2 className="mb-3 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Alle ordrer per status
          </h2>
          {countsLoading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
              {ORDER_STATUSES.map((s) => {
                const count = countOf(s.value);
                return (
                  <Link
                    key={s.value}
                    to={`/ordre/ordrer?status=${s.value}`}
                    className={cn(
                      "group rounded-md border border-border bg-card px-2.5 py-2 transition-all hover:border-primary/50 hover:shadow-sm",
                      count === 0 && "opacity-60",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: `hsl(var(${s.tokenVar}))` }}
                      />
                      <span className="truncate text-caption text-muted-foreground">
                        {s.label}
                      </span>
                    </div>
                    <div
                      className="mt-1 text-title font-semibold leading-none"
                      style={{ color: `hsl(var(${s.tokenVar}))` }}
                    >
                      {count}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ActionTile({
  icon: Icon,
  label,
  count,
  loading,
  tokenVar,
  to,
  urgent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  loading: boolean;
  tokenVar: string;
  to: string;
  urgent?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex items-center gap-3 rounded-lg border bg-card p-3 transition-all hover:shadow-md",
        urgent && count > 0
          ? "border-[hsl(var(--alert-warning))]/40 bg-[hsl(var(--alert-warning))]/5"
          : "border-border hover:border-primary/40",
      )}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-md"
        style={{
          backgroundColor: `hsl(var(${tokenVar}) / 0.12)`,
          color: `hsl(var(${tokenVar}))`,
        }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-caption text-muted-foreground">{label}</div>
        {loading ? (
          <Skeleton className="mt-0.5 h-6 w-10" />
        ) : (
          <div className="text-title font-semibold leading-tight text-foreground">{count}</div>
        )}
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
