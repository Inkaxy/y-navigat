import { describe, expect, it } from "vitest";
import {
  canSubmit, cleanItemName, defaultMode, guessItemType, isSafeCreate, otherSpellings, packageBadge, packagePayload,
  packageProposal, pricePerBase, readPackage, searchCandidates, sortQueue, suggestCandidate, supplierChips, type Candidate,
} from "./newItems";
import { DEFAULT_JUMP_PCT, belowLimitCount, consequenceText, formatPct, jumpCause, priceJumps, type JumpLineInput } from "./priceJumps";
import { canRequeue, isUnread, unreadReason, type UnreadInput } from "./unread";
import { fraFakturaTotal, otherQuestions, parseFraFakturaTab } from "./tabs";

const line = (o: Partial<Parameters<typeof packageProposal>[0] & object> = {}) => ({
  unit: "pose", quantity: 2, total_amount: 778, description: "Sjokoladestrøssel mørk 5 kg",
  package_size: null, package_unit: null, count_per_package: null, ...o,
});

describe("Nye varer – navn og type", () => {
  it("rydder pakningsstørrelse og prosent fra fakturateksten", () => {
    expect(cleanItemName("Sjokoladestrøssel mørk 5 kg")).toBe("Sjokoladestrøssel mørk");
    expect(cleanItemName("MANDELMASSE 50% 12,5KG")).toBe("Mandelmasse 50 %");
    expect(cleanItemName("RØMME LETT 18% 5L")).toBe("Rømme lett 18 %");
    expect(cleanItemName("HVETEMEL SIKTET SK 25")).toBe("Hvetemel siktet");
  });
  it("leverandørens regel vinner over gjetning", () => {
    expect(guessItemType("Kakeeske 25×25×10 hvit", null)).toBe("emballasje");
    expect(guessItemType("COCA-COLA 0,5L PET 24STK", null)).toBe("videresalg");
    expect(guessItemType("Rømme lett", null)).toBe("ravare");
    expect(guessItemType("Rømme lett", "emballasje")).toBe("emballasje");
  });
});

describe("Nye varer – pakning i raden", () => {
  it("leser «1 pose = 5 kg» fra varenavnet og regner 77,80 kr/kg", () => {
    const d = packageProposal(line());
    expect(d).toMatchObject({ container: "pose", qty: "5", unit: "kg", source: "varenavn", conflict: false });
    const s = readPackage(d, null);
    expect(s).toMatchObject({ state: "valid", baseUnit: "kg", baseUnitsPerPackage: 5 });
    expect(pricePerBase(line(), s)).toBeCloseTo(77.8, 2);
  });
  it("lest pakning og varenavn som ikke stemmer gir «Kontroller», aldri «Sikker»", () => {
    const d = packageProposal(line({ package_size: 10, package_unit: "kg" }));
    expect(d.conflict).toBe(true);
    expect(packageBadge({ text: "Sjokoladestrøssel", draft: d, state: readPackage(d, null), mode: "opprett", hasSuggestion: false })).toBe("kontroller");
  });
  it("fakturert i kg trenger ingen pakning", () => {
    const d = packageProposal(line({ unit: "kg", description: "Sukker" }));
    expect(d.source).toBe("direkte");
    expect(packagePayload(readPackage(d, "kg"))).toBeNull();
  });
  it("mangler mengde: «Fyll inn pakning» og primærknappen er sperret", () => {
    const d = packageProposal(line({ unit: "pakke", description: "Bakepapir 40×60" }));
    expect(d.qty).toBe("");
    const s = readPackage(d, null);
    expect(packageBadge({ text: "Bakepapir", draft: d, state: s, mode: "opprett", hasSuggestion: false })).toBe("fyll_inn");
    expect(canSubmit({ mode: "opprett", type: "emballasje", name: "Bakepapir 40×60", pick: null, badge: "fyll_inn", state: s })).toBe(false);
  });
  it("koblet vare: innholdet må kunne regnes om til varens grunnenhet", () => {
    const d = { container: "sekk", qty: "25", unit: "stk" as const, source: "lest" as const, conflict: false };
    expect(readPackage(d, "kg").state).toBe("invalid");
    expect(readPackage({ ...d, unit: "kg" }, "kg")).toMatchObject({ state: "valid", baseUnitsPerPackage: 25 });
  });
  it("lagrer pakningen som godkjent på koblingen (confirm=true)", () => {
    const s = readPackage({ container: "kartong", qty: "100", unit: "stk", source: "lest", conflict: false }, null);
    expect(packagePayload(s)).toEqual({ package_size: 100, package_unit: "stk", base_units_per_package: 100, confirm: true });
  });
  it("gebyr og pant merkes «Ser ikke ut som en vare»", () => {
    const d = packageProposal(line({ description: "MILJØGEBYR", unit: "stk" }));
    expect(packageBadge({ text: "MILJØGEBYR", draft: d, state: readPackage(d, null), mode: "opprett", hasSuggestion: false })).toBe("ikke_vare");
  });
});

