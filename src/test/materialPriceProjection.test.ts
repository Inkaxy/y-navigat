import { describe, it, expect } from "vitest";
import { mergeProjection, parseMaterialPriceProjection } from "@/ravarer/lib/priceProjection";
import { buildTimeline, timelineCsv, type TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";
import { derivedPackagePrice, packageLabel, agreementStatusLabel } from "@/ravarer/lib/supplierPackagePrice";

const M = "3f814c2d-f9fb-447c-8def-d84334b0ff72";
const proj = (o: Record<string, unknown>) => ({
  history_id: "h1", source: "invoice", provenance: "currently_verified_line", price: 60.6035, effective_date: "2026-08-18",
  created_at: "2026-08-19T10:00:00Z", supplier_id: "s1", invoice_id: "i1", invoice_line_id: "l1", invoice_number: "F1",
  unit: "kg", currency: "NOK", line_version: "v", line_unit: "sekk", quantity: 24, base_quantity: 480, total_amount: 29089.68,
  package_size: null, package_unit: "sekk", count_per_package: null, base_units_per_package: null, ...o,
});
const resp = (projections: unknown[], o: Record<string, unknown> = {}) => ({
  raw_material_id: M, checked_at: "2026-10-11T12:00:00Z", eligible_history_ids: [], held_history_ids: [], duplicate_history_ids: [], projections, ...o,
});
const legacy = (o: Partial<TimelineHistoryRow>): TimelineHistoryRow => ({
  id: "h1", effective_date: "2026-08-18", price: 60.6035, supplier_id: "s1", source: "invoice", invoice_id: "i1",
  currency: "NOK", unit: null, unitSource: null, ...o,
});

describe("rm_material_price_projection — parsing", () => {
  it("gyldig svar", () => expect(parseMaterialPriceProjection(resp([proj({})]), M)?.projections).toHaveLength(1));
  it.each([
    ["feil råvare", { ...resp([]), raw_material_id: "x" }],
    ["ugyldig pris", resp([proj({ price: "abc" })])],
    ["feil valuta", resp([proj({ currency: "EUR" })])],
    ["feil proveniens", resp([proj({ provenance: "ved_registrering" })])],
    ["mangler id-liste", { ...resp([]), held_history_ids: null }],
  ])("%s → null", (_n, d) => expect(parseMaterialPriceProjection(d, M)).toBeNull());
});

describe("fletting og tidslinje (Combisur)", () => {
  const history = [
    legacy({ id: "h1", effective_date: "2026-08-18", price: 60.6035, invoice_id: "i1" }),
    legacy({ id: "h2", effective_date: "2026-05-26", price: 60.076, invoice_id: "i2" }),
    legacy({ id: "h3", effective_date: "2026-09-01", price: 52.52, invoice_id: null, source: "recalc" }),
  ];
  const p = parseMaterialPriceProjection(resp([proj({}), proj({ history_id: "h2", price: 60.076, invoice_id: "i2", effective_date: "2026-05-26", invoice_line_id: "l2" })]), M);

  it("beholder alle rader, merker rekonstruert enhet, og Δ er eksakt 0,5275", () => {
    const merged = mergeProjection(history, p);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ unit: "kg", unitSource: "currently_verified_line", checkedAt: "2026-10-11T12:00:00Z" });
    expect(merged[2].unitSource).toBeNull();
    const t = buildTimeline({ history: merged, supplierNames: new Map([["s1", "Regal"]]), links: [], currentUnit: "kg" });
    expect(t.rows.map((r) => r.id)).toEqual(["h1", "h2"]);
    expect(t.rows[0].deltaPrevKr).toBeCloseTo(0.5275, 10);
    expect(t.events.map((e) => e.id)).toEqual(["h3"]);
  });
  it("låst snapshot overskrives aldri; ulik pris eller faktura flettes ikke", () => {
    const m = mergeProjection([legacy({ unit: "g", unitSource: "ved_registrering" }), legacy({ id: "h2", price: 99, invoice_id: "i2" })], p);
    expect(m[0]).toMatchObject({ unit: "g", unitSource: "ved_registrering" });
    expect(m[1].unitSource).toBeNull();
    expect(mergeProjection([legacy({ invoice_id: "annen" })], p)[0].unitSource).toBeNull();
  });
  it("hold og duplikat blir hendelser; lik pris på ulik dato beholdes", () => {
    const q = parseMaterialPriceProjection(resp([proj({}), proj({ history_id: "h2", price: 60.076, invoice_id: "i2", effective_date: "2026-05-26" })], { held_history_ids: ["h1"], duplicate_history_ids: ["h2"] }), M);
    const t = buildTimeline({ history: mergeProjection(history.slice(0, 2), q), supplierNames: new Map(), links: [], currentUnit: "kg" });
    expect(t.rows).toHaveLength(0);
    expect(t.events.map((e) => e.kind).sort()).toEqual(["duplikat", "til_kontroll"]);
    const same = mergeProjection([legacy({ id: "a" }), legacy({ id: "b", effective_date: "2026-07-14" })], null);
    expect(buildTimeline({ history: same, supplierNames: new Map(), links: [] }).rows).toHaveLength(2);
  });
  it("projeksjon = null (feil) gir uendret historikk, ikke tom", () => {
    expect(mergeProjection(history, null)).toHaveLength(3);
  });
  it("pakningsvisning: CSV skriver original 60,6035 per kg, ikke 1212,07; hendelser skaleres aldri", () => {
    const merged = mergeProjection(history, p);
    const t = buildTimeline({ history: merged, supplierNames: new Map(), links: [], currentUnit: "kg", unitFactor: 20 });
    expect(t.rows[0].price).toBeCloseTo(1212.07, 2);
    expect(t.rows[0].originalPrice).toBe(60.6035);
    expect(t.events[0].price).toBe(52.52);
    const line = timelineCsv(t.rows, t.events, "dagens 20 kg-pakning").split("\n")[1].split(";");
    expect(line[4]).toBe("60.6035");
    expect(line[6]).toBe("kg");
    expect(line.slice(-3)).toEqual(["1212.0700", "dagens 20 kg-pakning", "Omregnet til dagens pakning"]);
  });
  it("ubekreftet eller udatert avtale gir verken bånd eller Δ avtale", () => {
    const merged = mergeProjection(history, p);
    const base = { history: merged, supplierNames: new Map(), currentUnit: "kg" };
    const link = { supplier_id: "s1", agreed_price_per_base_unit: 60.08, agreement_valid_from: "2026-01-01", agreement_valid_to: null };
    expect(buildTimeline({ ...base, links: [link] }).bands).toHaveLength(0);
    expect(buildTimeline({ ...base, links: [link] }).rows[0].deltaAgreementPct).toBeNull();
    expect(buildTimeline({ ...base, links: [{ ...link, agreement_valid_from: null, agreement_confirmed: true }] }).rows[0].deltaAgreementPct).toBeNull();
    expect(buildTimeline({ ...base, links: [{ ...link, agreement_confirmed: true }] }).rows[0].deltaAgreementPct).not.toBeNull();
  });
});

