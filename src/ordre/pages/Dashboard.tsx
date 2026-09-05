import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus,
  TruckIcon,
  Mail,
  CalendarClock,
  AlertCircle,
  CheckCircle2,
  Globe,
  MapPinOff,
  UserSquare,
  Repeat,
} from "lucide-react";
import { TicketsInboxWidget } from "@/ordre/components/shell/TicketsInboxWidget";
import { AppBanner } from "@/ordre/components/shell/AppBanner";
import { Button } from "@/components/ui/button";
import { OrderDeskKpi, OrderDeskSplitKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import { OrderDeskHeader } from "@/ordre/components/dashboard/OrderDeskHeader";
import { DeskFocusNotice } from "@/ordre/components/dashboard/DeskFocusNotice";
import { WorkQueueCard } from "@/ordre/components/dashboard/WorkQueueCard";
import { AutomationRunsCard } from "@/ordre/components/dashboard/AutomationRunsCard";
import { useOrderDeskBoard, type DeskGroup } from "@/ordre/hooks/useOrderDeskBoard";
import { formatNOK, todayISO, tomorrow, formatDateLong } from "@/ordre/lib/format";
import { osloDateISO } from "@/lib/osloDate";

/** Maks antall leveringsrader i «Neste leveringer» — kortet er en arbeidskø, ikke en liste. */
const NEXT_DELIVERIES_MAX_ROWS = 6;

export default function Dashboard() {
  const today = todayISO();
  const tom = tomorrow();
  const [pendingDate, setPendingDate] = useState<string>(tom);
  const [searchParams, setSearchParams] = useSearchParams();

  const board = useOrderDeskBoard({ pendingDate });
  const { kpi, queues } = board;

  /** Bokmerker til den nedlagte `/ordre/avvik` lander her med `?focus=avvik`. */
  const showFocusNotice = searchParams.get("focus") === "avvik";
  const dismissFocusNotice = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const dayAfter = useMemo(() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 2);
    return osloDateISO(d);
  }, [today]);

  /** «Neste leveringer» har bare én kilde — pakkes som én navnløs gruppe. */
  const nextDeliveryGroups: DeskGroup[] = [
    {
      key: "next-deliveries",
      label: "Neste leveringer",
      rows: queues.nextDeliveries.rows.slice(0, NEXT_DELIVERIES_MAX_ROWS),
      total: queues.nextDeliveries.total,
      to: `/ordre/ordrer?deliveryFrom=${today}&deliveryTo=${tom}`,
      toLabel: "Vis alle",
      emptyText: "Ingen leveringer registrert for perioden.",
    },
  ];

  return (
    <>
      <AppBanner
        actions={
          <Button asChild size="sm" className="gap-2">
            <Link to="/ordre/ordrer/ny">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Ny ordre
            </Link>
          </Button>
        }
      />
      <div className="container mx-auto space-y-6 px-page py-6 sm:px-page">
        <h1 className="sr-only">Ordrekontoret — arbeidsbord</h1>

        <OrderDeskHeader
          date={new Date()}
          dataUpdatedAt={board.dataUpdatedAt}
          isFetching={board.isFetching}
          onRefresh={board.refetchAll}
        />

        {showFocusNotice && <DeskFocusNotice onDismiss={dismissFocusNotice} />}



        {/* KPI-strip: hele driftsbildet på én linje */}
        <section
          aria-label="Nøkkeltall"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8"
        >
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
            to="/ordre/ticket?queue=new"
          />
          <OrderDeskSplitKpi
            label="Ansvar e-post"
            icon={UserSquare}
            loading={kpi.tickets.isLoading}
            failed={kpi.tickets.isError}
            left={{
              label: "Mine",
              value: kpi.tickets.mineCount,
              to: "/ordre/ticket?queue=mine",
              tone: "default",
            }}
            right={{
              label: "Uten ansvarlig",
              value: kpi.tickets.unassignedCount,
              to: "/ordre/ticket?queue=unassigned",
              tone: kpi.tickets.unassignedCount > 0 ? "warning" : "ok",
            }}
          />
          <OrderDeskKpi
            label="Over frist"
            value={kpi.tickets.nowCount}
            sub="e-post må tas nå"
            icon={Mail}
            tone={kpi.tickets.nowCount > 0 ? "critical" : "ok"}
            loading={kpi.tickets.isLoading}
            failed={kpi.tickets.isError}
            to="/ordre/ticket?queue=now"
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
            description="Ordre til godkjenning og e-post som haster eller mangler ansvarlig."
            icon={AlertCircle}
            scope="ordre-desk/must-handle"
            groups={queues.mustHandle.groups}
            isLoading={queues.mustHandle.isLoading}
            isError={queues.mustHandle.isError}
            error={queues.mustHandle.error}
            onRetry={queues.mustHandle.refetch}
            emptyText="Ingenting haster akkurat nå."
          />
          <WorkQueueCard
            title="Neste leveringer"
            description={`Ordre med levering ${formatDateLong(today)} – ${formatDateLong(tom)}.`}
            icon={TruckIcon}
            scope="ordre-desk/next-deliveries"
            groups={nextDeliveryGroups}
            hideGroupLabels
            isLoading={queues.nextDeliveries.isLoading}
            isError={queues.nextDeliveries.isError}
            error={queues.nextDeliveries.error}
            onRetry={queues.nextDeliveries.refetch}
            emptyText="Ingen leveringer registrert for perioden."
          />
          <AutomationRunsCard
            recurringDate={pendingDate}
            onChangeRecurringDate={setPendingDate}
            dates={{ today, tomorrow: tom, dayAfter }}
            recurring={queues.automation.recurring}
            website={queues.automation.website}
            deliveryNotes={queues.automation.deliveryNotes}
          />
        </section>

        {/* Innboks */}
        <section aria-label="Innboks">
          <TicketsInboxWidget />
        </section>
      </div>
    </>
  );
}