describe("Nye varer – forslag, søk og «Opprett N sikre»", () => {
  const cands: Candidate[] = [
    { id: "1", name: "Hvetemel siktet", sku: "HV1", declaration_name: "Hvetemel", item_type: "ravare", base_unit: "kg", cost: 8.3 },
    { id: "2", name: "Kakeeske 20×20 hvit", sku: null, declaration_name: null, item_type: "emballasje", base_unit: "stk", cost: 5.8 },
  ];
  it("foreslår eksisterende vare og velger «Koble» som standard", () => {
    const s = suggestCandidate("HVETEMEL SIKTET SK 25", cands);
    expect(s?.id).toBe("1");
    expect(defaultMode(!!s)).toBe("koble");
    expect(suggestCandidate("Rømme lett 18%", cands)).toBeNull();
    expect(defaultMode(false)).toBe("opprett");
  });
  it("søker på navn og SKU", () => {
    expect(searchCandidates("kake", cands).map((c) => c.id)).toEqual(["2"]);
    expect(searchCandidates("hv1", cands).map((c) => c.id)).toEqual(["1"]);
  });
  it("bare «Opprett som ny» med sikker pakning telles som sikker", () => {
    const s = readPackage({ container: "pose", qty: "5", unit: "kg", source: "varenavn", conflict: false }, null);
    expect(isSafeCreate({ mode: "opprett", type: "ravare", name: "Strøssel", pick: null, badge: "sikker", state: s })).toBe(true);
    expect(isSafeCreate({ mode: "koble", type: "ravare", name: "Strøssel", pick: cands[0], badge: "sikker", state: s })).toBe(false);
    expect(isSafeCreate({ mode: "opprett", type: "ravare", name: "Strøssel", pick: null, badge: "kontroller", state: s })).toBe(false);
  });
  it("viser andre skrivemåter uten duplikater", () => {
    expect(otherSpellings("Sjokoladestrøssel mørk 5 kg", ["Sjokoladestrøssel mørk 5 kg", "SJOKOSTRØSSEL MØRK 5KG", "sjokostrøssel mørk 5kg", "Strøssel sjoko mørk"]))
      .toEqual(["SJOKOSTRØSSEL MØRK 5KG", "Strøssel sjoko mørk"]);
  });
  it("eldste først, og leverandørchips med antall", () => {
    const rows = [
      { key: "b", supplier_id: "s2", supplier_name: "ASKO Øst", kind: "ukoblet", first_open_date: "2026-11-02", last_date: null },
      { key: "a", supplier_id: "s1", supplier_name: "Idun Industri", kind: "mangler_pakning", first_open_date: "2026-10-01", last_date: null },
      { key: "c", supplier_id: "s1", supplier_name: "Idun Industri", kind: "ukoblet", first_open_date: "2026-10-01", last_date: null },
    ];
    expect(sortQueue(rows).map((r) => r.key)).toEqual(["c", "a", "b"]);
    expect(supplierChips(rows)).toEqual([
      { id: null, name: "Alle leverandører", count: 3 },
      { id: "s1", name: "Idun Industri", count: 2 },
      { id: "s2", name: "ASKO Øst", count: 1 },
    ]);
  });
});

const jl = (o: Partial<JumpLineInput>): JumpLineInput => ({
  id: "l1", invoice_id: "i1", raw_material_id: "rm1", supplier_sku: "100", description: "Smør usaltet",
  price_per_base_unit: 121.9, expected_price_per_base_unit: 96.5, price_variance_pct: 26.3, review_reason: "price_variance",
  invoice_number: "88102", invoice_date: "2026-11-10", supplier_id: "s1", rm_name: "Smør usaltet", rm_base_unit: "kg", rm_item_type: "ravare", ...o,
});

