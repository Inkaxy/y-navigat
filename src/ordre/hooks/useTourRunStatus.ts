import { useMemo } from "react";
import { useDeliveryTours, type DeliveryTour } from "@/hooks/useDeliveryTours";
import { useTourOrderCounts } from "@/hooks/useDeliveryTours";
import { useCompletedMainRuns, type CompletedMainRun } from "@/hooks/useCompletedRuns";
import { NB_LEGAL_ENTITY_ID } from "@/lib/constants";

/** Pseudo-tur-ID for ordre med delivery_tour_id IS NULL. */
export const NULL_TOUR_KEY = "__null__";

export type TourStatus = "no_orders" | "completed" | "pending";

export type TourStatusRow = {
  /** uuid for ekte tur, eller NULL_TOUR_KEY for "Uten tur". */
  id: string;
  display_name: string;
  tour_number: number | null;
  order_count: number;
  status: TourStatus;
  /** True hvis dette er pseudo-raden "Uten tur". */
  isNullTour: boolean;
};

function isTourCovered(tourId: string | null, runs: CompletedMainRun[]): boolean {
  // tourId === null → "Uten tur"-pseudoraden. Den dekkes av enhver run uten filter.
  for (const r of runs) {
    if (!r.tour_filter || r.tour_filter.length === 0) return true;
    if (tourId !== null && r.tour_filter.includes(tourId)) return true;
  }
  return false;
}

export type TourRunStatusResult = {
  rows: TourStatusRow[];
  /** Kun rader som har ordre (order_count > 0), ekskl. "Ingen ordre". */
  rowsWithOrders: TourStatusRow[];
  pendingRows: TourStatusRow[];
  completedRows: TourStatusRow[];
  totalOrders: number;
  isLoading: boolean;
};

/**
 * Beregner per-tur-status (Kjørt / Gjenstår / Ingen ordre) for valgt dato.
 * Inkluderer pseudo-raden "Uten tur" for ordre med delivery_tour_id IS NULL.
 */
export function useTourRunStatus(isoDate: string): TourRunStatusResult {
  const toursQ = useDeliveryTours({ activeOnly: true });
  const countsQ = useTourOrderCounts(isoDate);
  const runsQ = useCompletedMainRuns(NB_LEGAL_ENTITY_ID, isoDate);

  const tours = toursQ.data ?? [];
  const counts = countsQ.data;
  const runs = runsQ.data ?? [];

  const result = useMemo<TourRunStatusResult>(() => {
    const byTour = counts?.byTour ?? {};
    const nullTourCount = counts?.nullTourCount ?? 0;

    const tourRows: TourStatusRow[] = tours
      .slice()
      .sort((a, b) => {
        const pa = (a as DeliveryTour & { priority?: number }).priority ?? 1;
        const pb = (b as DeliveryTour & { priority?: number }).priority ?? 1;
        if (pa !== pb) return pa - pb;
        return a.display_name.localeCompare(b.display_name, "nb");
      })
      .map((t: DeliveryTour) => {
        const orderCount = byTour[t.id] ?? 0;
        let status: TourStatus;
        if (orderCount === 0) status = "no_orders";
        else status = isTourCovered(t.id, runs) ? "completed" : "pending";
        return {
          id: t.id,
          display_name: t.display_name,
          tour_number: t.tour_number,
          order_count: orderCount,
          status,
          isNullTour: false,
        };
      });

    const nullRow: TourStatusRow = {
      id: NULL_TOUR_KEY,
      display_name: "Uten tur",
      tour_number: null,
      order_count: nullTourCount,
      status:
        nullTourCount === 0
          ? "no_orders"
          : isTourCovered(null, runs)
            ? "completed"
            : "pending",
      isNullTour: true,
    };

    const rows = [...tourRows, nullRow];
    const rowsWithOrders = rows.filter((r) => r.order_count > 0);
    const pendingRows = rowsWithOrders.filter((r) => r.status === "pending");
    const completedRows = rowsWithOrders.filter((r) => r.status === "completed");
    const totalOrders = rowsWithOrders.reduce((acc, r) => acc + r.order_count, 0);

    return {
      rows,
      rowsWithOrders,
      pendingRows,
      completedRows,
      totalOrders,
      isLoading: toursQ.isLoading || countsQ.isLoading || runsQ.isLoading,
    };
  }, [tours, counts, runs, toursQ.isLoading, countsQ.isLoading, runsQ.isLoading]);

  return result;
}
