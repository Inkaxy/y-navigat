import { describe, expect, it } from "vitest";
import {
  CHANGE_LINK_ERRORS, SKIP_REASON_LABEL, attemptsText, claimErrorMessage, changeLinkErrorMessage, claimAmount, claimFailureMessage, lockedLinesText,
  parseValgt, pickNext, pricePrimaryAction, priceChange, skipLineText, stepKey, varekortKey,
} from "@/ravarer/pages/priskontroll/gjore/logic";
import { parseChangeLink, parseClaimCredit } from "@/ravarer/pages/priskontroll/gjore/rpc";
import { changeLinkScope } from "@/ravarer/pages/priskontroll/gjore/ChangeLinkDialog";
import { ACCEPT_SKIP_REASONS } from "@/ravarer/lib/workRpcTypes";

describe("primærhandling i Pris-blokken", () => {
  const cap = 15;
  it("pris ned → godta", () => expect(pricePrimaryAction({ pct: -8, hardCapPct: cap, hasAgreement: true })).toBe("accept"));
  it("opp innenfor maksgrensen → godta", () => expect(pricePrimaryAction({ pct: 11.8, hardCapPct: cap, hasAgreement: true })).toBe("accept"));
  it("opp over maksgrensen med avtale → krev kreditt", () => expect(pricePrimaryAction({ pct: 22, hardCapPct: cap, hasAgreement: true })).toBe("claim"));
  it("opp over maksgrensen uten avtale → godta", () => expect(pricePrimaryAction({ pct: 22, hardCapPct: cap, hasAgreement: false })).toBe("accept"));
  it("ukjent endring → godta", () => expect(pricePrimaryAction({ pct: null, hardCapPct: cap, hasAgreement: true })).toBe("accept"));
});

describe("prisberegning", () => {
  const lines = [
    { id: "a", price_per_base_unit: 78.4, expected_price_per_base_unit: 70.13, base_quantity: 100 },
    { id: "b", price_per_base_unit: 60, expected_price_per_base_unit: 70.13, base_quantity: 50 },
  ];
  it("mengdevektet endring", () => {
    const c = priceChange(lines)!;
    expect(c.impactNok).toBeCloseTo(8.27 * 100 - 10.13 * 50, 1);
  });
  it("krav gjelder bare dyrere linjer", () => expect(claimAmount(lines)).toBeCloseTo(827, 0));
  it("uten grunnlag → null", () => expect(priceChange([])).toBeNull());
});

describe("valgt-nøkkel", () => {
  it("varekort med kolon i item_key", () => {
    expect(parseValgt(varekortKey("s1", "name:abc:def"))).toEqual({ type: "varekort", supplierId: "s1", itemKey: "name:abc:def" });
  });
  it("faktura", () => expect(parseValgt("faktura:i1")).toEqual({ type: "faktura", invoiceId: "i1" }));
  it("ugyldig", () => {
    expect(parseValgt("varekort:s1")).toBeNull();
    expect(parseValgt("faktura:")).toBeNull();
    expect(parseValgt("noe")).toBeNull();
    expect(parseValgt(null)).toBeNull();
  });
});

describe("Neste etter handling", () => {
  const items = [{ key: "a" }, { key: "b" }, { key: "c" }];
  it("neste i samme sortering", () => expect(pickNext(items, "b")).toBe("c"));
  it("forrige når det var sist", () => expect(pickNext(items, "c")).toBe("b"));
  it("første når ingenting var valgt", () => expect(pickNext(items, null)).toBe("a"));
  it("null når listen blir tom", () => expect(pickNext([{ key: "a" }], "a")).toBeNull());
  it("J/K går ikke utenfor listen", () => {
    expect(stepKey(items, "c", 1)).toBe("c");
    expect(stepKey(items, null, 1)).toBe("a");
    expect(stepKey(items, "a", -1)).toBe("a");
  });
});

