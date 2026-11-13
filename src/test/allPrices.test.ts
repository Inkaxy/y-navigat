import { describe, expect, it } from "vitest";
import { buildAllPrices, changePct, compareOldestFirst, defaultSince, median, registeredByLabel } from "@/ravarer/lib/allPrices";
import type { TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";

const row = (id: string, date: string, price: number, extra: Partial<TimelineHistoryRow> = {}): TimelineHistoryRow => ({
  id, effective_date: date, price, supplier_id: "s", source: "invoice", invoice_id: null, currency: "NOK", unit: "kg", createdAt: `${date}T08:00:00Z`, ...extra,
});

describe("Alle priser: sortering", () => {
  it("eldste først, så registreringstid, så id", () => {
    const rows = [row("c", "2026-03-01", 10), row("b", "2026-01-01", 10, { createdAt: "2026-01-01T09:00:00Z" }), row("a", "2026-01-01", 10)];
    expect([...rows].sort(compareOldestFirst).map((r) => r.id)).toEqual(["a", "b", "c"]);
    const out = buildAllPrices(rows, { since: null, currentUnit: "kg", thresholdPct: 3 });
    expect(out.rows.map((r) => r.row.id)).toEqual(["a", "b", "c"]);
  });
});

describe("Alle priser: endring i prosent", () => {
  it("regner mot forrige gyldige pris", () => {
    expect(changePct(100, 150)).toBe(50);
    expect(changePct(null, 10)).toBeNull();
    expect(changePct(0, 10)).toBeNull();
    const out = buildAllPrices([row("a", "2026-01-01", 100), row("k", "2026-01-15", 90, { isCredit: true }), row("b", "2026-02-01", 110)], { since: null, currentUnit: "kg", thresholdPct: 3 });
    expect(out.rows.map((r) => r.changePct)).toEqual([null, null, 10]);
    expect(out.rows[1].kindLabel).not.toBeNull();
  });
  it("første pris i perioden sammenlignes med siste pris før perioden", () => {
    const out = buildAllPrices([row("a", "2025-01-01", 100), row("b", "2026-02-01", 120)], { since: "2025-06-01", currentUnit: "kg", thresholdPct: 3 });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].changePct).toBe(20);
  });
});

describe("Alle priser: periodefilter", () => {
  it("standard er 12 måneder tilbake", () => {
    expect(defaultSince("2026-11-13")).toBe("2025-11-13");
    expect(defaultSince("2028-02-29")).toBe("2027-02-28");
  });
  it("tom dato gir alle priser uten nedre grense", () => {
    const rows = [row("a", "2019-01-01", 10), row("b", "2026-01-01", 10)];
    expect(buildAllPrices(rows, { since: null, currentUnit: "kg", thresholdPct: 3 }).rows).toHaveLength(2);
    expect(buildAllPrices(rows, { since: "2020-01-01", currentUnit: "kg", thresholdPct: 3 }).rows).toHaveLength(1);
  });
});

describe("Alle priser: avviksmerke", () => {
  const rows = [row("a", "2026-01-01", 100), row("b", "2026-02-01", 102), row("c", "2026-03-01", 101), row("d", "2026-04-01", 150)];
  it("merker priser mer enn grensen fra medianen", () => {
    expect(median([100, 102, 101, 150])).toBe(101.5);
    const out = buildAllPrices(rows, { since: null, currentUnit: "kg", thresholdPct: 3 });
    expect(out.rows.map((r) => r.deviation)).toEqual([false, false, false, true]);
  });
  it("akkurat på grensen er ikke avvik", () => {
    const out = buildAllPrices([row("a", "2026-01-01", 100), row("b", "2026-02-01", 100), row("c", "2026-03-01", 103)], { since: null, currentUnit: "kg", thresholdPct: 3 });
    expect(out.rows[2].deviation).toBe(false);
  });
  it("ukjent grense gir ingen merker", () => {
    expect(buildAllPrices(rows, { since: null, currentUnit: "kg", thresholdPct: null }).rows.every((r) => r.deviation === null)).toBe(true);
  });
  it("færre enn tre sammenlignbare priser gir ingen median", () => {
    const out = buildAllPrices(rows.slice(0, 2), { since: null, currentUnit: "kg", thresholdPct: 3 });
    expect(out.median).toBeNull();
    expect(out.rows.every((r) => r.deviation === null)).toBe(true);
  });
  it("annen enhet og utgåtte priser merkes aldri og teller ikke i medianen", () => {
    const out = buildAllPrices([...rows, row("x", "2026-05-01", 999, { unit: "stk" }), row("y", "2026-05-02", 999, { supersededAt: "2026-06-01" })], { since: null, currentUnit: "kg", thresholdPct: 3 });
    expect(out.validCount).toBe(4);
    expect(out.rows.slice(4).map((r) => r.deviation)).toEqual([null, null]);
  });
});

describe("Alle priser: registrert av", () => {
  const names = new Map([["u1", "Henrik"]]);
  it("viser bruker, automatikk eller manuell", () => {
    expect(registeredByLabel({ source: "invoice", createdBy: "u1" }, names)).toBe("Faktura · Henrik");
    expect(registeredByLabel({ source: "invoice", createdBy: null }, names)).toBe("Faktura · automatisk");
    expect(registeredByLabel({ source: "manual", createdBy: null }, names)).toBe("Manuell registrering");
    expect(registeredByLabel({ source: "recalc", createdBy: "u1" }, names)).toBe("Reberegning · Henrik");
  });
});
