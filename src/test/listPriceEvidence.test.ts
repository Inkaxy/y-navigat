/** Listens prisgrunnlag: streng parser, batcher, binding og felles modell (filter/sort/CSV). */
import { describe, expect, it } from "vitest";
import {
  comparisonFor, fetchListEvidence, parseListEvidence, PENDING_UNCHECKED, LIST_EVIDENCE_BATCH,
  type ListComparison,
} from "@/ravarer/lib/listPriceEvidence";
import { applyView, buildSearchText, filterAndSortItems, type RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";
import { csvValue } from "@/ravarer/lib/varelisteCsv";
import { deviationRuleFor } from "@/ravarer/lib/varerOrder";

const LE = "751709bc-04b3-4449-867d-b97faa9ab373";
const V = "2026-10-11T12:00:00.123456+00:00";
const ALI = "d431675b-e2ec-4b37-bcf1-e120a32d44a6";

/** Nøyaktig radform fra live-SQL (rm_list_price_evidence, schema 1). */
const aliRow = {
  raw_material_id: ALI, material_updated_at: V, status: "unknown", reason: "cost_unverified", cost_reason: "cost_unverified",
  invoice_reason: "line_arithmetic_unverified", cost_evidence_status: "unknown", invoice_evidence_status: "unknown",
  current_price: 16.053333333333335, cost_basis_status: "uverifisert", cost_source_history_id: null, selected_cost_history_id: null,
  cost_effective_date: null, cost_source_kind: null, price_updated_at: "2025-08-27", invoice_id: "874d1628-dbb9-4e5e-a932-6e0295a1faad",
  invoice_line_id: "de021bf6-ff42-4ed5-8df5-3d1bbfd61cb9", invoice_number: "1", invoice_date: "2026-07-29", supplier_id: "s",
  line_version: V, invoice_price_per_base_unit: null, base_unit: "stk", currency: null, deviation_pct: null,
};
const combiRow = (id: string, over: Record<string, unknown> = {}) => ({
  ...aliRow, raw_material_id: id, status: "eligible", reason: null, cost_reason: null, invoice_reason: null,
  cost_evidence_status: "eligible", invoice_evidence_status: "eligible", current_price: 60.6035, cost_basis_status: "verifisert",
  cost_source_history_id: "h1", selected_cost_history_id: "h1", cost_effective_date: "2026-08-18", cost_source_kind: "invoice",
  invoice_id: "i1", invoice_line_id: "l1", invoice_date: "2026-08-18", invoice_price_per_base_unit: 60.6035, base_unit: "kg",
  currency: "NOK", deviation_pct: 0, ...over,
});
const env = (rows: unknown[], over: Record<string, unknown> = {}) => ({ schema_version: 1, legal_entity_id: LE, checked_at: V, requested_count: rows.length, rows, ...over });

describe("parser", () => {
  it("ALI (uverifisert stk-kost mot eske-faktura) er ukjent, aldri 3421,9 %", () => {
    const p = parseListEvidence(env([aliRow]), LE, [ALI]);
    const r = p?.rows[0];
    expect(r?.status).toBe("unknown");
    expect(r?.deviationPct).toBeNull();
    const c = comparisonFor({ id: ALI, updatedAt: V, costPrice: 16.053333333333335, baseUnit: "stk" }, r, V);
    expect(c.state).toBe("unknown");
    expect(c.state === "unknown" && c.label).toBe("Kostprisen er ikke verifisert");
  });
  it("verifisert Combi med samme enhet gir 0 % (gyldig null); reelt stort avvik vises", () => {
    const p = parseListEvidence(env([combiRow("c"), combiRow("d", { invoice_price_per_base_unit: 2134.32, deviation_pct: 3421.885 })]), LE, ["c", "d"]);
    expect(p?.rows.map((r) => r.deviationPct)).toEqual([0, 3421.885]);
  });
  it.each([
    ["feil selskap", env([combiRow("c")], { legal_entity_id: "x" }), ["c"]],
    ["feil schema", env([combiRow("c")], { schema_version: 2 }), ["c"]],
    ["manglende rad", env([combiRow("c")], { requested_count: 2 }), ["c", "d"]],
    ["duplikat", env([combiRow("c"), combiRow("c")]), ["c", "d"]],
    ["fremmed id", env([combiRow("z")]), ["c"]],
    ["eligible uten NOK", env([combiRow("c", { currency: "SEK" })]), ["c"]],
    ["eligible med grunn", env([combiRow("c", { reason: "x" })]), ["c"]],
    ["eligible med uverifisert kost", env([combiRow("c", { cost_basis_status: "uverifisert" })]), ["c"]],
    ["streng desimal", env([combiRow("c", { deviation_pct: "0" })]), ["c"]],
    ["ukjent med tall", env([{ ...aliRow, raw_material_id: "c", deviation_pct: 5 }]), ["c"]],
    ["ugyldig versjon", env([combiRow("c", { material_updated_at: "i går" })]), ["c"]],
  ])("%s → hele batchen ukjent", (_n, data, ids) => {
    expect(parseListEvidence(data, LE, ids)).toBeNull();
  });
});

describe("binding til vist rad", () => {
  const ev = parseListEvidence(env([combiRow("c")]), LE, ["c"])?.rows[0];
  it("annen råvareversjon, kostpris eller enhet → ikke kontrollert", () => {
    expect(comparisonFor({ id: "c", updatedAt: "2026-10-11T12:00:00.123457+00:00", costPrice: 60.6035, baseUnit: "kg" }, ev, V)).toBe(PENDING_UNCHECKED);
    expect(comparisonFor({ id: "c", updatedAt: V, costPrice: 61, baseUnit: "kg" }, ev, V)).toBe(PENDING_UNCHECKED);
    expect(comparisonFor({ id: "c", updatedAt: V, costPrice: 60.6035, baseUnit: "g" }, ev, V)).toBe(PENDING_UNCHECKED);
    expect(comparisonFor({ id: "c", updatedAt: V, costPrice: 60.6035, baseUnit: "kg" }, undefined, V)).toBe(PENDING_UNCHECKED);
  });
  it("samme versjon i annet tidssoneformat binder", () => {
    expect(comparisonFor({ id: "c", updatedAt: "2026-10-11T14:00:00.123456+02:00", costPrice: 60.6035, baseUnit: "kg" }, ev, V).state).toBe("eligible");
  });
});

describe("batcher", () => {
  const ids = Array.from({ length: 391 }, (_, i) => `m${String(i).padStart(3, "0")}`);
  const ok = (b: string[]) => env(b.map((id) => combiRow(id)));
  it("391 råvarer = 4 kall à maks 100, høyst 2 samtidig, full dekning", async () => {
    let active = 0, peak = 0;
    const sizes: number[] = [];
    const r = await fetchListEvidence(LE, ids, async (b) => {
      active++; peak = Math.max(peak, active); sizes.push(b.length);
      await new Promise((res) => setTimeout(res, 5));
      active--;
      return ok(b);
    });
    expect(sizes.sort((a, b) => b - a)).toEqual([100, 100, 100, 91]);
    expect(peak).toBe(2);
    expect(r.byId.size).toBe(391);
    expect(LIST_EVIDENCE_BATCH).toBe(100);
  });
  it("feil i andre batch: ingenting publiseres, resten avbrytes", async () => {
    const seen: AbortSignal[] = [];
    let calls = 0;
    await expect(fetchListEvidence(LE, ids, async (b, s) => {
      seen.push(s);
      calls++;
      if (calls === 2) throw new Error("nett");
      await new Promise((res) => setTimeout(res, 5));
      return ok(b);
    })).rejects.toThrow();
    expect(calls).toBeLessThan(4);
    expect(seen.every((s) => s.aborted)).toBe(true);
  });
  it("ugyldig batch (manglende rad) gir feil, ikke delvise nuller", async () => {
    await expect(fetchListEvidence(LE, ids.slice(0, 3), async (b) => env(b.slice(1).map((id) => combiRow(id)), { requested_count: b.length }))).rejects.toThrow();
  });
  it("ytre avbrudd (selskapsbytte/foreldet spørring) stopper", async () => {
    const ctrl = new AbortController();
    const p = fetchListEvidence(LE, ids, async (b, s) => { ctrl.abort(); await Promise.resolve(); if (s.aborted) throw new Error("avbrutt"); return ok(b); }, ctrl.signal);
    await expect(p).rejects.toThrow();
  });
});

describe("felles modell: filter, sortering, CSV", () => {
  const base = (id: string, comparison: ListComparison, costStatus: RawMaterialListItem["costStatus"] = "verifisert"): RawMaterialListItem => ({
    id, sku: id, name: id, declarationName: "x", categories: ["Mel"], itemType: "ravare", isActive: true, baseUnit: "kg", costPrice: 10,
    costStatus, costSource: "invoice", costUpdatedAt: null, agreedPrice: null, supplierId: "s", supplierName: "S", supplierSku: null,
    primaryLinkId: null, matchedAlias: null, lastInvoicePrice: 565.38, lastInvoiceDate: null, comparison,
    deviation: comparison.state === "eligible" ? comparison.deviation : null, packageState: "missing", volume12m: 1, currentStock: 0,
    stockTracking: false, minStock: null, hasNutrition: true, hasDatasheet: true, hasAllergens: true, searchText: buildSearchText([id]), aliases: [],
  });
  const elig = (d: number): ListComparison => ({ state: "eligible", deviation: d, invoicePpbu: 10, invoiceDate: null, invoiceNumber: null, invoiceId: "i", checkedAt: V });
  const unk: ListComparison = { state: "unknown", label: "Kostprisen er ikke verifisert", needsControl: true, invoiceId: "i", invoiceDate: null, checkedAt: V };
  const items = [base("ali", unk, "uverifisert"), base("combi", elig(0)), base("big", elig(3421.9)), base("neg", elig(-20)), base("pend", PENDING_UNCHECKED)];
  const rule = deviationRuleFor(() => 3, 15);
  it("avviksfilter tar bare bevist avvik; ukjent finnes i kontrollvisningen", () => {
    expect(applyView(items, "deviation", rule).map((i) => i.id).sort()).toEqual(["big", "neg"]);
    expect(applyView(items, "price_control", rule).map((i) => i.id)).toEqual(["ali"]);
  });
  it("sortering på avvik legger ukjent nederst og beholder fortegn/0", () => {
    const sorted = filterAndSortItems(items, { q: "", kat: "all", type: "all", status: "all", view: "all", sortKey: "deviation", sortDir: "desc" }, rule).map((i) => i.id);
    expect(sorted.slice(0, 3)).toEqual(["big", "neg", "combi"]);
    expect(sorted.slice(3).sort()).toEqual(["ali", "pend"]);
  });
  it("CSV: ukjent eksporteres som status, aldri 0; uverifisert kost merkes", () => {
    expect(csvValue("deviation", items[0])).toBe("Kostprisen er ikke verifisert");
    expect(csvValue("deviation", items[1])).toBe("0");
    expect(csvValue("deviation", items[4])).toBe("Prisgrunnlag ikke kontrollert");
    expect(csvValue("cost", items[0])).toMatch(/\(ikke verifisert\)$/);
    expect(csvValue("cost", items[1])).not.toMatch(/verifisert/);
  });
});
