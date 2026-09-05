import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { useTicketCounts, type TicketQueueRow } from "@/ordre/hooks/useTickets";
import { useAcceptanceQueueCount } from "@/ordre/hooks/useAcceptanceQueueCount";
import { useDeliveryDayStats, useOrderList, type OrderListRow } from "@/ordre/hooks/useOrders";
import { useDeliveryDayStatus } from "@/ordre/hooks/useDeliveryDayStatus";
import { usePendingRecurringOrderRows } from "@/ordre/hooks/usePendingRecurringOrders";
import { formatRelative, todayISO, tomorrow } from "@/ordre/lib/format";

/** Én rad i en arbeidskø på ordrekontorets arbeidsbord. */
export type DeskRow = {
  id: string;
  to: string;
  primary: string;
  secondary?: string;
  badge?: string;
  meta?: string;
  tone?: "critical" | "warning" | "info" | "default";
};

/**
 * En navngitt gruppe rader inne i ett kø-kort.
 *
 * Bakgrunn: «Må håndteres nå» blander to ulike kilder (ordre til godkjenning og
 * e-post). Da må hver kilde ha sin egen overskrift og sin egen «vis alle»-lenke,
 * slik at ingen lenke lover å vise alt og deretter utelater halvparten.
 */
export type DeskGroup = {
  key: string;
  label: string;
  rows: DeskRow[];
  /** Totalt antall i gruppen — kan være større enn `rows.length`. */
  total: number;
  to: string;
  toLabel: string;
  emptyText: string;
};

type PendingRecurringRow = {
  schedule_id: string;
  customer_id: string;
  customer_display_name: string;
  customer_number: string | null;
  tour_label: string | null;
};

/* ------------------------------------------------------------------ */
/* Rene transformasjoner (testes isolert)                              */
/* ------------------------------------------------------------------ */

/** Tickets som krever handling nå: nye, haste/høy prioritet eller uten ansvarlig. */
export function selectTicketsNeedingAction(tickets: TicketQueueRow[]): TicketQueueRow[] {
  const needs = tickets.filter(
    (t) =>
      t.status === "new" ||
      t.priority === "urgent" ||
      t.priority === "high" ||
      t.assigned_to == null,
  );
  const rank = (t: TicketQueueRow) =>
    (t.priority === "urgent" ? 0 : t.priority === "high" ? 1 : 2) * 10 +
    (t.status === "new" ? 0 : 1) * 2 +
    (t.assigned_to == null ? 0 : 1);
  return needs
    .slice()
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        new Date(b.received_at).getTime() - new Date(a.received_at).getTime(),
    );
}

export function ticketsToDeskRows(tickets: TicketQueueRow[]): DeskRow[] {
  return tickets.map((t) => ({
    id: `ticket-${t.id}`,
    to: `/ordre/ticket/${t.id}`,
    primary: t.subject?.trim() || "(uten emne)",
    secondary: t.sender_name?.trim() || t.sender_email,
    badge:
      t.priority === "urgent"
        ? "Haster"
        : t.priority === "high"
          ? "Høy"
          : t.assigned_to == null
            ? "Uten ansvarlig"
            : t.status === "new"
              ? "Ny"
              : undefined,
    tone:
      t.priority === "urgent"
        ? "critical"
        : t.priority === "high"
          ? "warning"
          : t.assigned_to == null
            ? "warning"
            : "info",
    meta: formatRelative(t.received_at),
  }));
}

export function ordersToDeskRows(
  rows: OrderListRow[],
  opts: { badge?: (row: OrderListRow) => string | undefined } = {},
): DeskRow[] {
  return rows.map((o) => ({
    id: `order-${o.id}`,
    to: `/ordre/ordrer/${o.id}`,
    primary: o.customer_snapshot?.display_name ?? `Ordre ${o.order_number}`,
    secondary: `${o.order_number}${o.customer_snapshot?.customer_number ? ` · #${o.customer_snapshot.customer_number}` : ""}`,
    badge: opts.badge?.(o),
    tone: o.delivery_tour_id ? "default" : "warning",
    meta: o.delivery_date,
  }));
}

