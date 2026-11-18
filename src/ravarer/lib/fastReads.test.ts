import { describe, expect, it } from "vitest";
import { parseNavCounts, parsePriceJumpRows, parseUnreadRows } from "./fastReads";

const jump = { id: "l1", invoice_id: "i1", raw_material_id: "r1", supplier_sku: "29 9727", description: "ISTE CHAI", price_per_base_unit: 12.5,
  expected_price_per_base_unit: 10, price_variance_pct: 25, review_reason: "price_variance", invoice_number: "F-1", invoice_date: "2026-11-01",
  supplier_id: "s1", rm_name: "Iste chai", rm_base_unit: "l", rm_item_type: "raw_material" };
const unread = { id: "i1", invoice_number: "F-1", invoice_date: "2026-11-01", supplier_id: "s1", total_amount: 1250, total_vat: 250, is_credit_note: false,
  lines_sum_excl_vat: 900, updated_at: "2026-11-18T08:00:00.123456+00:00", line_extraction_status: "done", line_extraction_error: null,
  lines_sum_status: "mismatch", tripletex_supplier_invoice_id: "123", line_count: 4 };

describe("raske oppslag – strenge parsere", () => {
  it("menytellerne leses som tall; mangler = feil, aldri 0", () => {
    expect(parseNavCounts({ ok: true, datasheet_changes: 2, agreements_expiring_30d: 0, stock_below_min: 3 })).toEqual({ datasheet_changes: 2, agreements_expiring_30d: 0, stock_below_min: 3 });
    expect(() => parseNavCounts({ ok: true, datasheet_changes: 2, stock_below_min: 3 })).toThrow();
    expect(() => parseNavCounts({ ok: false })).toThrow();
    expect(() => parseNavCounts(null)).toThrow();
  });
  it("Prishopp-rader beholder alle felt dagens liste bruker", () => {
    expect(parsePriceJumpRows({ ok: true, rows: [jump] })).toEqual([jump]);
    expect(parsePriceJumpRows({ ok: true, rows: [] })).toEqual([]);
    expect(() => parsePriceJumpRows({ ok: true, rows: [{ ...jump, price_variance_pct: "25" }] })).toThrow();
    expect(() => parsePriceJumpRows({ ok: true })).toThrow();
    expect(() => parsePriceJumpRows([])).toThrow();
  });
  it("Ikke lest: rå revisjon og linjeantall bevares; tall fra Tripletex blir tekst", () => {
    const [r] = parseUnreadRows({ ok: true, rows: [{ ...unread, tripletex_supplier_invoice_id: 123 }] });
    expect(r.updated_at).toBe("2026-11-18T08:00:00.123456+00:00");
    expect(r.line_count).toBe(4);
    expect(r.tripletex_supplier_invoice_id).toBe("123");
    expect(() => parseUnreadRows({ ok: true, rows: [{ ...unread, line_count: null }] })).toThrow();
    expect(() => parseUnreadRows({ ok: true, rows: [{ ...unread, id: "" }] })).toThrow();
  });
});
