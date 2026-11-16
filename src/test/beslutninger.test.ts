import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import { WORK_ITEM_EFFECT_DEFAULTS } from "@/ravarer/lib/workRpcTypes";
import {
  decisionTypeOf, decisionsFromWork, extraDecisions, openQuestionCount, solvesText, sortDecisions, decisionQuestion,
  SUSPICIOUS_JUMP_PCT, type RawMaterialReadiness,
} from "@/ravarer/lib/decisions";
import { priceFacts, refineType } from "@/ravarer/lib/decisionFacts";
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { inquiryChangeText, buildSupplierCaseDraft } from "@/fakturaer/lib/supplierCaseDraft";
import { safeReturnPath, fakturaReturn } from "@/ravarer/pages/priskontroll/fakturaer/visning";

const wi = (p: Partial<WorkItem>): WorkItem => ({
  key: "varekort:s1:sku:1", grp: "pris", type: "varekort", kind: "prisavvik", supplier_id: "s1", supplier_name: "TINE", item_key: "sku:1",
  invoice_id: null, invoice_number: null, title: "Smør usaltet 10 kg", sku: "1", rm_id: "rm1", rm_name: "Smør", open_lines: 9, open_invoices: 4,
  invoice_count: 12, amount: 0, impact_nok: 480, last_date: "2026-11-10", last_open_line_id: null, reasons: ["price_increase"],
  first_open_date: "2026-11-03", ...WORK_ITEM_EFFECT_DEFAULTS, effect_status: "verified_price_effect", ...p,
});

describe("Beslutninger: spørsmålstype", () => {
  it("pris, over avtale, pakning, ukjent vare", () => {
    expect(decisionTypeOf(wi({}))).toBe("pris");
    expect(decisionTypeOf(wi({ reasons: ["agreement_conflict"] }))).toBe("over_avtale");
    expect(decisionTypeOf(wi({ kind: "mangler_pakning", grp: "pakning" }))).toBe("pakning");
    expect(decisionTypeOf(wi({ kind: "ukoblet", grp: "kobling", title: "Bakepapir 40×60 500 ark" }))).toBe("ukjent_vare");
  });
  it("pant er følgevare, paller/miljøvederlag/frakt/gebyr kan hoppes over", () => {
    expect(decisionTypeOf(wi({ kind: "ukoblet", title: "Pant flaske 0,5 l" }))).toBe("pant");
    for (const t of ["EUR-pall", "Miljøvederlag", "Frakt", "Fakturagebyr", "Paller retur"]) expect(decisionTypeOf(wi({ kind: "ukoblet", title: t }))).toBe("hopp_over");
    // «Pantry»/«Fraktur» er ikke pant/frakt.
    expect(decisionTypeOf(wi({ kind: "ukoblet", title: "Pantry mix" }))).toBe("ukjent_vare");
  });
  it("faktura som ikke kan leses; godkjenning og flagg er ikke spørsmål", () => {
    const f = (kind: WorkItem["kind"]) => wi({ type: "faktura", grp: "fakturaer", kind, invoice_id: "i1", invoice_number: "5590213", supplier_name: "Idun" });
    expect(decisionTypeOf(f("faktura_mangler_linjer"))).toBe("kan_ikke_leses");
    expect(decisionTypeOf(f("faktura_sumavvik"))).toBe("kan_ikke_leses");
    expect(decisionTypeOf(f("faktura_klar"))).toBeNull();
    expect(decisionTypeOf(f("faktura_flagget"))).toBeNull();
    expect(decisionQuestion("kan_ikke_leses", f("faktura_mangler_linjer"))).toBe("Faktura 5590213 fra Idun lot seg ikke lese");
  });
  it("kontroll med lesevarsel = kan ikke leses", () => {
    expect(decisionTypeOf(wi({ kind: "kontroll", read_integrity: "needs_review" }))).toBe("kan_ikke_leses");
    expect(decisionTypeOf(wi({ kind: "kontroll", read_integrity: "checked" }))).toBe("kontroll");
  });
});

