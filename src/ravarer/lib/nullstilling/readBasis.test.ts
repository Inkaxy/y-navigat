// «Nullstill køen» – romsligere regler (Henriks valg 18.11.2026): A pakning i varenavnet, B pris per kg/l på kolli-linje
// (én test per forklaring + flertydighet), C sprik i pris på tvers av linjer.
import { describe, expect, it } from "vitest";
import { classify, planPhase1 } from "./plan";
import { namePackage, priceSpread } from "./readBasis";
import type { Catalog, SnapLine } from "./types";

const SA = "sup-asko";
let n = 0;
function line(o: Partial<SnapLine> = {}): SnapLine {
  n++;
  return {
    line_id: `b${String(n).padStart(3, "0")}`, invoice_id: o.invoice_id ?? `binv${n}`, invoice_number: `B${n}`, invoice_date: "2026-11-01",
    supplier_id: SA, supplier_name: "ASKO", lines_sum_status: "ok", is_credit_note: false, approved: false, cost_posted: false,
    item_key: "sku:1000", supplier_sku: "1000", description: "Vare", quantity: 1, unit: "eske", unit_price: 100, total_amount: 100,
    discount_amount: null, unit_price_basis: null, line_kind: "vare", extraction_issues: [], package_size: null, package_unit: null, count_per_package: null,
    raw_material_id: null, match_confidence: "unmatched", review_reason: "unmatched", price_per_base_unit: null, expected_price_per_base_unit: null,
    price_variance_pct: null, line_updated_at: "2026-11-18 10:00:00.123456+00", invoice_read_codes: [], exclusion_blocker: null,
    rm_name: null, rm_base_unit: null, rm_cost: null, rm_active: true, ...o,
  };
}
const REG = [{ code: "regnestykke", message: "Mengde × pris stemmer ikke med linjesummen." }];
/** Koblet, mangler pakning, med lagret regnestykke-varsel (slik databasen merker linjen). */
const pk = (o: Partial<SnapLine> = {}) => line({ raw_material_id: "rm-1", rm_name: "Vare", rm_base_unit: "kg", rm_cost: null, match_confidence: "auto_high",
  review_reason: "unknown_package_size,extraction_issue", extraction_issues: REG, ...o });
const cat: Catalog = { suppliers: [{ id: SA, name: "ASKO", new_item_type: null }], links: [] };
const run = (ls: SnapLine[]) => classify(ls, cat);