describe("feilkoder til norsk", () => {
  it.each(Object.entries(CHANGE_LINK_ERRORS))("%s", (code, text) => {
    expect(changeLinkErrorMessage(`ERROR: ${code}`)).toBe(text);
  });
  it("kobling_finnes_ikke forveksles ikke med kobling_finnes", () => {
    expect(changeLinkErrorMessage("kobling_finnes_ikke")).toBe("Koblingen finnes ikke lenger");
  });
  it("ukjent → generell tekst", () => expect(changeLinkErrorMessage("boom")).toMatch(/Prøv igjen/));
  it("alle skipped_lines-grunner har norsk tekst", () => {
    for (const r of ACCEPT_SKIP_REASONS) expect(SKIP_REASON_LABEL[r]).toMatch(/\S/);
    expect(skipLineText({ invoice_number: "12", reason: "faktura_last", message: "" })).toBe("Faktura 12: Fakturaen er låst (avstemt eller flagget)");
    expect(skipLineText({ invoice_number: null, reason: "feil", message: "P0001 boom" })).toBe("Linjen kunne ikke godtas");
  });
  it("kravfeil", () => {
    expect(claimFailureMessage("ingen_merkostnad")).toBe("Ingen av linjene er dyrere enn forventet — ingenting å kreve");
    expect(claimFailureMessage("ingen_godtatt", [{ invoice_number: null, reason: "endret", message: "" }])).toMatch(/^Ingen linjer kunne godtas: Linjen er endret/);
  });
  it("kravfeil fra serveren", () => {
    expect(claimErrorMessage("linje_allerede_i_aapen_sak")).toMatch(/åpen leverandørsak/);
    expect(claimErrorMessage("prisgrunnlag_mangler")).toMatch(/prisgrunnlag/);
    expect(claimErrorMessage("ingen_merkostnad")).toMatch(/ingenting å kreve/);
    expect(claimErrorMessage("Saken må ha en tittel")).toBe("Saken må ha en tittel");
    expect(claimErrorMessage("Velg linjene kravet gjelder")).toBe("Velg linjene kravet gjelder");
    expect(attemptsText(7)).toBe("Forsøk 3/3.");
  });
  it("låste linjer", () => {
    expect(lockedLinesText(0)).toBeNull();
    expect(lockedLinesText(2)).toBe("2 linjer er låst fordi kostpris er ført — de beholder gammel kobling");
  });
});

describe("RPC-parsing", () => {
  it("claim ok", () => {
    const r = parseClaimCredit({ ok: true, case_id: "c1", case_lines: [{}, {}], accepted: 2, skipped_lines: [], rematch: { queued: 1 } });
    expect(r).toEqual({ ok: true, caseId: "c1", caseLines: 2, accepted: 2, skipped: [], rematchQueued: 1 });
  });
  it("claim avslag med ukjent grunn mappes til feil", () => {
    const r = parseClaimCredit({ ok: false, reason: "ingen_godtatt", skipped_lines: [{ id: "l1", reason: "rar", message: "" }] });
    expect(r).toEqual({ ok: false, reason: "ingen_godtatt", skipped: [{ id: "l1", invoice_number: null, reason: "feil", message: "" }] });
  });
  it("change link", () => {
    expect(parseChangeLink({ ok: true, changed_line_ids: ["a", 3], locked_lines: 1, rematch: { queued: 2 } })).toEqual({ ok: true, changedLineIds: ["a"], lockedLines: 1, rematchQueued: 2 });
  });
});

describe("Endre kobling — omfang", () => {
  const l = (id: string, status: string, cost_posted: boolean, rm = "old") => ({ id, invoice_status: status, cost_posted, raw_material_id: rm });
  it("avstemte og andre råvarer utelates, førte sendes og telles som låst", () => {
    expect(changeLinkScope([l("a", "pending_review", false), l("b", "reconciled", false), l("c", "pending_review", true), l("d", "pending_review", false, "x")], "old"))
      .toEqual({ lineIds: ["a", "c"], movable: 1, locked: 1 });
  });
});