describe("Beslutninger: kø og tellere", () => {
  it("eldste fakturadato først, uansett leverandør og vare; ingen «venter bak»", () => {
    const ds = sortDecisions(decisionsFromWork([
      wi({ key: "a", first_open_date: "2026-11-03" }), wi({ key: "b", first_open_date: "2026-08-14", supplier_name: "Coca-Cola" }),
      wi({ key: "c", first_open_date: null, last_date: "2026-09-02" }),
    ]));
    expect(ds.map((d) => d.key)).toEqual(["b", "c", "a"]);
    expect(JSON.stringify(ds)).not.toMatch(/Venter bak/);
  });
  it("«løser X linjer på Y fakturaer»", () => {
    const [d] = decisionsFromWork([wi({})]);
    expect(solvesText(d)).toBe("Eldste faktura 03.11.2026 · Løser 9 linjer på 4 fakturaer");
  });
  it("menyteller = alle minus godkjenning og flagg; ukjent er null", () => {
    expect(openQuestionCount({ alle: 20, faktura_klar: 5, faktura_flagget: 3 })).toBe(12);
    expect(openQuestionCount(undefined)).toBeNull();
  });
  it("tilleggsspørsmål: videresalg uten vare, emballasje uten kalkyle, råvare uten allergenkontroll – rett etter sitt spørsmål", () => {
    const work = decisionsFromWork([wi({ key: "p", rm_id: "rm1" }), wi({ key: "q", rm_id: "rm2", first_open_date: "2026-11-04" }), wi({ key: "r", rm_id: "rm3", first_open_date: "2026-11-05" })]);
    const rms: RawMaterialReadiness[] = [
      { id: "rm1", name: "Smør", item_type: "ravare", allergens_reviewed_at: null, recipes: 14, sold_as_product: null, used_as_packaging: null },
      { id: "rm2", name: "Coca-Cola 0,5 l", item_type: "videresalg", allergens_reviewed_at: null, recipes: null, sold_as_product: false, used_as_packaging: null },
      { id: "rm3", name: "Kakeeske 20×20", item_type: "emballasje", allergens_reviewed_at: null, recipes: null, sold_as_product: null, used_as_packaging: false },
    ];
    const ex = extraDecisions(work, rms);
    expect(ex.map((d) => d.type)).toEqual(["ravare_ikke_klar", "videresalg", "emballasje"]);
    expect(ex[0].question).toBe("Smør brukes i 14 oppskrifter, men allergenene er ikke kontrollert");
    const sorted = sortDecisions([...work, ...ex]).map((d) => d.key);
    expect(sorted).toEqual(["p", "extra:ikke_klar:rm1", "q", "extra:videresalg:rm2", "r", "extra:emballasje:rm3"]);
    // Ukjent klarhet gir ikke spørsmål.
    expect(extraDecisions(work, [{ ...rms[1], sold_as_product: null }])).toEqual([]);
  });
});

const line = (p: Partial<SupplierItemLine>): SupplierItemLine => ({
  id: "l", invoice_id: "i", invoice_number: "1", invoice_date: "2026-10-20", invoice_status: "reconciled", flagged_at: null, is_credit_note: false,
  reconciled_mode: null, line_number: 1, supplier_sku: "1", description: "Smør", quantity: 4, unit: "krt", unit_price: 1030, total_amount: 4120,
  package_size: 10, package_unit: "kg", count_per_package: null, base_quantity: 40, price_per_base_unit: 98, expected_price_per_base_unit: null,
  price_variance_pct: null, variance_status: null, price_reference_source: "last_purchase", raw_material_id: "rm1", raw_material_name: "Smør",
  match_confidence: "manual", requires_review: false, review_reason: null, resolution_note: null, created_at: "2026-10-20T08:00:00Z", line_kind: "vare",
  cost_posted: true, in_price_history: true, ...p,
});

