import { describe, expect, it } from "vitest";
import {
  aggregateExistingCells,
  ckey,
  computeDirtyChanges,
  computeTotals,
  effectiveCellQty,
  parseCellKey,
  visibleGhostQty,
} from "@/ordre/lib/matrixEdits";
import type { MatrixCell } from "@/ordre/hooks/useMatrix";

const TOUR = "11111111-1111-1111-1111-111111111111";
const DATE = "2026-03-02";
const P1 = "p1";

function cell(over: Partial<MatrixCell>): MatrixCell {
  return {
    order_id: "o1",
    order_number: "1001",
    order_status: "open",
    delivery_date: DATE,
    delivery_tour_id: TOUR,
    line_id: "l1",
    product_id: P1,
    quantity: 1,
    unit_price: 10,
    line_total_incl_vat: 11.5,
    merknad: null,
    ...over,
  } as MatrixCell;
}

const noOrders = () => false;
const noPause = () => false;

describe("parseCellKey", () => {
  it("splitter dato, tur og produkt", () => {
    expect(parseCellKey(ckey(DATE, TOUR, P1))).toEqual({
      date: DATE,
      tourId: TOUR,
      productId: P1,
    });
  });

  it("takler tom tur-id", () => {
    expect(parseCellKey(`${DATE}||${P1}`).tourId).toBe("");
  });
});

describe("aggregateExistingCells", () => {
  it("summerer flere ordre på samme dato|tur|produkt og beholder alle ordre-id-er", () => {
    const idx = aggregateExistingCells([
      cell({ order_id: "o1", quantity: 2 }),
      cell({ order_id: "o2", order_number: "1002", line_id: "l2", quantity: 3 }),
    ]);
    const key = ckey(DATE, TOUR, P1);
    expect(idx.qty[key]).toBe(5);
    expect(idx.orderIds[key]).toEqual(["o1", "o2"]);
    expect(idx.colOrderId.get(`${DATE}|${TOUR}`)).toBe("o1");
  });

  it("legger linjer uten tur i egen bøtte, ikke i rutenettet", () => {
    const idx = aggregateExistingCells([
      cell({ delivery_tour_id: null, quantity: 4, order_id: "o9", order_number: "1009" }),
    ]);
    expect(Object.keys(idx.qty)).toHaveLength(0);
    const entry = idx.noTour.get(`${DATE}|${P1}`);
    expect(entry?.quantity).toBe(4);
    expect(entry?.orderIds).toEqual(["o9"]);
    expect(entry?.orderNumbers).toEqual(["1009"]);
  });

  it("flagger celler med pris 0", () => {
    const idx = aggregateExistingCells([cell({ unit_price: 0, quantity: 2 })]);
    expect(idx.fallback[ckey(DATE, TOUR, P1)]).toBe(true);
  });
});

describe("visibleGhostQty", () => {
  const key = ckey(DATE, TOUR, P1);
  const ghostMap = new Map([[key, 6]]);

  it("viser fastordre når kolonnen er tom", () => {
    expect(
      visibleGhostQty({
        key,
        edits: {},
        existingQty: {},
        ghostMap,
        hasColumnOrder: noOrders,
        isPausedCol: noPause,
      }),
    ).toBe(6);
  });

  it("skjuler fastordre når kolonnen har ordre eller pause, eller cellen er redigert", () => {
    const base = { key, edits: {}, existingQty: {}, ghostMap, isPausedCol: noPause };
    expect(visibleGhostQty({ ...base, hasColumnOrder: () => true })).toBe(0);
    expect(
      visibleGhostQty({ ...base, hasColumnOrder: noOrders, isPausedCol: () => true }),
    ).toBe(0);
    expect(
      visibleGhostQty({ ...base, edits: { [key]: "2" }, hasColumnOrder: noOrders }),
    ).toBe(0);
    expect(
      visibleGhostQty({ ...base, existingQty: { [key]: 3 }, hasColumnOrder: noOrders }),
    ).toBe(0);
  });

  it("gir aldri fastordre uten tur-id", () => {
    const k = `${DATE}||${P1}`;
    expect(
      visibleGhostQty({
        key: k,
        edits: {},
        existingQty: {},
        ghostMap: new Map([[k, 5]]),
        hasColumnOrder: noOrders,
        isPausedCol: noPause,
      }),
    ).toBe(0);
  });
});

describe("effectiveCellQty", () => {
  const key = ckey(DATE, TOUR, P1);
  it("prioriterer endring → lagret → fastordre", () => {
    const base = {
      key,
      ghostMap: new Map([[key, 6]]),
      hasColumnOrder: noOrders,
      isPausedCol: noPause,
    };
    expect(effectiveCellQty({ ...base, edits: { [key]: "9" }, existingQty: { [key]: 4 } })).toBe(9);
    expect(effectiveCellQty({ ...base, edits: {}, existingQty: { [key]: 4 } })).toBe(4);
    expect(effectiveCellQty({ ...base, edits: {}, existingQty: {} })).toBe(6);
  });
});

describe("computeDirtyChanges", () => {
  it("tar med kun faktiske endringer og aldri tom tur-id", () => {
    const key = ckey(DATE, TOUR, P1);
    const changes = computeDirtyChanges(
      { [key]: "5", [ckey(DATE, TOUR, "p2")]: "2", [`${DATE}||p3`]: "7" },
      { [key]: 5 },
    );
    expect(changes).toEqual([
      { date: DATE, tour_id: TOUR, product_id: "p2", quantity: 2 },
    ]);
  });
});

describe("computeTotals", () => {
  const key = ckey(DATE, TOUR, P1);
  const products = [{ id: P1, unit_price: 10 }];
  const columns = [{ date: DATE, tourId: TOUR }];

  it("teller med synlige fastordre-tall", () => {
    const t = computeTotals({
      products,
      columns,
      edits: {},
      existingQty: {},
      ghostMap: new Map([[key, 3]]),
      hasColumnOrder: noOrders,
      isPausedCol: noPause,
    });
    expect(t.grand).toBe(30);
    expect(t.colTotals[`${DATE}|${TOUR}`]).toBe(30);
  });

  it("teller ikke skjulte fastordre-tall (kolonnen har ordre)", () => {
    const t = computeTotals({
      products,
      columns,
      edits: {},
      existingQty: {},
      ghostMap: new Map([[key, 3]]),
      hasColumnOrder: () => true,
      isPausedCol: noPause,
    });
    expect(t.grand).toBe(0);
  });

  it("teller ikke fastordre ved leveransepause", () => {
    const t = computeTotals({
      products,
      columns,
      edits: {},
      existingQty: {},
      ghostMap: new Map([[key, 3]]),
      hasColumnOrder: noOrders,
      isPausedCol: () => true,
    });
    expect(t.grand).toBe(0);
  });

  it("bruker summert antall fra flere ordre", () => {
    const idx = aggregateExistingCells([
      cell({ quantity: 2 }),
      cell({ order_id: "o2", line_id: "l2", quantity: 3 }),
    ]);
    const t = computeTotals({
      products,
      columns,
      edits: {},
      existingQty: idx.qty,
      ghostMap: undefined,
      hasColumnOrder: () => true,
      isPausedCol: noPause,
    });
    expect(t.grand).toBe(50);
  });
});