export function recurringToDeskRows(rows: PendingRecurringRow[], date: string): DeskRow[] {
  return rows.map((r) => ({
    id: `recurring-${r.schedule_id}`,
    to: `/ordre/faste-rutiner?date=${date}`,
    primary: r.customer_display_name,
    secondary: r.customer_number ? `#${r.customer_number}` : undefined,
    badge: r.tour_label ?? undefined,
    tone: "warning",
  }));
}

/** Maks antall faktiske arbeidsrader per gruppe i «Må håndteres nå». */
export const MUST_HANDLE_ROWS_PER_GROUP = 4;

/**
 * Bygger de to gruppene i «Må håndteres nå».
 *
 * Hver gruppe beholder sin egen destinasjon slik at «Godkjenningskø» og
 * «Åpne innboks» peker der radene faktisk finnes.
 */
export function buildMustHandleGroups(input: {
  approvalRows: OrderListRow[];
  approvalTotal: number;
  tickets: TicketQueueRow[];
  maxPerGroup?: number;
}): DeskGroup[] {
  const maxPerGroup = input.maxPerGroup ?? MUST_HANDLE_ROWS_PER_GROUP;
  const approvals = ordersToDeskRows(input.approvalRows, {
    badge: () => "Venter godkjenning",
  }).map((r) => ({ ...r, tone: "critical" as const }));
  const ticketRows = ticketsToDeskRows(input.tickets);

  return [
    {
      key: "approvals",
      label: "Ordre til godkjenning",
      rows: approvals.slice(0, maxPerGroup),
      total: Math.max(input.approvalTotal, approvals.length),
      to: "/ordre/ordrer?status=awaiting_confirmation",
      toLabel: "Godkjenningskø",
      emptyText: "Ingen ordre venter på godkjenning.",
    },
    {
      key: "tickets",
      label: "E-post som krever handling",
      rows: ticketRows.slice(0, maxPerGroup),
      total: ticketRows.length,
      to: "/ordre/ticket",
      toLabel: "Åpne innboks",
      emptyText: "Ingen e-post krever handling nå.",
    },
  ];
}

/** Summen av faktiske oppgaver på tvers av gruppene. */
export function totalOfGroups(groups: DeskGroup[]): number {
  return groups.reduce((sum, g) => sum + g.total, 0);
}

/* ------------------------------------------------------------------ */
/* Datakilder                                                          */
/* ------------------------------------------------------------------ */

/** Nettbutikkordre som venter på behandling (samme statuser som `/ordre/nettbutikk`). */
export const WEBSITE_PENDING_STATUSES = ["received", "partially_approved"] as const;

