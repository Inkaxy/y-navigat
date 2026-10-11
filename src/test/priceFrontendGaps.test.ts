import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

// ---- Supabase-mock for fetchPriceHistory (paginering + metadata) ----
type Res = { data: unknown; error: null };
const tables: Record<string, unknown[]> = {};
function builder(table: string) {
  let rows = [...(tables[table] ?? [])];
  let range: [number, number] | null = null;
  const b = {
    select: () => b,
    eq: (col: string, v: unknown) => { rows = rows.filter((r) => (r as Record<string, unknown>)[col] === v); return b; },
    in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes((r as Record<string, unknown>)[col])); return b; },
    order: () => b,
    limit: () => b,
    range: (f: number, t: number) => { range = [f, t]; return b; },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (ok: (r: Res) => unknown) => ok({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }),
  };
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));

import { lineCost, computeRecipeCost } from "@/varer/lib/recipeCost";
import { costPerKg } from "@/varer/lib/halvfabrikat";
import { buildRecipeBasis, type LinkedRecipe } from "@/varer/hooks/useProductRecipeLink";
import type { BakersLine, BakersRawMaterial } from "@/varer/lib/bakers";
import { buildTimeline, timelineCsv, type TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";
import { resolveProvenance, BASE_UNIT_GUARD_SINCE } from "@/ravarer/lib/priceProvenance";
import { fetchPriceHistory } from "@/ravarer/hooks/priceHistoryFetch";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { BAKERS_RM_KEY } from "@/varer/lib/bakersRawMaterials";
import { PRICE_HISTORY_FIXTURE, RECIPE_INCOMPLETE_FIXTURE, RECIPE_VERIFIED_FIXTURE } from "@/dev/priceCalcFixtures";

const rm = (o: Partial<BakersRawMaterial>): BakersRawMaterial => ({ id: "r", name: "Råvare", cost_basis_status: "verifisert", ...o });
const ln = (quantity: number, unit: string, r: BakersRawMaterial, extra: Partial<BakersLine> = {}): BakersLine =>
  ({ id: `${r.id}-${unit}`, recipe_part_id: "p", raw_material_id: r.id, quantity, unit, _rm: r, ...extra });

describe("1) dimensjonsriktig linjekost", () => {
  it("100 g med pris 2 kr/g gir 200 kr (ikke 0,2)", () => {
    expect(lineCost(ln(100, "g", rm({ base_unit: "g", current_cost_price: 2 })), 100).cost).toBe(200);
  });
  it("kg-pris og g-linje", () => {
    expect(lineCost(ln(500, "g", rm({ base_unit: "kg", current_cost_price: 10 })), 500).cost).toBeCloseTo(5);
  });
  it("ml-pris og dl-linje uten tetthet", () => {
    expect(lineCost(ln(2, "dl", rm({ base_unit: "ml", current_cost_price: 0.05 })), 0).cost).toBeCloseTo(10);
  });
  it("liter-pris og gram-linje krever tetthet; med tetthet 0,92 g/ml", () => {
    const noD = lineCost(ln(920, "g", rm({ base_unit: "l", current_cost_price: 30 })), 920);
    expect(noD.cost).toBeNull();
    expect(noD.reason).toMatch(/tetthet/);
    expect(lineCost(ln(920, "g", rm({ base_unit: "l", current_cost_price: 30, density_g_per_ml: 0.92 })), 920).cost).toBeCloseTo(30);
  });
  it("kg-pris og liter-linje krever tetthet (gram fra tetthet)", () => {
    const r = rm({ base_unit: "kg", current_cost_price: 20, density_g_per_ml: 1.03 });
    const res = computeRecipeCost([ln(1, "l", r)]);
    expect(res.totalCost).toBeCloseTo(20.6);
    const r2 = rm({ base_unit: "kg", current_cost_price: 20 });
    expect(computeRecipeCost([ln(1, "l", r2)]).incomplete).toBe(true);
  });
  it("svinn gjelder også volumlinjer", () => {
    expect(computeRecipeCost([ln(1, "l", rm({ base_unit: "l", current_cost_price: 10 }), { waste_percent: 10 } as Partial<BakersLine>)]).totalCost).toBeCloseTo(11);
  });
});

describe("2) prisstatus gjør kalkylen ufullstendig", () => {
  it("uverifisert, mangler og ikke hentet status", () => {
    for (const st of ["uverifisert", "mangler", null, undefined]) {
      const res = computeRecipeCost([ln(1, "kg", rm({ base_unit: "kg", current_cost_price: 10, cost_basis_status: st }))], { totalDoughG: 1000 });
      expect(res.incomplete).toBe(true);
      expect(res.costPerKg).toBeNull();
    }
  });
  it("verifisert fixture er komplett med nyeste verifiserte dato; ufullstendig fixture viser grunner", () => {
    const ok = computeRecipeCost(RECIPE_VERIFIED_FIXTURE);
    expect(ok.incomplete).toBe(false);
    expect(ok.newestVerifiedDate).toBe("2026-10-08T10:00:00Z");
    const bad = computeRecipeCost(RECIPE_INCOMPLETE_FIXTURE);
    expect(bad.incomplete).toBe(true);
    expect(bad.unverifiedCount).toBe(3);
    expect(bad.missing.map((m) => m.reason)).toEqual(expect.arrayContaining([
      "Uverifisert kostpris — ingen gyldig kilde", "Mangler gyldig kostpris", "Prisstatus er ikke hentet",
    ]));
  });
  it("halvfabrikat: ufullstendig underlag gir ingen kg-pris", () => {
    const lines = [ln(1, "kg", rm({ id: "a", base_unit: "kg", current_cost_price: 10 })), ln(1, "kg", rm({ id: "b", base_unit: "kg", current_cost_price: 5, cost_basis_status: "uverifisert" }))];
    expect(costPerKg(lines)).toBeNull();
    expect(costPerKg(lines.slice(0, 1))).toBeCloseTo(10);
  });
  it("nestet halvfabrikat-råvare med uverifisert status gjør produktkoblingen ufullstendig", () => {
    const map: Record<string, BakersRawMaterial> = {
      mel: rm({ id: "mel", name: "Mel", base_unit: "kg", current_cost_price: 12 }),
      deig: rm({ id: "deig", name: "Fordeig", base_unit: "kg", current_cost_price: 8, produced_by_recipe_id: "x", cost_basis_status: "uverifisert" }),
    };
    const recipe = { id: "r", name: "Brød", units_per_batch: 2, recipe_lines: [
      { id: "1", recipe_part_id: "p", raw_material_id: "mel", quantity: 1000, unit: "g" },
      { id: "2", recipe_part_id: "p", raw_material_id: "deig", quantity: 500, unit: "g" },
    ] } as unknown as LinkedRecipe;
    const b = buildRecipeBasis(null, recipe, map);
    expect(b.cost?.incomplete).toBe(true);
    expect(b.basis.costPerUnit ?? null).toBeNull();
  });
  it("åpen kalkylespørring invalideres når råvarens pris endres (stale cache vises ikke som aktuell)", async () => {
    const qc = new QueryClient();
    let calls = 0;
    const obs = new QueryObserver(qc, { queryKey: BAKERS_RM_KEY("le"), queryFn: async () => ++calls, staleTime: Infinity });
    const unsub = obs.subscribe(() => undefined);
    await vi.waitFor(() => expect(calls).toBe(1));
    invalidateRawMaterial(qc, "rm1");
    await vi.waitFor(() => expect(calls).toBe(2));
    for (const k of [["product-cost-cache", "le"], ["product-recipe-link", "p"], ["product-margins", "p"]]) {
      qc.setQueryData(k, 1);
      invalidateRawMaterial(qc);
      expect(qc.getQueryState(k)?.isInvalidated).toBe(true);
    }
    unsub();
  });
});

const row = (o: Partial<TimelineHistoryRow> & { id: string; effective_date: string; price: number }): TimelineHistoryRow =>
  ({ supplier_id: "s1", source: "invoice", invoice_id: null, currency: "NOK", unit: "kg", unitSource: "fakturalinje", ...o });

describe("3) historisk grunnlag i graf og CSV", () => {
  it("samme dag med omvendt id: registreringstid styrer, både graf og CSV", () => {
    const h = [row({ id: "a", effective_date: "2026-05-01", price: 12, createdAt: "2026-05-01T09:00:00Z" }),
      row({ id: "z", effective_date: "2026-05-01", price: 10, createdAt: "2026-05-01T08:00:00Z" })];
    const r = buildTimeline({ history: h, supplierNames: new Map([["s1", "A"]]), links: [], currentUnit: "kg" });
    expect(r.series[0].points.map((p) => p.id)).toEqual(["z", "a"]);
    expect(r.series[0].points[1].deltaPrevKr).toBe(2);
    expect(r.rows.map((p) => p.id)).toEqual(["a", "z"]);
  });
  it("blandede enheter og ukjent enhet er ikke sammenlignbare", () => {
    const r = buildTimeline({ history: PRICE_HISTORY_FIXTURE, supplierNames: new Map([["s1", "Regal"]]), links: [], currentUnit: "kg" });
    const kinds = Object.fromEntries(r.events.map((e) => [e.id, e.kind]));
    expect(kinds["g-gram"]).toBe("annen_enhet");
    expect(kinds["m-manual"]).toBe("ukjent_enhet");
    expect(kinds["e-eur"]).toBe("annen_valuta");
    expect(r.rows.every((p) => p.unit === "kg" && p.currency === "NOK")).toBe(true);
  });
  it("eksakt CSV", () => {
    const h = [
      row({ id: "a", effective_date: "2026-05-01", price: 12, createdAt: "2026-05-01T09:00:00Z", packageText: "25 kg", invoiceNumber: "F-2",
        corrections: [{ at: "2026-05-02T10:00:00Z", reason: null, fields: [{ field: "Mengde", before: "10 000", after: "10" }] }] }),
      row({ id: "z", effective_date: "2026-05-01", price: 10, createdAt: "2026-05-01T08:00:00Z" }),
      row({ id: "u", effective_date: "2026-04-01", price: 9, unit: null, unitSource: null, source: "manual" }),
    ];
    const r = buildTimeline({ history: h, supplierNames: new Map([["s1", "A"]]), links: [], currentUnit: "kg" });
    expect(timelineCsv(r.rows, r.events).split("\n")).toEqual([
      "Type;Dato;Registrert;Leverandør;Pris;Valuta;Enhet (historisk);Enhetsgrunnlag;Pakning (historisk);Kilde;Faktura;Δ forrige kr;Δ forrige %;Δ avtale %;Årsak;Utgått;Rettelse før → etter;Notat",
      "Gyldig;2026-05-01;2026-05-01T09:00:00Z;A;12.0000;NOK;kg;Fakturalinjens pris per grunnenhet;25 kg;Faktura;F-2;2.0000;20.0;;;;Mengde: 10 000 → 10;",
      "Gyldig;2026-05-01;2026-05-01T08:00:00Z;A;10.0000;NOK;kg;Fakturalinjens pris per grunnenhet;Ukjent;Faktura;;;;;;;;",
      "Enhet ikke dokumentert;2026-04-01;;A;9.0000;NOK;Ukjent;Ukjent;Ukjent;Manuell;;;;;;;;",
    ]);
  });
  it("proveniens: enhetsbytte, fakturalinje, etter vakt, ellers ukjent", () => {
    const base = { price: 10, currency: "NOK", isLegacy: false, supersededReason: null, line: null, invoiceCurrency: null, currentUnit: "kg", unitChanges: [] };
    expect(resolveProvenance({ ...base, createdAt: "2026-01-01T00:00:00Z" }).unit).toBeNull();
    expect(resolveProvenance({ ...base, createdAt: BASE_UNIT_GUARD_SINCE }).unit).toBe("kg");
    expect(resolveProvenance({ ...base, createdAt: "2026-01-01T00:00:00Z", line: { unit: "sekk", package_size: 25, package_unit: "kg", count_per_package: null, price_per_base_unit: 10.02 } }))
      .toMatchObject({ unit: "kg", unitSource: "fakturalinje", packageText: "25 kg" });
    const changes = [{ at: "2026-06-01T00:00:00Z", old: "g", new: "kg" }];
    expect(resolveProvenance({ ...base, createdAt: "2026-05-01T00:00:00Z", unitChanges: changes }).unit).toBe("g");
    expect(resolveProvenance({ ...base, createdAt: "2026-07-01T00:00:00Z", unitChanges: changes }).unit).toBe("kg");
    expect(resolveProvenance({ ...base, createdAt: BASE_UNIT_GUARD_SINCE, isLegacy: true }).unit).toBeNull();
  });
});

describe("3) fetchPriceHistory: 1000+ rader og metadata", () => {
  beforeEach(() => {
    tables.raw_material_price_history = Array.from({ length: 1234 }, (_, i) => ({
      id: `h${i}`, raw_material_id: "rm1", supplier_id: "s1", price: 10, effective_date: "2026-01-01", source: "invoice",
      source_reference: null, invoice_id: i === 0 ? "inv1" : null, invoice_line_id: i === 0 ? "il1" : null, invoice_line_ref: null, notes: null,
      created_at: "2026-01-01T00:00:00Z", superseded_at: null, superseded_reason: null, is_legacy: false, is_credit: false, currency: "NOK",
    }));
    tables.raw_materials = [{ id: "rm1", base_unit: "kg" }];
    tables.audit_log = [];
    tables.invoices = [{ id: "inv1", invoice_number: "F-1", is_credit_note: false, currency: "NOK" }];
    tables.invoice_lines = [{ id: "il1", unit: "sekk", package_size: 25, package_unit: "kg", count_per_package: null, price_per_base_unit: 10 }];
    tables.invoice_line_corrections = [{ invoice_line_id: "il1", corrected_at: "2026-01-02T00:00:00Z", reason: "Rettet", changed_fields: ["quantity"], original: { quantity: 10000 }, corrected: { quantity: 10 } }];
  });
  it("henter alle sider og gir historisk grunnlag bare der det finnes", async () => {
    const rows = await fetchPriceHistory("rm1");
    expect(rows).toHaveLength(1234);
    expect(rows[0].invoices?.invoice_number).toBe("F-1");
    expect(rows[0].provenance).toMatchObject({ unit: "kg", packageText: "25 kg", currency: "NOK" });
    expect(rows[0].provenance.corrections[0].fields[0]).toEqual({ field: "Mengde", before: "10 000", after: "10" });
    expect(rows[1].provenance.unit).toBeNull();
  });
});
