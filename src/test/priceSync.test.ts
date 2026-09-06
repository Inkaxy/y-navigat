import { describe, it, expect } from "vitest";
import {
  syncRegisteredPrices,
  learnPendingAliases,
  type AnyRec,
} from "../../supabase/functions/_shared/priceSync";

interface Call {
  table: string;
  op: string;
  payload: AnyRec;
}

/** Minimal supabase-klient som bare noterer hva som ville blitt skrevet. */
function mockClient() {
  const calls: Call[] = [];
  const chain = (table: string, op: string, payload: AnyRec) => {
    calls.push({ table, op, payload });
    const self = {
      eq: () => Promise.resolve({ error: null }),
      then: (r: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(r),
    };
    return self;
  };
  return {
    calls,
    from(table: string) {
      return {
        update: (payload: AnyRec) => chain(table, "update", payload),
        upsert: (payload: AnyRec) => chain(table, "upsert", payload),
        insert: (payload: AnyRec) => chain(table, "insert", payload),
      };
    },
  };
}

const rm: AnyRec = { id: "rm1", current_cost_price: 100, price_updated_at: "2026-01-01", primary_supplier_id: "s1" };
const rmsRow: AnyRec = { id: "rms1", agreed_price_per_base_unit: 100, last_invoice_date: "2026-01-01" };
const line: AnyRec = { supplier_sku: "A-1", description: "Hvetemel 25 kg" };
const baseInv: AnyRec = { id: "inv1", supplier_id: "s1", invoice_date: "2026-02-01", currency: "NOK", is_credit_note: false };

describe("syncRegisteredPrices", () => {
  it("skriver registrert pris når alt er i orden", async () => {
    const svc = mockClient();
    const update: AnyRec = { requires_review: false, review_reason: null };
    await syncRegisteredPrices(svc, baseInv, line, rm, rmsRow, 100, update, 2);
    expect(svc.calls.map((c) => c.table)).toContain("raw_material_suppliers");
    expect(svc.calls.map((c) => c.table)).toContain("raw_materials");
    expect(update.requires_review).toBe(false);
  });

  it("skriver aldri fra en kreditnota", async () => {
    const svc = mockClient();
    const update: AnyRec = { requires_review: false, review_reason: null };
    await syncRegisteredPrices(svc, { ...baseInv, is_credit_note: true }, line, rm, rmsRow, 100, update, 2);
    expect(svc.calls).toHaveLength(0);
  });

  it("flagger valuta som ikke støttes", async () => {
    const svc = mockClient();
    const update: AnyRec = { requires_review: false, review_reason: null };
    await syncRegisteredPrices(svc, { ...baseInv, currency: "EUR" }, line, rm, rmsRow, 100, update, 2);
    expect(svc.calls).toHaveLength(0);
    expect(update.requires_review).toBe(true);
    expect(update.review_reason).toBe("unsupported_currency");
  });

  it("lar en eldre faktura være i fred", async () => {
    const svc = mockClient();
    const update: AnyRec = { requires_review: false, review_reason: null };
    await syncRegisteredPrices(svc, { ...baseInv, invoice_date: "2025-12-01" }, line, rm, rmsRow, 100, update, 2);
    expect(svc.calls).toHaveLength(0);
  });

  it("sender store avvik til gjennomgang i stedet for å skrive", async () => {
    const svc = mockClient();
    const update: AnyRec = { requires_review: false, review_reason: null };
    await syncRegisteredPrices(svc, baseInv, line, rm, rmsRow, 4, update, 2);
    expect(update.requires_review).toBe(true);
    expect(update.review_reason).toBe("price_drop");
    expect(svc.calls).toHaveLength(0);
  });
});

describe("learnPendingAliases", () => {
  it("skriver ventende alias for både varenummer og navn", async () => {
    const svc = mockClient();
    const n = await learnPendingAliases(svc, "rms1", line, "inv1");
    expect(n).toBe(2);
    expect(svc.calls).toHaveLength(2);
    expect(svc.calls.every((c) => c.payload.status === "pending")).toBe(true);
  });

  it("skriver ingenting uten verdier å lære av", async () => {
    const svc = mockClient();
    const n = await learnPendingAliases(svc, "rms1", { supplier_sku: null, description: null }, "inv1");
    expect(n).toBe(0);
    expect(svc.calls).toHaveLength(0);
  });
});
