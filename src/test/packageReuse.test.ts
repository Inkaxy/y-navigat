import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { packageSignature, pickPackageRow } from "@/fakturaer/lib/packageSignature";
import { packageNeedsConfirmation, resolveLineCost } from "@/fakturaer/lib/units";
import { lineStatus } from "@/fakturaer/lib/lineStatus";
import { suggestPackage } from "@/fakturaer/lib/packageDraft";
import { assessInboxInvoice } from "@/fakturaer/lib/inbox";
import { reconcileAcceptance } from "../../supabase/functions/_shared/priceAcceptance";

const body = (p: string) => readFileSync(resolve(p), "utf8").split("\n").slice(1).join("\n");

describe("pakningsregelen er felles for skjerm og matchemotor", () => {
  it("filene er like (bortsett fra stihenvisningen øverst)", () => {
    expect(body("src/fakturaer/lib/packageSignature.ts")).toBe(body("supabase/functions/_shared/packageSignature.ts"));
  });
  it("motoren bruker den felles regelen, ikke «første rad»", () => {
    const fn = readFileSync(resolve("supabase/functions/match-invoice-lines/index.ts"), "utf8");
    expect(fn).toContain("pickPackageRow(");
    expect(fn).not.toMatch(/rmsList\.find\(\(r: AnyRec\) => r\.raw_material_id === (update|line)\.raw_material_id/);
    expect(fn).toContain("matchedRmsId = null;");
  });
  it("NULL innhold med 1 kg og 25 kg er ulike pakninger → konflikt", () => {
    const rows = [
      { id: "a", supplier_sku: null, package_size: 1, package_unit: "kg", base_units_per_package: null },
      { id: "b", supplier_sku: null, package_size: 25, package_unit: "kg", base_units_per_package: null },
    ];
    expect(packageSignature(rows[0])).not.toBe(packageSignature(rows[1]));
    expect(pickPackageRow(rows, null)).toEqual({ row: undefined, conflict: true });
  });
  it("eksakt varenummer eller radpresist alias velger riktig rad", () => {
    const rows = [
      { id: "a", supplier_sku: "111", package_size: 1, package_unit: "kg", base_units_per_package: 1 },
      { id: "b", supplier_sku: "222", package_size: 25, package_unit: "kg", base_units_per_package: 25 },
    ];
    expect(pickPackageRow(rows, "222").row?.id).toBe("b");
    expect(pickPackageRow(rows, null, "a").row?.id).toBe("a");
    expect(pickPackageRow(rows, "999").conflict).toBe(true);
  });
  it("samme varenummer på to rader med ulik pakning → konflikt", () => {
    const rows = [
      { id: "a", supplier_sku: "111", package_size: 1, package_unit: "kg", base_units_per_package: null },
      { id: "b", supplier_sku: "111", package_size: 25, package_unit: "kg", base_units_per_package: null },
    ];
    expect(pickPackageRow(rows, "111").conflict).toBe(true);
  });
  it("identisk full signatur er entydig", () => {
    const r = { package_size: 36, package_unit: "stk", base_units_per_package: 36, package_confirmed_at: "x" };
    expect(pickPackageRow([{ id: "a", ...r }, { id: "b", ...r }], null).conflict).toBe(false);
  });
});

describe("to fakturaer fra samme leverandør med bekreftet 36 stk", () => {
  const confirmed = { id: "rms", supplier_sku: "4711", package_size: 36, package_unit: "stk", base_units_per_package: 36, package_confirmed_at: "2026-09-01" };
  const line2 = { quantity: 2, unit: "eske", unitPrice: 541.03, totalAmount: 1082.06, description: "ALI ORIGINAL FINMALT 36X90G", baseUnit: "stk" };

  it("andre faktura trenger verken ny råvare- eller pakningsbekreftelse", () => {
    const { row, conflict } = pickPackageRow([confirmed], "4711");
    expect(conflict).toBe(false);
    const cost = resolveLineCost({
      ...line2,
      supplierPackage: { baseUnitsPerPackage: 36, packageSize: 36, packageUnit: "stk", packageConfirmedAt: row!.package_confirmed_at },
    });
    expect(cost.needsInput).toBeFalsy();
    expect(packageNeedsConfirmation(cost)).toBe(false);
    expect(cost.baseQuantity).toBe(72);
    const st = lineStatus({ id: "l2", review_reason: null, requires_review: false, raw_material_id: "rm", match_confidence: "auto_high", price_per_base_unit: cost.pricePerBaseUnit });
    expect(st.bucket).toBe("ready");
    expect(suggestPackage({ package_size: null, package_unit: null, count_per_package: null, description: line2.description }, "stk", confirmed)).toEqual({ size: "36", unit: "stk" });
  });

  it("samme SKU med endret pakning og NULL-duplikater blir ikke «klar»", () => {
    const dupes = [
      { id: "a", supplier_sku: "4711", package_size: 36, package_unit: "stk", base_units_per_package: null },
      { id: "b", supplier_sku: "4711", package_size: 24, package_unit: "stk", base_units_per_package: null },
    ];
    expect(pickPackageRow(dupes, "4711").conflict).toBe(true);
    const st = lineStatus({ id: "l", review_reason: "package_conflict", requires_review: true, raw_material_id: "rm", match_confidence: "auto_high", price_per_base_unit: 15 });
    expect(st.key).toBe("confirm_package");
  });
});

describe("innboksen bruker samme linjevurdering som kontrollflaten", () => {
  const base = { status: "needs_review", is_credit_note: false, lines_sum_status: "ok", notes: null };
  const L = (o: Record<string, unknown>) => ({ raw_material_id: "rm", requires_review: false, review_reason: null, price_variance_pct: null, variance_status: null, category: null, match_confidence: "auto_high", price_per_base_unit: 10, ...o });
  it.each([["auto_low"], ["auto_medium"], [null]])("match_confidence=%s står åpen", (mc) => {
    expect(assessInboxInvoice({ ...base, lines: [L({ match_confidence: mc })] }).canReconcile).toBe(false);
  });
  it("manglende pris per grunnenhet står åpen", () => {
    expect(assessInboxInvoice({ ...base, lines: [L({ price_per_base_unit: null })] }).canReconcile).toBe(false);
  });
  it("utenlandsk valuta sperrer fullføring", () => {
    expect(assessInboxInvoice({ ...base, currency: "SEK", lines: [L({})] }).canReconcile).toBe(false);
  });
});

describe("prisaksept sammenligner hele grunnlaget", () => {
  const rms = { id: "rms", package_size: 36, package_unit: "stk", base_units_per_package: 36, package_confirmed_at: "2026-09-01" };
  const acc = {
    raw_material_id: "rm", quantity: 2, unit: "eske", unit_price: 541.03, total_amount: 1082.06, base_quantity: 72,
    package_size: null, package_unit: null, count_per_package: null, price_per_base_unit: 15.0286,
    expected_price_per_base_unit: 12, price_reference_source: "agreement", price_reference_id: "ref", price_reference_date: "2026-09-01",
    rms_id: "rms", rms_package: { package_size: 36, package_unit: "stk", base_units_per_package: 36, package_confirmed_at: "2026-09-01" },
    accepted_reasons: ["price_variance"],
  };
  const line = { quantity: 2, unit: "eske", unit_price: 541.03, total_amount: 1082.06, package_size: null, package_unit: null, count_per_package: null, price_acceptance: acc, resolved_by: "u1" };
  const target = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    requires_review: true, review_reason: "price_variance", base_quantity: 72, price_per_base_unit: 15.0286,
    expected_price_per_base_unit: 12, price_reference_source: "agreement", price_reference_id: "ref", price_reference_date: "2026-09-01", ...o,
  });

  it("samme grunnlag og samme pakningskilde beholder aksepten", () => {
    const t = target();
    reconcileAcceptance(line, t, "rm", rms);
    expect(t.requires_review).toBe(false);
  });
  it("endret mengde i grunnenhet åpner igjen", () => {
    const t = target({ base_quantity: 48 });
    reconcileAcceptance(line, t, "rm", rms);
    expect(t.price_acceptance).toBeNull();
  });
  it("endret pakning på koblingen eller annen kobling åpner igjen", () => {
    for (const row of [{ ...rms, base_units_per_package: 24 }, { ...rms, id: "annen" }, null]) {
      const t = target();
      reconcileAcceptance(line, t, "rm", row);
      expect(t.review_reason).toBe("price_variance");
    }
  });
  it("endret pakningsfelt på linjen åpner igjen", () => {
    const t = target();
    reconcileAcceptance({ ...line, package_size: 24 }, t, "rm", rms);
    expect(t.review_reason).toBe("price_variance");
  });
  it("et gjennomgangsflagg uten årsak ryddes ikke bort", () => {
    const t = target({ review_reason: null, requires_review: true });
    reconcileAcceptance(line, t, "rm", rms);
    expect(t.requires_review).toBe(true);
  });
});