describe("B – pris per kg/l på kolli-linje regnes som ren lesing når nøyaktig én forklaring går opp", () => {
  it("(1) antall × pakningsmengde × enhetspris: 8 esker à 2 × 5 kg × 145,55 kr/kg = 11 643,60", () => {
    const l = pk({ quantity: 8, unit: "eske", unit_price: 145.55, total_amount: 11643.6, package_size: 5, package_unit: "kg", count_per_package: 2, description: "Odense kranse XX, kartong 2 x 5 kg" });
    const r = run([l]);
    expect(r.items[0]).toMatchObject({ rule: 3, action: "bekreft_pakning" });
    expect(r.items[0].payload.package?.base_units_per_package).toBe(10);
    expect(r.items[0].payload.lesegrunnlag?.[l.line_id]).toEqual({ f: 1, pakning: "lest" });
    expect(r.items[0].prices[0].ppb).toBeCloseTo(145.545, 3);
    // Lesevarselet står på serveren: ingen prisobservasjon, derfor ikke med i kostanslaget.
    expect(r.items[0].prices[0].obs).toBe(false);
    expect(planPhase1([l], cat).costChanges).toHaveLength(0);
  });
  it("(2) antall × enhetspris − rabatt: 6 esker à 1 224,50 = 7 347,00 med lagret varsel", () => {
    const l = pk({ quantity: 6, unit_price: 1224.5, total_amount: 7347, package_size: 10, package_unit: "kg", description: "Valnøtter, kartong 10 kg" });
    expect(run([l]).items[0].payload.lesegrunnlag?.[l.line_id]).toEqual({ f: 2, pakning: "lest" });
    const d = pk({ quantity: 2, unit_price: 100, discount_amount: 15, total_amount: 185, package_size: 10, package_unit: "kg" });
    expect(run([d]).items[0].payload.lesegrunnlag?.[d.line_id]?.f).toBe(2);
  });
  it("(3) (linjesum + rabatt) ÷ enhetspris = n = antall × stk i pakningen: 2 pakker à 8 × 600 g", () => {
    const l = line({ quantity: 2, unit: "pakke", unit_price: 98.88, discount_amount: 87.01, total_amount: 1495.04, package_size: 600, package_unit: "g",
      count_per_package: 8, description: "KYLLING LÅRFILET 600G FAVORITT", item_key: "sku:7001", supplier_sku: "7001", review_reason: "unmatched,extraction_issue", extraction_issues: REG });
    const r = run([l]);
    expect(r.items[0]).toMatchObject({ rule: 4, action: "opprett" });
    expect(r.items[0].payload.lesegrunnlag?.[l.line_id]).toEqual({ f: 3, pakning: "lest" });
    // Antallet på linjen endres ikke: prisen er sum ÷ (2 × 4,8 kg).
    expect(r.items[0].prices[0].ppb).toBeCloseTo(1495.04 / 9.6, 4);
  });
  it("(3) krever trykt stk per pakning: 1 flaske lest, 6 fakturert, uten antall per pakning → regel 6", () => {
    const l = pk({ quantity: 1, unit: "flaske", unit_price: 90.41, total_amount: 542.46, package_size: 0.7, package_unit: "l", rm_base_unit: "l" });
    expect(run([l]).closes[0].reason_code).toBe("regnestykke_uforklart");
  });
  it("flertydighet: passer flere forklaringer med ulik pris, er linjen ikke ren", () => {
    // 1 eske à 1,00 = 2,00 med 2 × 1,25 kg: (1) gir 1,00 kr/kg, (2) 0,40 kr/kg, (3) 0,80 kr/kg – alle innenfor 1 kr.
    const l = pk({ quantity: 1, unit_price: 1, total_amount: 2, package_size: 1.25, package_unit: "kg", count_per_package: 2 });
    const r = run([l]);
    expect(r.items).toHaveLength(0);
    expect(r.closes[0].reason_code).toBe("regnestykke_flertydig");
  });
  it("andre varsler gjør linjen uren selv om regnestykket kan forklares", () => {
    const base = { quantity: 8, unit_price: 145.55, total_amount: 11643.6, package_size: 5, package_unit: "kg", count_per_package: 2 };
    for (const code of ["ugyldig_tall", "mengde_eller_pris_mangler", "prisgrunnlag_uavklart", "mulig_rabatt"]) {
      expect(run([pk({ ...base, extraction_issues: [...REG, { code, message: "x" }] })]).closes[0].reason_code).toBe("lesevarsel");
    }
    expect(run([pk({ ...base, unit_price_basis: "l" })]).closes[0].reason_code).toBe("lesevarsel");
  });
  it("lesevarsel på fakturaen (sumavvik etter gjenlesing) gjør linjen uren; oppsummeringen «reread_warning» alene gjør det ikke", () => {
    const base = { quantity: 2, unit_price: 250, total_amount: 500, package_size: 25, package_unit: "kg", extraction_issues: [], review_reason: "unknown_package_size" };
    expect(run([pk({ ...base, invoice_read_codes: ["reread_sum_mismatch", "reread_warning"] })]).closes[0].reason_code).toBe("lesevarsel_faktura");
    expect(run([pk({ ...base, invoice_read_codes: ["reread_warning"] })]).items[0]?.rule).toBe(3);
  });
});