describe("Prishopp – grensen", () => {
  it("standardgrensen er 20 %", () => expect(DEFAULT_JUMP_PCT).toBe(20));
  it("viser bare priser som hopper mer enn grensen", () => {
    const lines = [jl({}), jl({ id: "l2", supplier_sku: "200", rm_name: "Sukker", price_variance_pct: 6.4, price_per_base_unit: 14.1, expected_price_per_base_unit: 13.25 })];
    const jumps = priceJumps(lines, () => 20);
    expect(jumps.map((j) => j.name)).toEqual(["Smør usaltet"]);
    expect(belowLimitCount(lines, () => 20)).toBe(1);
  });
  it("egen grense per vare overstyrer selskapets", () => {
    expect(priceJumps([jl({})], (id) => (id === "rm1" ? 30 : 20))).toHaveLength(0);
    expect(priceJumps([jl({ price_variance_pct: 12 })], () => 10)).toHaveLength(1);
  });
  it("én rad per leverandørvare, nyeste faktura", () => {
    const j = priceJumps([jl({ id: "a", invoice_date: "2026-10-01", invoice_number: "1" }), jl({ id: "b", invoice_date: "2026-11-01", invoice_number: "2" })], () => 20);
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ invoiceNumber: "2", openLines: 2 });
  });
  it("pris per brett på 12 i stedet for per egg tolkes som pakningsfeil", () => {
    const c = jumpCause({ oldPrice: 2.95, newPrice: 35.4, baseUnit: "stk", itemType: "ravare" }, { hasAgreement: false });
    expect(c.packageSuspect).toBe(true);
    expect(c.text).toBe("Ser ut som pris per pakning på 12, ikke per stk.");
    expect(consequenceText(37, 3, true).text).toBe("Brukes i 37 kalkyler. Vurderes ikke før pakningen er sjekket.");
  });
  it("konsekvens: brukes i N kalkyler, M varer faller under marginmålet", () => {
    expect(consequenceText(41, 6, false)).toEqual({ text: "Brukes i 41 kalkyler. 6 varer faller under marginmålet.", danger: true });
    expect(consequenceText(41, null, false).danger).toBe(false);
    expect(formatPct(26.3)).toBe("+26 %");
    expect(formatPct(-12.6)).toBe("−13 %");
  });
});

const inv = (o: Partial<UnreadInput>): UnreadInput => ({
  id: "i", invoice_number: "1", invoice_date: "2026-11-16", supplier_id: "s", total_amount: 100,
  line_extraction_status: "done", line_extraction_error: null, lines_sum_status: "ok", tripletex_supplier_invoice_id: "t", ...o,
});
describe("Ikke lest", () => {
  it("årsak i klartekst", () => {
    expect(unreadReason(inv({ lines_sum_status: "mismatch" }))).toBe("Summen av linjene stemmer ikke med fakturaen.");
    expect(unreadReason(inv({ line_extraction_error: "PDF-en ga ingen lesbare linjer" }))).toMatch(/skannet eller uleselig/);
    expect(unreadReason(inv({ line_extraction_status: "failed", line_extraction_error: "Linjeuthenting ga opp etter 3 forsøk" }))).toBe("Lesingen ga opp etter flere forsøk.");
    expect(isUnread(inv({}))).toBe(false);
  });
  it("bare Tripletex-fakturaer som er ferdig forsøkt kan leses på nytt", () => {
    expect(canRequeue(inv({ line_extraction_status: "failed" }))).toBe(true);
    expect(canRequeue(inv({ tripletex_supplier_invoice_id: null }))).toBe(false);
    expect(canRequeue(inv({ line_extraction_status: "pending" }))).toBe(false);
  });
});

