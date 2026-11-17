import { describe, expect, it } from "vitest";
import { autoInputFromRun, decideAuto, type AutoCandidate, type AutoLine, type Protection } from "./rule";
import type { Values } from "@/fakturaer/lib/reread";

const v = (p: Partial<Values>): Values => ({
  supplier_sku: null, description: null, quantity: null, unit: "stk", unit_price: null, total_amount: null,
  package_size: null, package_unit: null, count_per_package: null, line_kind: "vare", unit_price_basis: null, discount_amount: null, ...p,
});
const line = (id: string, n: number, p: Partial<Values>, protections: Protection[] = []): AutoLine => ({ ...v(p), id, line_number: n, protections });
const cand = (id: string, p: Partial<Values>): AutoCandidate => ({ candidate_id: id, values: v(p) });
// Netto 1 000 kr (1 250 inkl. 250 mva).
const inv = { total_amount: 1250, total_vat: 250, is_credit_note: false };

describe("samlet gjenlesing – automatisk bruk (punkt 4)", () => {
  it("manuell kobling bevares: samme varenummer, bare mengde/pris/sum rettes – aldri varenr./tekst/type", () => {
    const lines = [
      line("L1", 1, { supplier_sku: "123", description: "Hvetemel 25kg", quantity: 2, unit_price: 250, total_amount: 500 }, ["manuell_kobling"]),
      line("L2", 2, { supplier_sku: "9", description: "Gjær", quantity: 1, unit_price: 250, total_amount: 250 }),
    ];
    const cands = [
      cand("c1", { supplier_sku: "123", description: "HVETEMEL 25 KG SEKK", quantity: 3, unit_price: 250, total_amount: 750 }),
      cand("c2", { supplier_sku: "9", description: "Gjær", quantity: 1, unit_price: 250, total_amount: 250 }),
    ];
    const d = decideAuto({ lines, candidates: cands, invoice: inv });
    expect(d.kind).toBe("bruk");
    if (d.kind !== "bruk") return;
    expect(d.operations).toHaveLength(1);
    const op = d.operations[0];
    expect(op.kind).toBe("update");
    if (op.kind !== "update") return;
    expect(op.line_id).toBe("L1");
    expect(Object.keys(op.changes).sort()).toEqual(["quantity", "total_amount"]);
    expect(op.changes).not.toHaveProperty("description");
    expect(op.changes).not.toHaveProperty("supplier_sku");
    expect(op).not.toHaveProperty("confirm_identity_change");
  });

  it("manuell kobling uten varenummer gjenfinnes bare med samme tekst OG beløp", () => {
    const lines = [line("L1", 1, { description: "Smør usaltet", quantity: 4, unit_price: 200, total_amount: 800 }, ["manuell_kobling"]), line("L2", 2, { description: "Frakt", quantity: 1, unit_price: 100, total_amount: 100 })];
    const same = decideAuto({ lines, candidates: [cand("c1", { description: "SMØR  usaltet", quantity: 4, unit_price: 200, total_amount: 800 }), cand("c2", { description: "Frakt", quantity: 1, unit_price: 200, total_amount: 200 })], invoice: inv });
    expect(same.kind).toBe("bruk");
    const other = decideAuto({ lines, candidates: [cand("c1", { description: "Smør usaltet", quantity: 5, unit_price: 160, total_amount: 900 }), cand("c2", { description: "Frakt", quantity: 1, unit_price: 100, total_amount: 100 })], invoice: inv });
    expect(other.kind).toBe("forslag");
    if (other.kind === "forslag") {
      expect(other.reasons.map((r) => r.code)).toContain("manuell_kobling_ikke_gjenfunnet");
      expect(other.operations.some((o) => o.kind === "update" && o.line_id === "L1")).toBe(false);
    }
  });

  it("manuelt koblet linje som ikke finnes i ny lesing gir forslag, selv om summen stemmer", () => {
    const lines = [line("L1", 1, { supplier_sku: "77", description: "Sukker", quantity: 1, unit_price: 500, total_amount: 500 }, ["manuell_kobling"]), line("L2", 2, { supplier_sku: "88", description: "Salt", quantity: 1, unit_price: 400, total_amount: 400 })];
    const d = decideAuto({ lines, candidates: [cand("c2", { supplier_sku: "88", description: "Salt", quantity: 1, unit_price: 500, total_amount: 500 })], invoice: inv });
    expect(d.kind).toBe("forslag");
    if (d.kind === "forslag") expect(d.reasons[0].code).toBe("manuell_kobling_ikke_gjenfunnet");
  });

  it("godtatt pris bevares: linjen røres ikke når ny lesing har samme tall", () => {
    const lines = [
      line("L1", 1, { supplier_sku: "1", description: "Rug", quantity: 10, unit_price: 50, total_amount: 500 }, ["godtatt_pris"]),
      line("L2", 2, { supplier_sku: "2", description: "Havre", quantity: 2, unit_price: 100, total_amount: 200 }),
    ];
    const d = decideAuto({ lines, candidates: [
      cand("c1", { supplier_sku: "1", description: "Rugmel fin", quantity: 10, unit_price: 50, total_amount: 500 }),
      cand("c2", { supplier_sku: "2", description: "Havre", quantity: 5, unit_price: 100, total_amount: 500 }),
    ], invoice: inv });
    expect(d.kind).toBe("bruk");
    if (d.kind === "bruk") expect(d.operations.every((o) => o.kind !== "update" || o.line_id !== "L1")).toBe(true);
  });

  it("godtatt pris som ville fått ny verdi gir forslag, og linjen er ikke med i operasjonene", () => {
    const lines = [line("L1", 1, { supplier_sku: "1", description: "Rug", quantity: 10, unit_price: 50, total_amount: 500 }, ["godtatt_pris"]), line("L2", 2, { supplier_sku: "2", description: "Havre", quantity: 5, unit_price: 100, total_amount: 500 })];
    const d = decideAuto({ lines, candidates: [cand("c1", { supplier_sku: "1", description: "Rug", quantity: 10, unit_price: 55, total_amount: 550 }), cand("c2", { supplier_sku: "2", description: "Havre", quantity: 5, unit_price: 90, total_amount: 450 })], invoice: inv });
    expect(d.kind).toBe("forslag");
    if (d.kind === "forslag") {
      expect(d.reasons.map((r) => r.code)).toContain("beskyttet_linje_endres");
      expect(d.operations.some((o) => o.kind === "update" && o.line_id === "L1")).toBe(false);
    }
  });

  it("«ikke vare», holdt utenfor og rettet linje som mangler i ny lesing gir forslag", () => {
    for (const p of ["ikke_vare", "holdt_utenfor", "rettet"] as Protection[]) {
      const lines = [line("L1", 1, { description: "Pall", quantity: 1, unit_price: 100, total_amount: 100 }, [p]), line("L2", 2, { supplier_sku: "5", description: "Mel", quantity: 1, unit_price: 800, total_amount: 800 })];
      const d = decideAuto({ lines, candidates: [cand("c2", { supplier_sku: "5", description: "Mel", quantity: 1, unit_price: 900, total_amount: 900 })], invoice: inv });
      expect(d.kind, p).toBe("forslag");
    }
  });

  it("dårligere lesing brukes aldri: sum stemte før, stemmer ikke etter", () => {
    const lines = [line("L1", 1, { supplier_sku: "1", description: "Mel", quantity: 4, unit_price: 250, total_amount: 1000 })];
    const d = decideAuto({ lines, candidates: [cand("c1", { supplier_sku: "1", description: "Mel", quantity: 4, unit_price: 25, total_amount: 100 })], invoice: inv });
    expect(d.kind).toBe("darligere");
  });

  it("lik lesing gir ingen endring", () => {
    const lines = [line("L1", 1, { supplier_sku: "1", description: "Mel", quantity: 4, unit_price: 250, total_amount: 1000 }, ["manuell_kobling"])];
    const d = decideAuto({ lines, candidates: [cand("c1", { supplier_sku: "1", description: "Mel", quantity: 4, unit_price: 250, total_amount: 1000 })], invoice: inv });
    expect(d.kind).toBe("uendret");
  });

  it("summen stemmer fortsatt ikke → forslag", () => {
    const lines = [line("L1", 1, { supplier_sku: "1", description: "Mel", quantity: 4, unit_price: 100, total_amount: 400 })];
    const d = decideAuto({ lines, candidates: [cand("c1", { supplier_sku: "1", description: "Mel", quantity: 5, unit_price: 100, total_amount: 500 })], invoice: inv });
    expect(d.kind).toBe("forslag");
    if (d.kind === "forslag") expect(d.reasons[0].code).toBe("sum_stemmer_ikke");
  });

  it("manglende linje legges til når summen da stemmer", () => {
    const lines = [line("L1", 1, { supplier_sku: "1", description: "Mel", quantity: 4, unit_price: 150, total_amount: 600 })];
    const d = decideAuto({ lines, candidates: [
      cand("c1", { supplier_sku: "1", description: "Mel", quantity: 4, unit_price: 150, total_amount: 600 }),
      cand("c2", { supplier_sku: "2", description: "Sukker", quantity: 2, unit_price: 200, total_amount: 400 }),
    ], invoice: inv });
    expect(d.kind).toBe("bruk");
    if (d.kind === "bruk") expect(d.operations).toEqual([expect.objectContaining({ kind: "add", candidate_id: "c2", confirmed_addition: true })]);
  });

  it("kreditnota: negative linjer mot positiv total stemmer som i sumkontrollen", () => {
    const lines = [line("L1", 1, { supplier_sku: "1", description: "Hvetemel", quantity: -3000, unit_price: 0.3, total_amount: -800 })];
    const d = decideAuto({ lines, candidates: [cand("c1", { supplier_sku: "1", description: "Hvetemel", quantity: -3000, unit_price: 0.333, total_amount: -1000 })], invoice: { ...inv, is_credit_note: true } });
    expect(d.kind).toBe("bruk");
  });

  it("leser beskyttelser fra lagret kjøring", () => {
    const input = autoInputFromRun({
      invoice: { total_amount: 1250, total_vat: 250, is_credit_note: false },
      lines: [
        { id: "a", line_number: 1, match_confidence: "manual", raw_material_id: "rm", total_amount: 1 },
        { id: "b", line_number: 2, price_acceptance: { x: 1 }, total_amount: "2" },
        { id: "c", line_number: 3, match_confidence: "not_applicable", total_amount: 3 },
        { id: "d", line_number: 4, match_confidence: "not_applicable", excluded_at: "2026-11-01", total_amount: 4 },
        { id: "e", line_number: 5, total_amount: 5 },
      ],
      corrections: [{ invoice_line_id: "e" }],
    }, { candidates: [{ candidate_id: "c1", values: { total_amount: 1 } }] });
    expect(input?.lines.map((l) => l.protections)).toEqual([["manuell_kobling"], ["godtatt_pris"], ["ikke_vare"], ["holdt_utenfor"], ["rettet"]]);
    expect(input?.lines[1].total_amount).toBe(2);
    expect(autoInputFromRun({ invoice: {}, lines: [] }, { candidates: [] })).toBeNull();
  });
});