export function usePendingWebsiteOrdersCount() {
  return useQuery({
    queryKey: ["website-orders", "pending-count"],
    staleTime: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("website_orders")
        .select("id", { count: "exact", head: true })
        .in("status", WEBSITE_PENDING_STATUSES as unknown as string[]);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/**
 * Komponerer eksisterende Ordre-queries til ett arbeidsbord.
 *
 * Hver del beholder sin egen query key og rapporterer egen laste-/feilstatus,
 * slik at én feilende kilde ikke skjuler resten av arbeidsbordet.
 * Ingen faglogikk dupliseres her — kun utvalg, sortering og presentasjon.
 */
export function useOrderDeskBoard(options: { pendingDate?: string } = {}) {
  const today = todayISO();
  const tom = tomorrow();
  const pendingDate = options.pendingDate ?? tom;

  const ticketsQ = useTicketCounts();
  const approvalCountQ = useAcceptanceQueueCount();
  const approvalRowsQ = useOrderList({
    statuses: ["awaiting_confirmation"],
    pageSize: 8,
  });
  const todayStatsQ = useDeliveryDayStats(today);
  const tomorrowStatsQ = useDeliveryDayStats(tom);
  const dayStatusQ = useDeliveryDayStatus(NB_LEGAL_ENTITY_ID, today);
  const upcomingQ = useOrderList({
    deliveryFrom: today,
    deliveryTo: tom,
    pageSize: 8,
  });
  const recurringQ = usePendingRecurringOrderRows(pendingDate, "all");
  const websiteQ = usePendingWebsiteOrdersCount();

  // Kun refetch-funksjonene (stabile referanser fra React Query) er avhengigheter,
  // ikke hele query-resultatene — de bytter identitet ved hver render.
  const refetchTickets = ticketsQ.refetch;
  const refetchApprovalCount = approvalCountQ.refetch;
  const refetchApprovalRows = approvalRowsQ.refetch;
  const refetchTodayStats = todayStatsQ.refetch;
  const refetchTomorrowStats = tomorrowStatsQ.refetch;
  const refetchDayStatus = dayStatusQ.refetch;
  const refetchUpcoming = upcomingQ.refetch;
  const refetchRecurring = recurringQ.refetch;
  const refetchWebsite = websiteQ.refetch;

  const refetchMustHandle = useCallback(() => {
    void refetchTickets();
    void refetchApprovalRows();
    void refetchApprovalCount();
  }, [refetchTickets, refetchApprovalRows, refetchApprovalCount]);

  const refetchNextDeliveries = useCallback(() => {
    void refetchUpcoming();
  }, [refetchUpcoming]);

  const refetchRecurringRows = useCallback(() => {
    void refetchRecurring();
  }, [refetchRecurring]);

  const refetchWebsiteCount = useCallback(() => {
    void refetchWebsite();
  }, [refetchWebsite]);

  const refetchDeliveryNotes = useCallback(() => {
    void refetchDayStatus();
  }, [refetchDayStatus]);

  const refetchAll = useCallback(() => {
    void refetchTickets();
    void refetchApprovalCount();
    void refetchApprovalRows();
    void refetchTodayStats();
    void refetchTomorrowStats();
    void refetchDayStatus();
    void refetchUpcoming();
    void refetchRecurring();
    void refetchWebsite();
  }, [
    refetchTickets,
    refetchApprovalCount,
    refetchApprovalRows,
    refetchTodayStats,
    refetchTomorrowStats,
    refetchDayStatus,
    refetchUpcoming,
    refetchRecurring,
    refetchWebsite,
  ]);

  const openTickets = ticketsQ.data?.openTickets ?? [];
  const actionTickets = selectTicketsNeedingAction(openTickets);
  const approvalRows = approvalRowsQ.data?.rows ?? [];
  const upcomingRows = upcomingQ.data?.rows ?? [];
  const recurringRows = (recurringQ.data ?? []) as PendingRecurringRow[];

  const mustHandleGroups = buildMustHandleGroups({
    approvalRows,
    approvalTotal: approvalCountQ.data ?? approvalRows.length,
    tickets: actionTickets,
  });

  return {
    dates: { today, tomorrow: tom, pendingDate },

    kpi: {
      tickets: {
        newCount: ticketsQ.data?.newCount ?? 0,
        openCount: (ticketsQ.data?.newCount ?? 0) + (ticketsQ.data?.inProgressCount ?? 0),
        mineCount: ticketsQ.data?.mineCount ?? 0,
        unassignedCount: ticketsQ.data?.unassignedCount ?? 0,
        nowCount: ticketsQ.data?.nowCount ?? 0,
        isLoading: ticketsQ.isLoading,
        isError: ticketsQ.isError,
        error: ticketsQ.error,
      },
      approvals: {
        count: approvalCountQ.data ?? 0,
        isLoading: approvalCountQ.isLoading,
        isError: approvalCountQ.isError,
        error: approvalCountQ.error,
      },
      today: {
        count: todayStatsQ.data?.count ?? 0,
        total: todayStatsQ.data?.total ?? 0,
        isLoading: todayStatsQ.isLoading,
        isError: todayStatsQ.isError,
        error: todayStatsQ.error,
      },
      tomorrow: {
        count: tomorrowStatsQ.data?.count ?? 0,
        total: tomorrowStatsQ.data?.total ?? 0,
        isLoading: tomorrowStatsQ.isLoading,
        isError: tomorrowStatsQ.isError,
        error: tomorrowStatsQ.error,
      },
      recurring: {
        count: recurringRows.length,
        isLoading: recurringQ.isLoading,
        isError: recurringQ.isError,
        error: recurringQ.error,
      },
      withoutTour: {
        count: dayStatusQ.data?.tellere.uten_tur ?? 0,
        isLoading: dayStatusQ.isLoading,
        isError: dayStatusQ.isError,
        error: dayStatusQ.error,
      },
      website: {
        count: websiteQ.data ?? 0,
        isLoading: websiteQ.isLoading,
        isError: websiteQ.isError,
        error: websiteQ.error,
      },
    },

    queues: {
      mustHandle: {
        groups: mustHandleGroups,
        total: totalOfGroups(mustHandleGroups),
        isLoading: ticketsQ.isLoading || approvalRowsQ.isLoading,
        isError: ticketsQ.isError || approvalRowsQ.isError,
        error: ticketsQ.error ?? approvalRowsQ.error,
        refetch: refetchMustHandle,
      },
      nextDeliveries: {
        rows: ordersToDeskRows(upcomingRows, {
          badge: (o) => (o.delivery_tour_id ? undefined : "Uten tur"),
        }),
        total: upcomingQ.data?.total ?? upcomingRows.length,
        isLoading: upcomingQ.isLoading,
        isError: upcomingQ.isError,
        error: upcomingQ.error,
        refetch: refetchNextDeliveries,
      },
      /**
       * «Automatiske løp» dekker alle tre maskinelle kildene ordrekontoret må
       * følge opp hver dag: fastordre, nettbutikkordre og pakkseddelkjøringen.
       */
      automation: {
        recurring: {
          rows: recurringToDeskRows(recurringRows, pendingDate),
          total: recurringRows.length,
          to: `/ordre/faste-rutiner?date=${pendingDate}`,
          isLoading: recurringQ.isLoading,
          isError: recurringQ.isError,
          error: recurringQ.error,
          refetch: refetchRecurringRows,
        },
        website: {
          count: websiteQ.data ?? 0,
          to: "/ordre/nettbutikk",
          isLoading: websiteQ.isLoading,
          isError: websiteQ.isError,
          error: websiteQ.error,
          refetch: refetchWebsiteCount,
        },
        deliveryNotes: {
          count: dayStatusQ.data?.tellere.pakksedler ?? 0,
          mainRunDone: dayStatusQ.data?.hovedkjoring?.kjort ?? false,
          extraRuns: dayStatusQ.data?.tilleggskjoringer ?? 0,
          to: `/ordre/pakksedler?date=${today}`,
          isLoading: dayStatusQ.isLoading,
          isError: dayStatusQ.isError,
          error: dayStatusQ.error,
          refetch: refetchDeliveryNotes,
        },
      },
    },

    isFetching:
      ticketsQ.isFetching ||
      upcomingQ.isFetching ||
      approvalRowsQ.isFetching ||
      recurringQ.isFetching ||
      websiteQ.isFetching ||
      dayStatusQ.isFetching,
    dataUpdatedAt: Math.max(
      ticketsQ.dataUpdatedAt ?? 0,
      upcomingQ.dataUpdatedAt ?? 0,
      approvalRowsQ.dataUpdatedAt ?? 0,
      recurringQ.dataUpdatedAt ?? 0,
      websiteQ.dataUpdatedAt ?? 0,
      dayStatusQ.dataUpdatedAt ?? 0,
    ),
    refetchAll,
  };
}
