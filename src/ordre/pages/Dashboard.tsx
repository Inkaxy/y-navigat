import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  TruckIcon,
  ArrowRight,
  Mail,
  CalendarClock,
  AlertCircle,
  CheckCircle2,
  Globe,
  MapPinOff,
  FileText,
  RefreshCw,
  Inbox,
  Repeat,
} from "lucide-react";
import { TicketsInboxWidget } from "@/ordre/components/shell/TicketsInboxWidget";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrderDeskKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { WorkQueueCard } from "@/ordre/components/dashboard/WorkQueueCard";
import { DeskSectionState } from "@/ordre/components/dashboard/DeskSectionState";
import { useOrderDeskBoard } from "@/ordre/hooks/useOrderDeskBoard";
import { formatNOK, todayISO, tomorrow, formatDateLong } from "@/ordre/lib/format";
import { cn } from "@/lib/utils";
import { osloDateISO } from "@/lib/osloDate";

export default function Dashboard() {
  const today = todayISO();
  const tom = tomorrow();
  const [pendingDate, setPendingDate] = useState<string>(tom);

  const board = useOrderDeskBoard({ pendingDate });
  const { kpi, queues } = board;

  return (
    <>
      <AppBanner
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={board.refetchAll}
              disabled={board.isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", board.isFetching && "animate-spin")} />
              <span className="sr-only sm:not-sr-only">Oppdater</span>
            </Button>
            <Button asChild size="sm" className="gap-2">
              <Link to="/ordre/ordrer/ny">
                <Plus className="h-4 w-4" />
                Ny ordre
              </Link>
            </Button>
          </div>
        }
      />
      <div className="container mx-auto space-y-6 px-page py-6 sm:px-page">
        <h1 className="sr-only">Ordrekontoret — arbeidsbord</h1>

        {/* KPI-strip: hele driftsbildet på én linje */}
        <section aria-label="Nøkkeltall" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <OrderDeskKpi
            label="Til godkjenning"
            value={kpi.approvals.count}
            sub="ordre venter"
            icon={CheckCircle2}
            tone={kpi.approvals.count > 0 ? "critical" : "ok"}
            loading={kpi.approvals.isLoading}
            failed={kpi.approvals.isError}
            to="/ordre/ordrer?status=awaiting_confirmation"
          />
          <OrderDeskKpi
            label="Nye e-poster"
            value={kpi.tickets.newCount}
            sub={`${kpi.tickets.openCount} åpne`}
            icon={Mail}
            tone={kpi.tickets.newCount > 0 ? "info" : "ok"}
            loading={kpi.tickets.isLoading}
            failed={kpi.tickets.isError}
            to="/ordre/ticket?status=new"
          />
          <OrderDeskKpi
            label="Uten ansvarlig"
            value={kpi.tickets.unassignedCount}
            sub="e-poster"
            icon={Inbox}
            tone={kpi.tickets.unassignedCount > 0 ? "warning" : "ok"}
            loading={kpi.tickets.isLoading}
            failed={kpi.tickets.isError}
            to="/ordre/ticket?assigned=unassigned"
          />
          <OrderDeskKpi
            label="Nettbutikk"
            value={kpi.website.count}
            sub="til behandling"
            icon={Globe}
            tone={kpi.website.count > 0 ? "warning" : "ok"}
            loading={kpi.website.isLoading}
            failed={kpi.website.isError}
            to="/ordre/nettbutikk"
          />
          <OrderDeskKpi
            label="Fastordre"
            value={kpi.recurring.count}
            sub={pendingDate === tom ? "i morgen, ikke kjørt" : formatDateLong(pendingDate)}
            icon={Repeat}
            tone={kpi.recurring.count > 0 ? "warning" : "ok"}
            loading={kpi.recurring.isLoading}
            failed={kpi.recurring.isError}
            to={`/ordre/faste-rutiner?date=${pendingDate}`}
          />
          <OrderDeskKpi
            label="Uten tur i dag"
            value={kpi.withoutTour.count}
            sub="må plasseres"
            icon={MapPinOff}
            tone={kpi.withoutTour.count > 0 ? "critical" : "ok"}
            loading={kpi.withoutTour.isLoading}
            failed={kpi.withoutTour.isError}
            to={`/ordre/leveringskalender?date=${today}`}
          />
          <OrderDeskKpi
            label="Levering i dag"
            value={kpi.today.count}
            sub={formatNOK(kpi.today.total)}
            icon={TruckIcon}
            loading={kpi.today.isLoading}
            failed={kpi.today.isError}
            to={`/ordre/ordrer?deliveryFrom=${today}&deliveryTo=${today}`}
          />
          <OrderDeskKpi
            label="Levering i morgen"
            value={kpi.tomorrow.count}
            sub={formatNOK(kpi.tomorrow.total)}
            icon={CalendarClock}
            loading={kpi.tomorrow.isLoading}
            failed={kpi.tomorrow.isError}
            to={`/ordre/ordrer?deliveryFrom=${tom}&deliveryTo=${tom}`}
          />
        </section>

        {/* Arbeidskøer */}
        <section aria-label="Arbeidskøer" className="grid gap-6 xl:grid-cols-3">
          <WorkQueueCard
            title="Må håndteres nå"
            description="Ordre til godkjenning og e-poster som haster eller mangler ansvarlig."
            icon={AlertCircle}
            scope="ordre-desk/must-handle"
            rows={queues.mustHandle.rows}
            total={queues.mustHandle.total}
            viewAllTo="/ordre/ordrer?status=awaiting_confirmation"
            viewAllLabel="Godkjenningskø"
            isLoading={queues.mustHandle.isLoading}
            isError={queues.mustHandle.isError}
            error={queues.mustHandle.error}
            onRetry={queues.mustHandle.refetch}
            emptyText="Ingenting haster akkurat nå."
            maxRows={7}
          />
          <WorkQueueCard
            title="Neste leveringer"
            description={`Ordre med levering ${formatDateLong(today)} – ${formatDateLong(tom)}.`}
            icon={TruckIcon}
            scope="ordre-desk/next-deliveries"
            rows={queues.nextDeliveries.rows}
            total={queues.nextDeliveries.total}
            viewAllTo={`/ordre/ordrer?deliveryFrom=${today}&deliveryTo=${tom}`}
            isLoading={queues.nextDeliveries.isLoading}
            isError={queues.nextDeliveries.isError}
            error={queues.nextDeliveries.error}
            onRetry={queues.nextDeliveries.refetch}
            emptyText="Ingen leveringer registrert for perioden."
            maxRows={7}
          />
          <PendingRecurringCard
            date={pendingDate}
            onChangeDate={setPendingDate}
            rows={queues.automation.rows}
            total={queues.automation.total}
            isLoading={queues.automation.isLoading}
            isError={queues.automation.isError}
            error={queues.automation.error}
            onRetry={queues.automation.refetch}
          />
        </section>

        {/* E-post + pakksedler */}
        <section className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <TicketsInboxWidget />
          </div>
          <div className="xl:col-span-2">
            <DeliveryNoteStatusCard
              date={today}
              count={kpi.deliveryNotes.count}
              mainRunDone={kpi.deliveryNotes.mainRunDone}
              extraRuns={kpi.deliveryNotes.extraRuns}
              isLoading={kpi.deliveryNotes.isLoading}
              isError={kpi.deliveryNotes.isError}
            />
          </div>
        </section>
      </div>
    </>
  );
}

