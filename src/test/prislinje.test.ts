import { describe, expect, it } from "vitest";
import { barsFor, correctable, effectiveThreshold, filterPrislinje, parseCorrection, parseCorrectionLog, parsePackageChange, readiness, sinceMonthsBack, type PrislinjeRow } from "@/ravarer/lib/prislinje";
import type { TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";

const h = (id: string, date: string, price: number, extra: Partial<TimelineHistoryRow> = {}): TimelineHistoryRow => ({
  id, effective_date: date, price, supplier_id: "TINE", source: "manual", invoice_id: null, unit: "kg", unitSource: null, createdAt: `${date}T10:00:00Z`, ...extra,
} as TimelineHistoryRow);

describe("Prislinje: søyler eldste til nyeste", () => {
  it("bare valgt leverandør, eldste først, endring mot forrige søyle", () => {
    const bars = barsFor([h("b", "2026-08-25", 118, { createdBy: "u" }), h("a", "2026-08-11", 96.5, { createdBy: "u" }), h("x", "2026-08-12", 50, { supplier_id: "ASKO" })], "TINE", "kg", []);
    expect(bars.map((b) => b.price)).toEqual([96.5, 118]);
    expect(bars[1].changePct).toBeCloseTo(22.28, 1);
    expect(bars[0].status).toBe("godkjent");
  });
  it("åpne linjer kommer som «Venter på deg», uten bruker = «Av regelen»", () => {
    const bars = barsFor([h("a", "2026-09-08", 96.5)], "TINE", "kg", [{ id: "l", date: "2026-11-03", price: 103 }]);
    expect(bars.map((b) => b.status)).toEqual(["regel", "venter"]);
  });
});

describe("Prislinje: innstillinger og retting", () => {
  it("egen avviksgrense vinner, ellers kategoriens toleranse", () => {
    expect(effectiveThreshold(10, 3)).toBe(10);
    expect(effectiveThreshold(null, 3)).toBe(3);
  });
  it("«Siden» er 12 måneder som standard og kan gå så langt tilbake man vil", () => {
    expect(sinceMonthsBack("2026-11-17", 12)).toBe("2025-11-17");
    expect(sinceMonthsBack("2026-03-31", 1)).toBe("2026-02-28");
    expect(sinceMonthsBack("2026-11-17", 60)).toBe("2021-11-17");
  });
  it("bare aktive kjøp kan rettes", () => {
    expect(correctable(h("a", "2026-01-01", 10))).toBe(true);
    expect(correctable(h("a", "2026-01-01", 10, { supersededAt: "2026-02-01" }))).toBe(false);
    expect(correctable(h("a", "2026-01-01", 10, { isCredit: true }))).toBe(false);
  });
  it("retting: forhåndsvisning, lagret og ukjent leses strengt", () => {
    expect(parseCorrection({ ok: true, dry_run: true, old_price: 103, new_price: 101, cost_before: 103, cost_after: 101 }).kind).toBe("preview");
    expect(parseCorrection({ ok: true, dry_run: false, new_price: 101, already: true })).toMatchObject({ kind: "saved", already: true });
    expect(parseCorrection({ ok: false, error: "samme_pris" })).toEqual({ kind: "rejected", error: "samme_pris" });
    expect(parseCorrection({ ok: true })).toEqual({ kind: "unknown" });
    expect(parseCorrection(null)).toEqual({ kind: "unknown" });
  });
  it("pakningsendring: forhåndsvisning med linjer", () => {
    const r = parsePackageChange({ ok: true, dry_run: true, open_lines: 1, open_invoices: 1, lines: [{ line_id: "l", invoice_number: "1", price_per_base_unit: 412, new_price_per_base_unit: 82.4 }] });
    expect(r.kind === "preview" && r.lines[0].after).toBe(82.4);
    expect(parsePackageChange({ ok: true, dry_run: true }).kind).toBe("unknown");
  });
  it("endringslogg: én rad per retting, uleselig svar = null", () => {
    const rows = parseCorrectionLog([{ id: "c", kind: "price", corrected_at: "2026-11-17T10:00:00Z", reason: "Feil lest", corrected_by: "u", before: { price: 103, invoice_number: "1001" }, after: { price: 101 } }], "kg");
    expect(rows?.[0].summary).toBe("Pris rettet 103,00 → 101,00 kr/kg (faktura 1001)");
    expect(parseCorrectionLog([{ id: 1 }], "kg")).toBeNull();
  });
});

describe("Prislinje: liste og klar for bruk", () => {
  const row = (p: Partial<PrislinjeRow>): PrislinjeRow => ({ id: "1", rawMaterialId: "r", supplierId: "s", rmName: "Smør", supplierName: "TINE", baseUnit: "kg", itemType: "ravare", category: null,
    currentCost: 98, costStatus: "verifisert", allergensReviewedAt: null, declarationName: "Smør", isPrimary: true, packageSize: 10, packageUnit: "kg", buPerPackage: 10,
    containerUnit: "kartong", packageConfirmedAt: "2026-09-02", lastInvoiceDate: null, updatedAt: "x", rmUpdatedAt: "y", ...p });
  it("søk på råvare eller leverandør, sortert på navn", () => {
    expect(filterPrislinje([row({ id: "2", rmName: "Egg" }), row({})], "").map((r) => r.rmName)).toEqual(["Egg", "Smør"]);
    expect(filterPrislinje([row({ id: "2", supplierName: "ASKO" }), row({})], "asko").length).toBe(1);
  });
  it("emballasje sjekkes bare for kost og pakning", () => {
    expect(readiness(row({ itemType: "emballasje" }), null).map((c) => c.key)).toEqual(["kost", "pakning"]);
    const r = readiness(row({}), null);
    expect(r.find((c) => c.key === "allergener")?.ok).toBe(false);
    expect(r.find((c) => c.key === "naering")?.ok).toBeNull();
  });
});
