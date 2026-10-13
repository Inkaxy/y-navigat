import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { countText, parseDel, statusTiles } from "@/ravarer/pages/priskontroll/arbeidsbord/sporLogic";
import { clarificationGate } from "@/ravarer/pages/priskontroll/gjore/PriceBlock";
import type { WorkItemsCounts } from "@/ravarer/lib/workRpcTypes";

const counts = { alle: 10, kobling: 2, pakning: 3, pris: 4, kontroll: 1, fakturaer: 5, faktura_mangler_linjer: 1, faktura_sumavvik: 2, faktura_flagget: 0, faktura_klar: 2 } as WorkItemsCounts;

describe("statusoversikt", () => {
  const t = statusTiles(counts, null);
  it("holder enhetene adskilt", () => {
    const av = t.find((x) => x.id === "avklaring")!;
    expect(av.entries.map((e) => [e.unit, e.count])).toEqual([["varekort", 2], ["varekort", 3], ["varekort", 1], ["fakturaer", 3]]);
    expect(t.find((x) => x.id === "klar")!.entries.map((e) => e.count)).toEqual([4, 2]);
  });
  it("ukjent teller er ukjent, ikke 0", () => {
    expect(t.find((x) => x.id === "behandlet")!.entries[0].count).toBeNull();
    expect(countText({ count: null, unit: "fakturaer" })).toBe("ukjent");
    expect(statusTiles(undefined, null)[0].entries.every((e) => e.count == null)).toBe(true);
  });
  it("tekst med enhet", () => {
    expect(countText({ count: 1, unit: "fakturaer" })).toBe("1 faktura");
    expect(countText({ count: 3, unit: "varekort" })).toBe("3 varekort");
  });
  it("del-parameter", () => { expect(parseDel("original")).toBe("original"); expect(parseDel("x")).toBe("beslutning"); });
});

describe("prissperre i varekortet", () => {
  const l = { id: "a", invoice_id: "i", invoice_number: "1", invoice_date: "2026-01-01", invoice_status: null, flagged_at: null, is_credit_note: false, reconciled_mode: null, line_number: 1, supplier_sku: null,
    description: "Mel", quantity: 10, unit: "sekk", unit_price: 100, total_amount: 300, package_size: null, package_unit: null, count_per_package: null, base_quantity: null,
    price_per_base_unit: null, expected_price_per_base_unit: null, price_variance_pct: null, variance_status: null, price_reference_source: null, raw_material_id: null, raw_material_name: null,
    match_confidence: null, requires_review: null, review_reason: null, resolution_note: null };
  it("serverens lesevarsel stenger prisen", () => expect(clarificationGate({ ...l, review_reason: "extraction_unresolved" } as never)?.ok).toBe(false));
  it("eget regnestykke på ufullstendig varekortlinje stenger ikke (mangler prisgrunnlag/rabatt)", () => expect(clarificationGate(l as never)).toBeNull());
  it("regnestykke som går opp stenger ikke", () => expect(clarificationGate({ ...l, total_amount: 1000 } as never)).toBeNull());
});

describe("ruter", () => {
  it("arbeidsbordet er standard og klassisk visning er bevart", () => {
    const s = readFileSync("src/ravarer/pages/hub/PriskontrollPage.tsx", "utf8");
    expect(s).toContain('!sp.get("visning") && <Arbeidsbord />');
    expect(s).toContain("<GjoreWorkspace />");
    expect(s).toContain("<MengdeDiagnostikk />");
  });
  it("syntetisk forhåndsvisning finnes", () => expect(readFileSync("src/App.tsx", "utf8")).toContain('path="/forhandsvisning/arbeidsbord"'));
});

describe("integrasjonsrettinger", () => {
  it("prisavvik heter «Prisendringer å vurdere», ikke klare til godkjenning", () => {
    const k = statusTiles(counts, null).find((x) => x.id === "klar")!;
    expect(k.title).toBe("Prisendringer å vurdere");
    expect(k.explain).toBe("Registrerte prisavvik. Åpne kortet for å se hva som må avklares før prisen kan vurderes.");
    expect(k.explain).not.toMatch(/Grunnlaget er lest/);
  });
  it("«Behandle flere» er synlig og originalen følger valgt linje", () => {
    expect(readFileSync("src/ravarer/pages/priskontroll/arbeidsbord/ArbeidsbordView.tsx", "utf8")).toContain("Behandle flere");
    const a = readFileSync("src/ravarer/pages/priskontroll/arbeidsbord/Arbeidsbord.tsx", "utf8");
    expect(a).toContain('lineId={it.invoice_id ? null : prm.sp.get("linje")}');
    expect(a).toContain("onOriginalLine=");
  });
});