function DeliveryNoteStatusCard({
  date,
  count,
  mainRunDone,
  extraRuns,
  isLoading,
  isError,
}: {
  date: string;
  count: number;
  mainRunDone: boolean;
  extraRuns: number;
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Pakksedler i dag
        </CardTitle>
        <p className="mt-1 text-caption text-muted-foreground">{formatDateLong(date)}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <DeskSectionState
          isLoading={isLoading}
          isError={isError}
          scope="ordre-desk/delivery-notes"
          skeletonRows={2}
        >
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold leading-none text-foreground">{count}</span>
              <span className="text-caption text-muted-foreground">pakksedler produsert</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "text-[11px]",
                  mainRunDone
                    ? "border-[hsl(var(--alert-success))]/40 bg-[hsl(var(--alert-success))]/10 text-[hsl(var(--alert-success))]"
                    : "border-[hsl(var(--alert-warning))]/40 bg-[hsl(var(--alert-warning))]/10 text-[hsl(var(--alert-warning))]",
                )}
              >
                {mainRunDone ? "Hovedkjøring kjørt" : "Hovedkjøring ikke kjørt"}
              </Badge>
              {extraRuns > 0 && (
                <Badge variant="outline" className="text-[11px]">
                  {extraRuns} tilleggskjøring{extraRuns === 1 ? "" : "er"}
                </Badge>
              )}
            </div>
            <Button asChild variant="outline" size="sm" className="w-full gap-1">
              <Link to={`/ordre/pakksedler?date=${date}`}>
                Åpne pakksedler
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </DeskSectionState>
      </CardContent>
    </Card>
  );
}

function PendingRecurringCard({
  date,
  onChangeDate,
  rows,
  total,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  date: string;
  onChangeDate: (d: string) => void;
  rows: Array<{ id: string; to: string; primary: string; secondary?: string; badge?: string }>;
  total: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const today = todayISO();
  const tom = tomorrow();
  const dayAfter = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 2);
    return osloDateISO(d);
  })();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Velg dato for fastordre">
        <DateChip label="I dag" active={date === today} onClick={() => onChangeDate(today)} />
        <DateChip label="I morgen" active={date === tom} onClick={() => onChangeDate(tom)} />
        <DateChip
          label="Overmorgen"
          active={date === dayAfter}
          onClick={() => onChangeDate(dayAfter)}
        />
      </div>
      <WorkQueueCard
        title="Fastordre ikke kjørt"
        description={`Kunder som ennå ikke er regulert for ${formatDateLong(date)}.`}
        icon={Repeat}
        scope="ordre-desk/recurring"
        rows={rows}
        total={total}
        viewAllTo={`/ordre/faste-rutiner?date=${date}`}
        viewAllLabel="Åpne fastordre"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        emptyText={`Alle fastordrekunder er regulert for ${formatDateLong(date)}.`}
        maxRows={7}
      />
    </div>
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
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
