import { describe, it, expect } from "vitest";
import {
  correctionFromDate,
  isPausedForDate,
  isPendingOrder,
  isProductionScopeStatus,
  shiftIso,
  type DeliveryPauseLike,
  type PendingOrderLike,
} from "@/ordre/lib/pendingOrders";

const order = (over: Partial<PendingOrderLike> = {}): PendingOrderLike => ({
  id: "o1",
  customer_id: "c1",
  status: "confirmed",
  is_return: false,
  delivery_tour_id: "t1",
  delivery_date: "2026-09-10",
  ...over,
});

const pause = (over: Partial<DeliveryPauseLike> = {}): DeliveryPauseLike => ({
  customer_id: "c1",
  pause_from: "2026-09-01",
  pause_to: null,
  tour_filter: null,
  ...over,
});

describe("isProductionScopeStatus", () => {
  it("godtar produksjonsstatuser og avviser andre", () => {
    expect(isProductionScopeStatus("confirmed")).toBe(true);
    expect(isProductionScopeStatus("in_production")).toBe(true);
    expect(isProductionScopeStatus("packed")).toBe(true);
    expect(isProductionScopeStatus("awaiting_confirmation")).toBe(false);
    expect(isProductionScopeStatus(null)).toBe(false);
  });
});

describe("isPausedForDate", () => {
  it("åpen pause dekker alle datoer etter start", () => {
    expect(isPausedForDate([pause()], "c1", "2026-09-10", "t1")).toBe(true);
    expect(isPausedForDate([pause()], "c1", "2026-08-31", "t1")).toBe(false);
  });

  it("respekterer sluttdato", () => {
    const p = [pause({ pause_to: "2026-09-05" })];
    expect(isPausedForDate(p, "c1", "2026-09-05", "t1")).toBe(true);
    expect(isPausedForDate(p, "c1", "2026-09-06", "t1")).toBe(false);
  });

  it("respekterer tour_filter", () => {
    const p = [pause({ tour_filter: ["t2"] })];
    expect(isPausedForDate(p, "c1", "2026-09-10", "t1")).toBe(false);
    expect(isPausedForDate(p, "c1", "2026-09-10", "t2")).toBe(true);
    expect(isPausedForDate(p, "c1", "2026-09-10", null)).toBe(false);
  });

  it("gjelder kun riktig kunde", () => {
    expect(isPausedForDate([pause()], "c2", "2026-09-10", "t1")).toBe(false);
  });
});

describe("isPendingOrder", () => {
  const empty = new Set<string>();

  it("ordre i produksjonsscope uten pakkseddel er gjenstående", () => {
    expect(isPendingOrder(order(), empty, [])).toBe(true);
  });

  it("ekskluderer feil status, returer, pakkede og pausede", () => {
    expect(isPendingOrder(order({ status: "draft" }), empty, [])).toBe(false);
    expect(isPendingOrder(order({ is_return: true }), empty, [])).toBe(false);
    expect(isPendingOrder(order(), new Set(["o1"]), [])).toBe(false);
    expect(isPendingOrder(order(), empty, [pause()])).toBe(false);
  });

  it("pause på annen tur stopper ikke ordren", () => {
    expect(isPendingOrder(order(), empty, [pause({ tour_filter: ["t9"] })])).toBe(true);
  });
});

describe("datohjelpere", () => {
  it("shiftIso og correctionFromDate regner riktig", () => {
    expect(shiftIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(correctionFromDate("2026-03-02")).toBe("2026-01-01");
  });
});