describe("Faner og tellere", () => {
  it("menyens teller er summen av de tre fanene; ukjent gir ukjent", () => {
    expect(fraFakturaTotal([7, 3, 3])).toBe(13);
    expect(fraFakturaTotal([7, null, 3])).toBeNull();
  });
  it("øvrige spørsmål = åpne spørsmål minus det «Fra faktura» viser", () => {
    expect(otherQuestions({ open: 30, newItems: 20, coveredPrices: 3, unreadInvoiceItems: 2 })).toBe(5);
    expect(otherQuestions({ open: null, newItems: 20, coveredPrices: 3, unreadInvoiceItems: 2 })).toBeNull();
  });
  it("ukjent fane faller tilbake til «Nye varer»", () => {
    expect(parseFraFakturaTab("prishopp")).toBe("prishopp");
    expect(parseFraFakturaTab("tull")).toBe("nye");
  });
});

import { requeueMessage, sumDifference, sumDifferenceText, unreadGroup } from "./unread";
import { canSubmitAccept, parseSumWrite } from "./sumAccept";

describe("Ikke lest: to grupper og ærlig melding", () => {
  const base = { id: "i", invoice_number: "1", invoice_date: "2026-10-01", supplier_id: "s", total_amount: 1250, line_extraction_status: "done",
    line_extraction_error: null, lines_sum_status: "mismatch", tripletex_supplier_invoice_id: "t" };
  it("faktura med linjer hører til «Lest, men summen stemmer ikke»; uten linjer til «Ikke lest»", () => {
    expect(unreadGroup({ ...base, line_count: 7 })).toBe("har_linjer");
    expect(unreadGroup({ ...base, line_count: 0 })).toBe("uten_linjer");
  });
  it("meldingen sier at 38 med linjer må leses på nytt med forslag, ikke «låst eller allerede behandlet»", () => {
    expect(requeueMessage({ requeued: 51, skipped: [], withLines: 38 })).toBe("51 lagt i lesekøen. 38 har allerede linjer og må leses på nytt med forslag – se under.");
    const m = requeueMessage({ requeued: 0, skipped: [{ reason: "har_linjer" }, { reason: "kostpris_fort" }, { reason: "kostpris_fort" }, { reason: "godkjent" }], withLines: 0 });
    expect(m).toBe("0 lagt i lesekøen. 1 har allerede linjer og må leses på nytt med forslag – se under. 3 ble hoppet over: 2 har ført kostpris, 1 er godkjent.");
    expect(m).not.toMatch(/låst eller allerede behandlet/);
  });
  it("differansen i kroner: linjesum mot fakturasum eks. mva", () => {
    expect(sumDifference({ ...base, lines_sum_excl_vat: 960, total_vat: 250 })).toBe(-40);
    expect(sumDifferenceText(-40)).toBe("Linjene er 40,00 kr lavere enn fakturaen (eks. mva).");
    expect(sumDifferenceText(1234.5).replace(/\s/g, " ")).toBe("Linjene er 1 234,50 kr høyere enn fakturaen (eks. mva).");
  });
  it("kreditnota med motsatt fortegn regnes som sumkontrollen", () => {
    expect(sumDifference({ ...base, total_amount: 3612, total_vat: 471, is_credit_note: true, lines_sum_excl_vat: -3141 })).toBe(0);
  });
  it("uten mva er differansen ukjent, aldri 0", () => {
    expect(sumDifference({ ...base, lines_sum_excl_vat: 960, total_vat: null })).toBeNull();
  });
});

describe("Godta som den er", () => {
  it("bare ok:true er utført; kjent avvisning er avvist; alt annet ukjent", () => {
    expect(parseSumWrite({ ok: true, invoice_id: "i", audit_id: "a", replay: false })).toEqual({ kind: "ok", auditId: "a", replay: false });
    expect(parseSumWrite({ ok: false, code: "mva_forhold" })).toEqual({ kind: "avvist", code: "mva_forhold" });
    expect(parseSumWrite({ ok: false, code: "noe_nytt" })).toEqual({ kind: "ukjent" });
    expect(parseSumWrite({})).toEqual({ kind: "ukjent" });
    expect(parseSumWrite(null)).toEqual({ kind: "ukjent" });
  });
  it("«Annet» krever begrunnelse; de andre kategoriene gjør ikke det", () => {
    expect(canSubmitAccept("pant", "")).toBe(true);
    expect(canSubmitAccept("annet", " ")).toBe(false);
    expect(canSubmitAccept("annet", "Gebyr for lite ordre")).toBe(true);
    expect(canSubmitAccept(null, "x")).toBe(false);
  });
});
