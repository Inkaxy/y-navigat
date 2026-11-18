// Gjenlesing kan fjerne linjer (20261123): ny lesing erstatter hele linjesettet når ingen beskyttet linje går tapt,
// og linjesummen kan aldri øke på grunn av rester.
import { describe, expect, it } from "vitest";
import { decideAuto, decideReplace, type AutoCandidate, type AutoLine, type Protection } from "./rule";
import type { Operation, Values } from "@/fakturaer/lib/reread";

const v = (p: Partial<Values>): Values => ({
  supplier_sku: null, description: null, quantity: 1, unit: "stk", unit_price: null, total_amount: null,
  package_size: null, package_unit: null, count_per_package: null, line_kind: "vare", unit_price_basis: null, discount_amount: null, ...p,
});
const line = (id: string, p: Partial<Values>, protections: Protection[] = []): AutoLine => ({ ...v(p), id, line_number: null, protections });
const cand = (id: string, p: Partial<Values>): AutoCandidate => ({ candidate_id: id, values: v(p) });
// Coca-Cola 9204947561: netto 1 000 kr. Vare 952 + pant 48; samlet gjenlesing 17.11 la til en pant til (48).
const inv = { total_amount: 1150, total_vat: 150, is_credit_note: false };
const vare = { supplier_sku: "1001", description: "COCA-COLA 0,5L", unit_price: 952, total_amount: 952 };
const pant = { description: "PANT 2 KR", line_kind: "pant", unit_price: 48, total_amount: 48 };
const sumAfter = (lines: AutoLine[], ops: Operation[], cands: AutoCandidate[]) => {
  const removed = new Set(ops.flatMap((o) => (o.kind === "remove" ? [o.line_id] : [])));
  const updated = new Map(ops.flatMap((o) => (o.kind === "update" && o.changes.total_amount != null ? [[o.line_id, o.changes.total_amount as number] as const] : [])));
  const kept = lines.filter((l) => !removed.has(l.id)).reduce((s, l) => s + (updated.get(l.id) ?? (l.total_amount as number)), 0);
  const added = ops.reduce((s, o) => s + (o.kind === "add" ? (cands.find((c) => c.candidate_id === o.candidate_id)?.values.total_amount as number) : 0), 0);
  return kept + added;
};

describe("erstatning: gjenlesing fjerner rester", () => {
  it("duplikat-pant fra 17.11 fjernes; summen blir nøyaktig ny lesing (1 000 kr)", () => {
    const lines = [line("A", vare), line("P1", pant), line("P2", pant)];
    const cands = [cand("cA", vare), cand("cP", pant)];
    const d = decideAuto({ lines, candidates: cands, invoice: inv }, { replace: true });
    expect(d.kind).toBe("bruk");
    if (d.kind !== "bruk") return;
    expect(d.replace).toBe(true);
    // To like pantlinjer kan ikke pares entydig: begge fjernes og ny pant legges til (samme resultat, ingen rest).
    expect(d.operations).toContainEqual({ kind: "keep", candidate_id: "cA", line_id: "A", confirmed_keep: true });
    expect(d.operations.filter((o) => o.kind === "remove").length).toBeGreaterThanOrEqual(1);
    expect(sumAfter(lines, d.operations, cands)).toBe(1000);
    expect(d.after.lines_sum_status).toBe("ok");
  });

  it("uten databaseendringen (replace av): dagens regel, ingen fjerning", () => {
    const lines = [line("A", vare), line("P1", pant), line("P2", pant)];
    const d = decideAuto({ lines, candidates: [cand("cA", vare), cand("cP", pant)], invoice: inv });
    if (d.kind === "bruk" || d.kind === "forslag") expect(d.operations.some((o) => o.kind === "remove" || o.kind === "keep")).toBe(false);
  });

  it("linjesummen øker aldri av rester: for alle kombinasjoner av gamle og nye linjer er summen = ny lesing", () => {
    for (let oldPant = 0; oldPant <= 3; oldPant++) {
      for (let newPant = 0; newPant <= 3; newPant++) {
        const lines = [line("A", vare), ...Array.from({ length: oldPant }, (_, i) => line(`P${i}`, pant))];
        const cands = [cand("cA", vare), ...Array.from({ length: newPant }, (_, i) => cand(`c${i}`, pant))];
        const d = decideReplace({ lines, candidates: cands, invoice: inv });
        if (!d || d.kind === "uendret" || d.kind === "darligere") continue;
        expect(sumAfter(lines, d.operations, cands)).toBe(952 + 48 * newPant);
      }
    }
  });

  it("beskyttet linje uten motstykke fjernes aldri – da ingen erstatning", () => {
    for (const p of ["manuell_kobling", "godtatt_pris", "ikke_vare", "holdt_utenfor", "rettet"] as Protection[]) {
      const lines = [line("A", vare), line("P1", pant), line("P2", pant, [p])];
      expect(decideReplace({ lines, candidates: [cand("cA", vare), cand("cP", pant)], invoice: inv })).toBeNull();
      const d = decideAuto({ lines, candidates: [cand("cA", vare), cand("cP", pant)], invoice: inv }, { replace: true });
      if (d.kind === "bruk" || d.kind === "forslag") expect(d.operations.some((o) => o.kind === "remove")).toBe(false);
    }
  });

  it("beskyttet linje med motstykke beholdes urørt (keep)", () => {
    const lines = [line("A", vare, ["godtatt_pris"]), line("P1", pant), line("P2", pant)];
    const d = decideReplace({ lines, candidates: [cand("cA", vare), cand("cP", pant)], invoice: inv });
    expect(d?.kind).toBe("bruk");
    if (d?.kind !== "bruk") return;
    expect(d.operations).toContainEqual({ kind: "keep", candidate_id: "cA", line_id: "A", confirmed_keep: true });
  });

  it("lik lesing er uendret; en lesing som gjør stemmende sum til avvik brukes aldri", () => {
    const lines = [line("A", vare), line("P1", pant)];
    expect(decideReplace({ lines, candidates: [cand("cA", vare), cand("cP", pant)], invoice: inv })?.kind).toBe("uendret");
    expect(decideReplace({ lines, candidates: [cand("cA", vare)], invoice: inv })?.kind).toBe("darligere");
  });

  it("ny linje uten beløp gjør erstatning umulig", () => {
    expect(decideReplace({ lines: [line("A", vare)], candidates: [cand("cA", vare), cand("cX", { description: "Frakt", total_amount: null })], invoice: inv })).toBeNull();
  });
});