describe("leverandørkoblingens pakning og pris", () => {
  const combi = { package_size: null, package_unit: "sekk", base_units_per_package: 20, package_confirmed_at: "2026-09-01", package_confirmed_by: "u",
    agreed_price: 60.08, agreed_price_per_base_unit: 60.08, agreed_price_set_at: null, agreed_price_set_by: null };
  it("manglende størrelse + bekreftet faktor 20 → «Sekk · 20 kg per pakning» og 1201,60", () => {
    expect(packageLabel(combi, "kg")).toEqual({ label: "Sekk · 20 kg per pakning", confirmed: true });
    const d = derivedPackagePrice(combi);
    expect(d.kind === "known" && d.price).toBeCloseTo(1201.6, 6);
  });
  it("«20 sekk» på råvaren er ikke 20 beholdere", () => {
    expect(packageLabel({ ...combi, package_size: 20 }, "kg").label).toBe("Sekk · 20 kg per pakning");
  });
  it("ubekreftet faktor eller ingen faktor → må bekreftes; lik legacy-pris er ikke bevis", () => {
    expect(derivedPackagePrice({ ...combi, package_confirmed_at: null }).kind).toBe("needs_confirmation");
    expect(derivedPackagePrice({ ...combi, base_units_per_package: null }).kind).toBe("needs_confirmation");
  });
  it("avtale uten hvem/når merkes ikke bekreftet", () => {
    expect(agreementStatusLabel(combi)).toBe("Registrert avtalepris — ikke bekreftet");
    expect(agreementStatusLabel({ ...combi, agreed_price_set_at: "x", agreed_price_set_by: "u" })).toBeNull();
  });
});