describe("Beslutninger: fakta til prisspørsmålet", () => {
  const lines = [
    line({ id: "a", invoice_id: "i0", invoice_date: "2026-10-20", price_per_base_unit: 98 }),
    line({ id: "b", invoice_id: "i1", invoice_date: "2026-11-03", price_per_base_unit: 103, requires_review: true, invoice_status: "needs_review", in_price_history: false }),
    line({ id: "c", invoice_id: "i2", invoice_date: "2026-11-05", price_per_base_unit: 103, requires_review: true, invoice_status: "needs_review", in_price_history: false }),
    line({ id: "d", invoice_id: "i3", invoice_date: "2026-11-10", price_per_base_unit: 104.5, requires_review: true, invoice_status: "needs_review", in_price_history: false }),
  ];
  it("kjøp i datorekkefølge, eldste åpne avgjøres nå, senere er bare åpne (ingen lås)", () => {
    const f = priceFacts(lines, "2026-11-16", { baseUnit: "kg" });
    expect(f.purchases.map((p) => [p.date, p.status])).toEqual([["2026-10-20", "godkjent"], ["2026-11-03", "na"], ["2026-11-05", "apen"], ["2026-11-10", "apen"]]);
    expect(f.changePct).toBe(5.1);
    expect(f.previous?.price).toBe(98);
  });
  it("regnestykket og sikkerhet", () => {
    const f = priceFacts(lines, "2026-11-16", { baseUnit: "kg" });
    expect(f.arithmetic[0]).toBe("4 krt × 10 kg = 40 kg");
    expect(f.arithmetic[1]).toMatch(/^4\s120,00 kr \/ 40 kg = 103,00 kr\/kg$/);
    expect(f.certainty).toBe("sikkert");
    expect(f.openExtraNok).toBe(400); // (103−98) × 80 kg på to åpne linjer med samme pris
  });
  it("stort hopp gjør pris til «Sjekk pakning»", () => {
    const f = priceFacts([lines[0], line({ id: "x", invoice_date: "2026-11-04", price_per_base_unit: 98 * (1 + SUSPICIOUS_JUMP_PCT / 100 + 0.05), requires_review: true, invoice_status: "needs_review" })], "2026-11-16");
    expect(refineType("pris", f)).toBe("sjekk_pakning");
    expect(refineType("pris", priceFacts(lines, "2026-11-16"))).toBe("pris");
  });
  it("lesevarsel gir usikkert", () => {
    const f = priceFacts([lines[0], { ...lines[1], extraction_issues: [{ code: "regnestykke" }] }], "2026-11-16");
    expect(f.certainty).toBe("usikkert");
  });
});

describe("Spør leverandøren: vennlig forespørsel (Henrik 16.11.2026)", () => {
  const l = { invoice_number: "8841207", invoice_date: "2026-11-03", item: "Smør", quantity: 40, unit: "kg", expected: 98, invoiced: 103, amount_excl_vat: 0, observed_excl_vat: 200, reference_source: "last_purchase" };
  it("teksten har økning i prosent og spør om det stemmer", () => {
    expect(inquiryChangeText([l])).toBe("Det er en økning på 5,1 %.");
    const d = buildSupplierCaseDraft({ supplier_name: "TINE", case_title: "Smør", kind: "price_inquiry", lines: [l], credited: 0 });
    expect(d.body).toContain("Vi har fått denne prisen inn i våre systemer. Det er en økning på 5,1 %. Vi kan ikke se at vi har blitt varslet om prisendring. Stemmer dette?");
    expect(d.body).not.toMatch(/kreditnota|krav om/i);
  });
  it("ukjent sammenligning gir nøytral tekst", () => expect(inquiryChangeText([{ ...l, expected: null }])).toBe("Det er en prisendring."));
});

describe("Retur fra fakturasiden", () => {
  it("Beslutninger er en trygg retur", () => {
    expect(safeReturnPath("/ravarer/beslutninger?valgt=varekort%3As1%3Asku%3A1")).not.toBeNull();
    expect(fakturaReturn("/ravarer/beslutninger").label).toBe("Beslutninger");
    expect(safeReturnPath("//evil/ravarer/beslutninger")).toBeNull();
  });
});

describe("Plassering", () => {
  it("Beslutninger står foran Varer i Råvarer-menyen, og Topbar er ikke endret", () => {
    const nav = readFileSync("src/components/layout/SubAppNav.tsx", "utf8");
    const view = nav.slice(nav.indexOf("export function RavarerNavView"));
    expect(view.indexOf('label: "Beslutninger"')).toBeGreaterThan(0);
    expect(view.indexOf('label: "Beslutninger"')).toBeLessThan(view.indexOf('label: "Varer"'));
    for (const l of ["Oversikt", "Fakturaer", "Leverandører", "Lager", "Innstillinger"]) expect(view).toContain(`label: "${l}"`);
  });
});
