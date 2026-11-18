// «Nullstill køen» – én test per regel (bestilling 18.11.2026), inkludert 20 %-vakten i regel 3 og duplikatvakten i regel 4.
import { describe, expect, it } from "vitest";
import { classify, planPhase1, planPhase2, withinPackageGuard } from "./plan";
import { CLOSE_TEXT, NEW_ITEM_CATEGORY, type Catalog, type SnapLine } from "./types";

const SA = "sup-asko";
let n = 0;
function line(o: Partial<SnapLine> = {}): SnapLine {
  n++;
  return {
    line_id: `l${String(n).padStart(3, "0")}`, invoice_id: o.invoice_id ?? `inv${n}`, invoice_number: `F${n}`, invoice_date: "2026-11-01",
    supplier_id: SA, supplier_name: "ASKO", lines_sum_status: "ok", is_credit_note: false, approved: false, cost_posted: false,
    item_key: "sku:9727", supplier_sku: "9727", description: "Hvetemel 25 kg", quantity: 2, unit: "sekk", unit_price: 250, total_amount: 500,
    discount_amount: null, unit_price_basis: null, line_kind: "vare", extraction_issues: [], package_size: 25, package_unit: "kg", count_per_package: null,
    raw_material_id: null, match_confidence: "unmatched", review_reason: "unmatched", price_per_base_unit: null, expected_price_per_base_unit: null,
    price_variance_pct: null, line_updated_at: "2026-11-18 10:00:00.123456+00", read_issue: null, exclusion_blocker: null, rm_name: null, rm_base_unit: null, rm_cost: null, rm_active: true,
    ...o,
  };
}
const linked = (o: Partial<SnapLine> = {}) => line({ raw_material_id: "rm-hvete", rm_name: "Hvetemel", rm_base_unit: "kg", rm_cost: 10, match_confidence: "auto_high", ...o });
const cat = (links: Catalog["links"] = [], rule: string | null = null): Catalog => ({ suppliers: [{ id: SA, name: "ASKO", new_item_type: rule }], links });
const only = (ls: SnapLine[], c = cat()) => classify(ls, c);

describe("Regel 1 – ukoblet ikke-varelinje", () => {
  it("pant/gebyr/annet blir «ikke vare» med regel for varenøkkelen", () => {
    const r = only([line({ item_key: "sku:p1", supplier_sku: "P1", description: "Pant", line_kind: "pant", unit: "stk", quantity: 1, unit_price: 2, total_amount: 2, package_size: null, package_unit: null })]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ rule: 1, action: "ikke_vare", item_key: "sku:p1" });
  });
  it("deler varenøkkelen med en vare → regel 6 (ingen regel som kan skjule varen)", () => {
    const r = only([line({ line_kind: "gebyr" }), line()]);
    expect(r.items.some((i) => i.rule === 1)).toBe(false);
    expect(r.closes.find((c) => c.reason_code === "blandet_varenokkel")).toBeTruthy();
  });
});

describe("Regel 2 – bare prisårsak, |avvik| ≤ 20 %", () => {
  const p = (pct: number, o: Partial<SnapLine> = {}) => linked({ review_reason: "price_variance", price_variance_pct: pct, price_per_base_unit: 10 * (1 + pct / 100), expected_price_per_base_unit: 10, ...o });
  it("15 % godtas («prisen stemmer»)", () => {
    const r = only([p(15)]);
    expect(r.items[0]).toMatchObject({ rule: 2, action: "godta_pris", raw_material_id: "rm-hvete" });
    expect(r.items[0].payload.lines?.[0].price_per_base_unit).toBeCloseTo(11.5);
  });
  it("20 % er med, 20,1 % er prishopp → regel 6", () => {
    expect(only([p(20)]).items[0]?.rule).toBe(2);
    const r = only([p(-20.1)]);
    expect(r.items).toHaveLength(0);
    expect(r.closes[0].reason_code).toBe("prishopp_over_20");
  });
  it("internt godkjent faktura kan ikke få godtatt pris → regel 6", () => {
    expect(only([p(5, { approved: true })]).closes[0].reason_code).toBe("godkjent_faktura");
  });
  it("prisårsak sammen med en annen årsak er ikke regel 2", () => {
    expect(only([p(5, { review_reason: "price_variance,recalculation_pending" })]).closes[0].reason_code).toBe("beregnes_pa_nytt");
  });
});