describe("A – pakning i varenavnet (eksisterende tolkning)", () => {
  it("tydelige mønstre leses", () => {
    expect(namePackage("Hvetemel kartong 10 kg")).toMatchObject({ size: 10, unit: "kg", count: 1 });
    expect(namePackage("Mel sekk 25kg")).toMatchObject({ size: 25, unit: "kg", count: 1 });
    expect(namePackage("Likør 6 x 0,7 l")).toMatchObject({ size: 0.7, unit: "l", count: 6 });
    expect(namePackage("Ost 2 x 5 kg")).toMatchObject({ size: 5, unit: "kg", count: 2 });
    expect(namePackage("Margarin 2,5kg 4x2,5kg")).toMatchObject({ size: 2.5, count: 4 });
  });
  it("flere ulike mengder uten tydelig struktur er flertydig → regel 6", () => {
    expect(namePackage("OST 10 KG EMB 500 G")).toBe("flertydig");
    expect(namePackage("Sjokolade 500 g 1 l")).toBe("flertydig");
    const r = run([pk({ quantity: 2, unit_price: 250, total_amount: 500, extraction_issues: [], review_reason: "unknown_package_size", description: "OST 10 KG EMB 500 G" })]);
    expect(r.closes[0].reason_code).toBe("pakning_flertydig");
  });
  it("«120 stk» alene leses ikke av den eksisterende tolkningen (ingen ny parser)", () => {
    expect(namePackage("Servietter 120 stk")).toBeNull();
  });
  it("motsies av lest antall per pakning → regel 6", () => {
    const r = run([pk({ quantity: 2, unit_price: 500, total_amount: 1000, extraction_issues: [], review_reason: "unknown_package_size", description: "Ost 2 x 5 kg", count_per_package: 10 })]);
    expect(r.closes[0].reason_code).toBe("pakning_motsagt");
  });
  it("motsies av en annen linje for samme leverandørvare → alle til regel 6", () => {
    const a = pk({ quantity: 2, unit_price: 250, total_amount: 500, extraction_issues: [], review_reason: "unknown_package_size", description: "Mel 25 kg" });
    const b = pk({ quantity: 2, unit_price: 200, total_amount: 400, extraction_issues: [], review_reason: "unknown_package_size", description: "Mel", package_size: 20, package_unit: "kg" });
    expect(run([a, b]).closes.map((c) => c.reason_code)).toEqual(["pakning_ulik", "pakning_ulik"]);
  });
});

describe("C – vare uten kostpris og nye varer: prisen må være lik (±20 %) på tvers av linjene", () => {
  const p3 = (total: number) => pk({ quantity: 1, unit_price: total, total_amount: total, package_size: 10, package_unit: "kg", extraction_issues: [], review_reason: "unknown_package_size" });
  it("regel 3 uten kostpris: 10 og 12,50 kr/kg (+25 %) spriker → regel 6; 10 og 11,90 er med", () => {
    const r = run([p3(100), p3(125)]);
    expect(r.items).toHaveLength(0);
    expect(r.closes.map((c) => c.reason_code)).toEqual(["pris_sprik", "pris_sprik"]);
    expect(r.closes[0].detail).toContain("+25");
    expect(run([p3(100), p3(119)]).items[0]?.rule).toBe(3);
  });
  it("regel 3 med kostpris bruker vakten mot kostprisen per linje, ikke sprik", () => {
    const r = run([{ ...p3(100), rm_cost: 11 }, { ...p3(125), rm_cost: 11 }]);
    expect(r.items[0]?.line_ids).toHaveLength(2);
  });
  it("regel 4 ny vare: sprik mellom linjene → regel 6", () => {
    const nl = (total: number) => line({ item_key: "sku:5555", supplier_sku: "5555", description: "Rugmel 10 kg", quantity: 1, unit: "sekk", unit_price: total, total_amount: total, package_size: 10, package_unit: "kg" });
    const r = run([nl(100), nl(130)]);
    expect(r.items).toHaveLength(0);
    expect(r.closes.every((c) => c.reason_code === "pris_sprik")).toBe(true);
    expect(run([nl(100), nl(110)]).items[0]).toMatchObject({ rule: 4, action: "opprett" });
  });
  it("priceSpread: største ÷ minste − 1 over 20 %", () => {
    expect(priceSpread([10])).toBeNull();
    expect(priceSpread([10, 12])?.spread).toBe(false);
    expect(priceSpread([10, 12.01])?.spread).toBe(true);
  });
});
