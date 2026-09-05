import { describe, it, expect } from "vitest";
import {
  excludePausedLines,
  ordersNewAfterRun,
  pickCompletedMainRun,
  productionStatusesForDate,
  runCompletedAt,
  sortSources,
  type RunLike,
} from "@/produksjon/features/produksjonsplan/lib/planSource";
import { productionRowKey } from "@/produksjon/features/produksjonsplan/hooks/useProductionPlanSnapshots";
import { DEFAULT_CRITERIA } from "@/produksjon/features/produksjonsplan/types";
import type { DeliveryPauseLike, PendingOrderLike } from "@/ordre/lib/pendingOrders";

const pause = (over: Partial<DeliveryPauseLike> = {}): DeliveryPauseLike => ({
  customer_id: "c1",
  pause_from: "2026-09-01",
  pause_to: null,
  tour_filter: null,
  ...over,
});

describe("productionStatusesForDate", () => {
  it("tar med delivered kun for passerte datoer", () => {
    expect(productionStatusesForDate("2026-09-10", "2026-09-10")).not.toContain("delivered");
    expect(productionStatusesForDate("2026-09-11", "2026-09-10")).not.toContain("delivered");
    expect(productionStatusesForDate("2026-09-09", "2026-09-10")).toContain("delivered");
  });

  it("inneholder alltid produksjonsscope", () => {
    const s = productionStatusesForDate("2026-09-10", "2026-09-10");
    expect(s).toEqual(expect.arrayContaining(["confirmed", "in_production", "packed"]));
    expect(s).not.toContain("awaiting_confirmation");
  });
});

describe("excludePausedLines", () => {
  const lines = [
    { customer_id: "c1", tour_id: "t1", n: 1 },
    { customer_id: "c2", tour_id: "t1", n: 2 },
  ];

  it("fjerner pauset kunde uten tour_filter", () => {
    expect(excludePausedLines(lines, [pause()], "2026-09-10").map((l) => l.n)).toEqual([2]);
  });

  it("respekterer tour_filter", () => {
    expect(excludePausedLines(lines, [pause({ tour_filter: ["t9"] })], "2026-09-10")).toHaveLength(2);
    expect(excludePausedLines(lines, [pause({ tour_filter: ["t1"] })], "2026-09-10").map((l) => l.n)).toEqual([2]);
  });

  it("respekterer sluttdato", () => {
    expect(excludePausedLines(lines, [pause({ pause_to: "2026-09-09" })], "2026-09-10")).toHaveLength(2);
  });
});

describe("pickCompletedMainRun", () => {
  const run = (over: Partial<RunLike> = {}): RunLike => ({
    id: "r1",
    completed_at: "2026-09-10T05:30:00Z",
    finished_at: null,
    tour_filter: null,
    notes_generated: 12,
    ...over,
  });
  const tourNumbers = new Map<string, number | null>([
    ["t1", 1],
    ["t2", 2],
  ]);

  it("kjøring uten turfilter dekker alt", () => {
    expect(pickCompletedMainRun([run()], [1], tourNumbers)?.id).toBe("r1");
    expect(pickCompletedMainRun([run()], [], tourNumbers)?.id).toBe("r1");
  });

  it("kjøring med turfilter må dekke valgte turer", () => {
    const r = run({ tour_filter: ["t1"] });
    expect(pickCompletedMainRun([r], [1], tourNumbers)?.id).toBe("r1");
    expect(pickCompletedMainRun([r], [1, 2], tourNumbers)).toBeNull();
    expect(pickCompletedMainRun([r], [], tourNumbers)).toBeNull();
  });

  it("ingen kjøring gir bestillingsgrunnlag", () => {
    expect(pickCompletedMainRun([], [], tourNumbers)).toBeNull();
  });

  it("faller tilbake til finished_at", () => {
    expect(runCompletedAt(run({ completed_at: null, finished_at: "2026-09-10T06:00:00Z" }))).toBe(
      "2026-09-10T06:00:00Z",
    );
  });
});

describe("ordersNewAfterRun", () => {
  const order = (over: Partial<PendingOrderLike> = {}): PendingOrderLike => ({
    id: "o1",
    customer_id: "c1",
    status: "confirmed",
    is_return: false,
    delivery_tour_id: "t1",
    delivery_date: "2026-09-10",
    ...over,
  });

  it("tar med ordre uten pakkseddel", () => {
    expect(ordersNewAfterRun([order()], new Set(), [])).toHaveLength(1);
  });

  it("utelater pakkede, returer og pausede", () => {
    expect(ordersNewAfterRun([order()], new Set(["o1"]), [])).toHaveLength(0);
    expect(ordersNewAfterRun([order({ is_return: true })], new Set(), [])).toHaveLength(0);
    expect(ordersNewAfterRun([order()], new Set(), [pause()])).toHaveLength(0);
  });
});

describe("productionRowKey", () => {
  it("er stabil uavhengig av grunnlag", () => {
    const criteria = { ...DEFAULT_CRITERIA };
    const fromNote = productionRowKey(null, "p1", criteria);
    const fromOrder = productionRowKey(null, "p1", criteria);
    expect(fromNote).toBe(fromOrder);
    expect(productionRowKey(1, "p1", { ...criteria, sum_tours: false })).not.toBe(fromNote);
  });
});

describe("sortSources", () => {
  it("sorterer i fast rekkefølge og fjerner duplikater", () => {
    expect(sortSources(["fastordre", "pakkseddel", "pakkseddel"])).toEqual([
      "pakkseddel",
      "fastordre",
    ]);
  });
});