describe("Regel 3 – koblet, mangler pakning/grunnlag", () => {
  const pk = (o: Partial<SnapLine> = {}) => linked({ review_reason: "unknown_package_size", ...o });
  it("pakningen leses entydig og prisen ligger innenfor ±20 % → bekreft pakning", () => {
    const r = only([pk(), pk({ review_reason: "no_automatic_basis" })]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ rule: 3, action: "bekreft_pakning", raw_material_id: "rm-hvete" });
    expect(r.items[0].payload.package).toMatchObject({ package_size: 25, package_unit: "kg", base_units_per_package: 25 });
    expect(r.items[0].line_ids).toHaveLength(2);
  });
  it("20 %-vakten: 10 kr/kg mot kostpris 8 (+25 %) → regel 6, 9,60 (+20 %) er med", () => {
    const over = only([pk({ rm_cost: 8 })]);
    expect(over.items).toHaveLength(0);
    expect(over.closes[0].reason_code).toBe("pris_utenfor_20");
    expect(over.closes[0].detail).toContain("+25");
    expect(only([pk({ rm_cost: 10 / 1.2 })]).items[0]?.rule).toBe(3);
    expect(withinPackageGuard(12.01, 10)).toBe(false);
    expect(withinPackageGuard(8, 10)).toBe(true);
  });
  it("varen har ingen kostpris → pakningen bekreftes", () => {
    expect(only([pk({ rm_cost: null })]).items[0]?.rule).toBe(3);
  });
  it("ulik pakning på linjene for samme leverandørvare → alle til regel 6", () => {
    const r = only([pk(), pk({ package_size: 20, description: "Hvetemel 20 kg", unit_price: 200, total_amount: 400 })]);
    expect(r.items).toHaveLength(0);
    expect(r.closes.every((c) => c.reason_code === "pakning_ulik")).toBe(true);
  });
  it("fakturert per stk, varen i liter: den trykte pakningen (4 l) brukes, ikke «1 stk»", () => {
    const r = only([pk({ unit: "stk", quantity: 4, unit_price: 388.48, total_amount: 1553.92, package_size: 4, package_unit: "l", description: "TINE Klaret smør 4l", rm_base_unit: "l", rm_cost: 95 })]);
    expect(r.items[0]).toMatchObject({ rule: 3, action: "bekreft_pakning" });
    expect(r.items[0].payload.package).toMatchObject({ base_units_per_package: 4 });
    expect(r.items[0].prices[0].ppb).toBeCloseTo(97.12);
  });
  it("linje uten noe i regnestykket (pris per kg på eske-linje) er regnefeil → regel 6", () => {
    expect(only([pk({ quantity: 20, unit: "eske", unit_price: 31.68, total_amount: 6336, package_size: 5, package_unit: "kg", count_per_package: 2 })]).closes[0].reason_code).toBe("lesevarsel");
  });
  it("pakning som bare står i varenavnet er ikke entydig → regel 6", () => {
    expect(only([pk({ package_size: null, package_unit: null })]).closes[0].reason_code).toBe("pakning_uleselig");
  });
});

describe("Regel 4 – ukoblet varelinje med ren lesing, varenummer og pakning", () => {
  const rug = (o: Partial<SnapLine> = {}) => line({ item_key: "sku:5555", supplier_sku: "5555", description: "RUGMEL GROV 10 KG", package_size: 10, unit_price: 100, total_amount: 200, ...o });
  it("varenummeret finnes hos leverandøren (også lært) → koble", () => {
    const r = only([rug()], cat([{ supplier_id: SA, raw_material_id: "rm-rug", name: "Rugmel grovt", base_unit: "kg", is_active: true, cost: 9, skus: ["x1", "5555"] }]));
    expect(r.items[0]).toMatchObject({ rule: 4, action: "koble", raw_material_id: "rm-rug" });
    expect(r.items[0].payload.package?.base_units_per_package).toBe(10);
  });
  it("ellers opprettes ny vare: ryddet navn, leverandørens varetype, merket «Ny fra faktura»", () => {
    const r = only([rug()], cat([], "videresalg"));
    expect(r.items[0]).toMatchObject({ rule: 4, action: "opprett" });
    expect(r.items[0].payload.new_raw_material).toEqual({ name: "Rugmel grov", base_unit: "kg", item_type: "videresalg", category: NEW_ITEM_CATEGORY });
  });
  it("duplikatvakt: aktiv vare med svært likt navn hos leverandøren → regel 6 «mulig duplikat»", () => {
    const r = only([rug()], cat([{ supplier_id: SA, raw_material_id: "rm-x", name: "Rugmel grov", base_unit: "kg", is_active: true, cost: 9, skus: ["1234"] }]));
    expect(r.items).toHaveLength(0);
    expect(r.closes[0]).toMatchObject({ reason_code: "mulig_duplikat", detail: "ligner «Rugmel grov»" });
  });
  it("duplikatvakt ignorerer inaktive varer og andre leverandører", () => {
    const r = only([rug()], cat([
      { supplier_id: SA, raw_material_id: "rm-x", name: "Rugmel grov", base_unit: "kg", is_active: false, cost: 9, skus: [] },
      { supplier_id: "annen", raw_material_id: "rm-y", name: "Rugmel grov", base_unit: "kg", is_active: true, cost: 9, skus: [] },
    ]));
    expect(r.items[0]?.action).toBe("opprett");
  });
  it("to nye varer med nesten likt navn i samme kjøring → bare den første opprettes", () => {
    const r = only([rug(), rug({ item_key: "sku:5556", supplier_sku: "5556", description: "Rugmel grov 10 kg", invoice_date: "2026-11-05" })]);
    expect(r.items.filter((i) => i.action === "opprett")).toHaveLength(1);
    expect(r.closes[0].reason_code).toBe("mulig_duplikat");
  });
  it("uten varenummer, med lesevarsel eller uten lesbar pakning → regel 6", () => {
    expect(only([rug({ item_key: "name:rugmel", supplier_sku: null })]).closes[0].reason_code).toBe("uten_varenummer");
    expect(only([rug({ extraction_issues: [{ message: "Tallene går ikke opp" }] })]).closes[0].reason_code).toBe("lesevarsel");
    expect(only([rug({ total_amount: 260 })]).closes[0].reason_code).toBe("lesevarsel");
    expect(only([rug({ package_size: null, package_unit: null, description: "Rugmel" })]).closes[0].reason_code).toBe("pakning_uleselig");
  });
  it("flere aktive varer med samme varenummer → regel 6", () => {
    const l = (id: string) => ({ supplier_id: SA, raw_material_id: id, name: id, base_unit: "kg", is_active: true, cost: null, skus: ["5555"] });
    expect(only([rug()], cat([l("a"), l("b")])).closes[0].reason_code).toBe("flere_varer");
  });
});

