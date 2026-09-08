import { describe, it, expect } from "vitest";
import {
  previousDay,
  requiredPriceForTarget,
  marginPct,
  writePriceForDate,
  writePriceBatch,
  type PricePersistence,
  type PriceRowRef,
} from "./priceWrite";

/** Enkel minne-implementasjon som logger kallene. */
function makeStore(initial: PriceRowRef | null) {
  const calls: string[] = [];
  let active = initial;
  const store: PricePersistence = {
    async findActive() {
      calls.push("findActive");
      return active;
    },
    async updatePrice(rowId, price) {
      calls.push(`update:${rowId}:${price}`);
    },
    async closePeriod(rowId, validTo) {
      calls.push(`close:${rowId}:${validTo}`);
      active = null;
    },
    async insertPeriod({ price, validFrom }) {
      calls.push(`insert:${price}:${validFrom}`);
      return "ny-rad";
    },
  };
  return { store, calls };
}

describe("previousDay", () => {
  it("går over månedsskifte", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });
});

describe("writePriceForDate", () => {
  it("lukker forrige periode dagen før og setter inn ny rad", async () => {
    const { store, calls } = makeStore({
      id: "gammel",
      price: 30,
      valid_from: "2026-01-01",
      valid_to: null,
    });
    const res = await writePriceForDate(store, {
      priceListId: "pl",
      productId: "p",
      price: 35,
      date: "2026-09-10",
    });
    expect(calls).toEqual(["findActive", "close:gammel:2026-09-09", "insert:35:2026-09-10"]);
    expect(res.action).toBe("insert");
    expect(res.closedRowId).toBe("gammel");
    expect(res.previousPrice).toBe(30);
  });

  it("oppdaterer raden når perioden starter samme dag", async () => {
    const { store, calls } = makeStore({
      id: "dagens",
      price: 30,
      valid_from: "2026-09-10",
      valid_to: null,
    });
    const res = await writePriceForDate(store, {
      priceListId: "pl",
      productId: "p",
      price: 35,
      date: "2026-09-10",
    });
    expect(calls).toEqual(["findActive", "update:dagens:35"]);
    expect(res.action).toBe("update");
    expect(res.closedRowId).toBeNull();
  });

  it("setter inn uten lukking når varen ikke har pris fra før", async () => {
    const { store, calls } = makeStore(null);
    const res = await writePriceForDate(store, {
      priceListId: "pl",
      productId: "p",
      price: 12.5,
      date: "2026-09-10",
    });
    expect(calls).toEqual(["findActive", "insert:12.5:2026-09-10"]);
    expect(res.previousPrice).toBeNull();
  });

  it("avviser ugyldig pris", async () => {
    const { store } = makeStore(null);
    await expect(
      writePriceForDate(store, { priceListId: "pl", productId: "p", price: NaN, date: "2026-09-10" }),
    ).rejects.toThrow("Ugyldig pris");
  });
});

describe("writePriceBatch", () => {
  it("lar én feil stå alene og lagrer resten", async () => {
    const store: PricePersistence = {
      async findActive(_pl, productId) {
        return productId === "gammel"
          ? { id: "r1", price: 10, valid_from: "2026-01-01", valid_to: null }
          : null;
      },
      async updatePrice() {},
      async closePeriod() {},
      async insertPeriod({ productId }) {
        if (productId === "feil") throw new Error("EXCLUDE-konflikt");
        return "ny";
      },
    };
    const res = await writePriceBatch(
      store,
      [
        { priceListId: "pl", productId: "gammel", price: 11, label: "Kneipp" },
        { priceListId: "pl", productId: "feil", price: 12, label: "Grovbrød" },
        { priceListId: "pl", productId: "ny", price: 13, label: "Rundstykke" },
      ],
      "2026-09-10",
    );
    expect(res.ok).toBe(2);
    expect(res.failed).toEqual([{ label: "Grovbrød", message: "EXCLUDE-konflikt" }]);
  });
});

describe("requiredPriceForTarget", () => {
  it("regner nødvendig pris fra kost og DG2-mål", () => {
    expect(requiredPriceForTarget(10, 50)).toBe(20);
    expect(requiredPriceForTarget(7.5, 40)).toBe(12.5);
  });

  it("returnerer null ved umulige eller manglende verdier", () => {
    expect(requiredPriceForTarget(10, 100)).toBeNull();
    expect(requiredPriceForTarget(null, 50)).toBeNull();
    expect(requiredPriceForTarget(10, null)).toBeNull();
  });
});

describe("marginPct", () => {
  it("regner DG2 i prosent av salgspris", () => {
    expect(marginPct(20, 10)).toBe(50);
    expect(marginPct(12.5, 7.5)).toBe(40);
  });

  it("returnerer null når prisen mangler eller er null", () => {
    expect(marginPct(0, 10)).toBeNull();
    expect(marginPct(null, 10)).toBeNull();
  });
});
