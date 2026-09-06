import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { RECONCILABLE_STATUSES, validateReconcile, type ReconcileInvoice, type ReconcileLine } from "./validate.ts";

function invoice(p: Partial<ReconcileInvoice> = {}): ReconcileInvoice {
  return {
    id: "inv",
    status: "needs_review",
    currency: "NOK",
    is_credit_note: false,
    supplier_id: "sup",
    invoice_date: "2026-09-06",
    ...p,
  };
}

function line(p: Partial<ReconcileLine> = {}): ReconcileLine {
  return {
    id: p.id ?? "l1",
    raw_material_id: "rm1",
    requires_review: false,
    match_confidence: "auto_high",
    price_per_base_unit: 10,
    quantity: 1,
    unit_price: 10,
    ...p,
  };
}

const codes = (bs: { code: string }[]) => bs.map((b) => b.code);

Deno.test("needs_review er en gyldig status å bekrefte fra", () => {
  assertEquals(RECONCILABLE_STATUSES.includes("needs_review"), true);
  assertEquals(validateReconcile(invoice({ status: "needs_review" }), [line()]).length, 0);
});

Deno.test("reconciled og flagged er fortsatt sperret", () => {
  assertEquals(codes(validateReconcile(invoice({ status: "reconciled" }), [line()])), ["already_reconciled"]);
  assertEquals(codes(validateReconcile(invoice({ status: "flagged" }), [line()])), ["wrong_status"]);
});

Deno.test("ugyldig pris per baseenhet blokkerer bekreftelsen", () => {
  for (const v of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const bs = validateReconcile(invoice(), [line({ price_per_base_unit: v as number | null })]);
    assertEquals(bs.some((b) => b.code === "invalid_base_price"), true, `pris ${v}`);
  }
});

Deno.test("linjer merket «ikke råvare» og linjer uten råvare krever ikke pris", () => {
  const bs = validateReconcile(invoice(), [
    line({ id: "a", match_confidence: "not_applicable", price_per_base_unit: null }),
    line({ id: "b", price_per_base_unit: 12 }),
  ]);
  assertEquals(bs.length, 0);
});

Deno.test("blandede linjer: gjennomgang, umatchet og ulik pris fanges hver for seg", () => {
  const bs = validateReconcile(invoice(), [
    line({ id: "a", requires_review: true }),
    line({ id: "b", raw_material_id: null, price_per_base_unit: null }),
    line({ id: "c", raw_material_id: "rm2", price_per_base_unit: 10 }),
    line({ id: "d", raw_material_id: "rm2", price_per_base_unit: 12 }),
  ]);
  const c = codes(bs);
  assertEquals(c.includes("lines_need_review"), true);
  assertEquals(c.includes("unmatched_lines"), true);
  assertEquals(c.includes("duplicate_raw_material_prices"), true);
});

Deno.test("meldingen ved flere priser ber ikke om å slette eller omklassifisere linjer", () => {
  const bs = validateReconcile(invoice(), [
    line({ id: "c", raw_material_id: "rm2", price_per_base_unit: 10 }),
    line({ id: "d", raw_material_id: "rm2", price_per_base_unit: 12 }),
  ]);
  const msg = bs.find((b) => b.code === "duplicate_raw_material_prices")!.message;
  assertEquals(/slå sammen|slett|ikke råvare|ikke skal telle/i.test(msg), false);
  assertEquals(msg.includes("F2"), true);
});

Deno.test("kreditnota og fremmed valuta er fortsatt sperret", () => {
  assertEquals(codes(validateReconcile(invoice({ is_credit_note: true }), [line()])).includes("credit_note"), true);
  assertEquals(codes(validateReconcile(invoice({ currency: "EUR" }), [line()])).includes("foreign_currency"), true);
});