describe("Regel 5 – sumavvik på fakturaen", () => {
  it("linjene røres ikke av regel 1–4, selv om de ellers ville vært regel 2", () => {
    const r = only([linked({ lines_sum_status: "mismatch", review_reason: "price_variance", price_variance_pct: 3, price_per_base_unit: 10.3, expected_price_per_base_unit: 10 })]);
    expect(r.items).toHaveLength(0);
    expect(r.closes[0].reason_code).toBe("sumavvik");
  });
});

describe("Regel 6 – alt annet lukkes via hold utenfor", () => {
  it("lukkes med egen tekst, én linje per steg, med versjon for hold utenfor", () => {
    const l = linked({ review_reason: "package_conflict" });
    const r = only([l]);
    expect(r.closes[0]).toMatchObject({ rule: 6, action: "hold_utenfor", line_ids: [l.line_id], reason_code: "annen_arsak" });
    expect(r.closes[0].payload.reason_text?.startsWith(CLOSE_TEXT)).toBe(true);
    expect(r.closes[0].payload).toMatchObject({ invoice_id: l.invoice_id, line_updated_at: l.line_updated_at });
  });
  it("fase 2: bare linjer i utvalget; prisavvik ≤ 20 % godtas, resten avsluttes – regel 6 først", () => {
    const keep = linked({ review_reason: "price_variance", price_variance_pct: 8, price_per_base_unit: 10.8, expected_price_per_base_unit: 10 });
    const rest = linked({ review_reason: "unknown_package_size" });
    const fresh = line({ item_key: "sku:ny" });
    const items = planPhase2([keep, rest, fresh], new Set([keep.line_id, rest.line_id]), cat());
    expect(items.map((i) => i.rule)).toEqual([6, 2]);
    expect(items[0]).toMatchObject({ reason_code: "apen_etter_fase_1", line_ids: [rest.line_id] });
    expect(items.flatMap((i) => i.line_ids)).not.toContain(fresh.line_id);
  });
});

describe("Regel 6 – serverens sperre for «hold utenfor»", () => {
  it("linje med lagerbevegelse eller ført kostpris får ingen handling og blir stående åpen", () => {
    const l = linked({ review_reason: "price_variance", price_variance_pct: 40, price_per_base_unit: 14, expected_price_per_base_unit: 10, exclusion_blocker: "lagerbevegelse" });
    const p = planPhase1([l], cat());
    expect(p.items).toHaveLength(0);
    expect(p.closes).toHaveLength(0);
    expect(p.leftOpen[0]).toMatchObject({ line_id: l.line_id, blocker: "lagerbevegelse", reason_code: "prishopp_over_20" });
    expect(planPhase2([l], new Set([l.line_id]), cat())).toHaveLength(0);
  });
});

describe("Forhåndsvisning", () => {
  it("tall per regel, anslått ny kostpris og nye varer; hver linje høyst én gang", () => {
    const ls = [
      linked({ review_reason: "price_variance", price_variance_pct: 10, price_per_base_unit: 11, expected_price_per_base_unit: 10 }),
      line({ item_key: "sku:5555", supplier_sku: "5555", description: "Rugmel grov 10 kg", package_size: 10, unit_price: 100, total_amount: 200 }),
      line({ item_key: "name:x", supplier_sku: null }),
    ];
    const p = planPhase1(ls, cat());
    expect(p.totals[2]).toMatchObject({ lines: 1, supplierItems: 1, rawMaterials: 1 });
    expect(p.totals[4]).toMatchObject({ lines: 1, newItems: 1 });
    expect(p.totals[6].lines).toBe(1);
    expect(p.costChanges[0]).toMatchObject({ raw_material_id: "rm-hvete", before: 10, after: 11 });
    expect(p.costChanges[0].pct).toBeCloseTo(10);
    expect(p.creations[0]).toMatchObject({ name: "Rugmel grov", price: 10 });
    const ids = [...p.items, ...p.closes].flatMap((i) => i.line_ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids, ...p.leftOpen.map((x) => x.line_id)].sort()).toEqual(p.snapshotIds);
    expect(planPhase1(ls, cat()).fingerprint).toBe(p.fingerprint);
  });
});
