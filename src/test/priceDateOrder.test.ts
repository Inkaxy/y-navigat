import { describe, expect, it } from "vitest";
import { parseRekkefolge, sortByInvoiceDate } from "@/ravarer/pages/priskontroll/godkjenning/approvalLogic";
import { GJORE_SORTS, parseSort } from "@/ravarer/pages/priskontroll/gjore/logic";
import { priceReferenceReasonText } from "@/ravarer/lib/priceReference";

const r = (invoice_id: string, invoice_date: string | null, invoice_number: string) => ({ invoice_id, invoice_date, invoice_number });

describe("datorekkefølge i priskontroll", () => {
  const rows = [r("c", "2026-03-10", "30"), r("a", "2026-01-10", "10"), r("x", null, "99"), r("b2", "2026-02-10", "21"), r("b1", "2026-02-10", "20")];
  it("eldste fakturadato først er standard, stabil tie-break, uten dato sist", () => {
    expect(parseRekkefolge(null)).toBe("eldste");
    expect(sortByInvoiceDate(rows, "eldste").map((x) => x.invoice_id)).toEqual(["a", "b1", "b2", "c", "x"]);
  });
  it("nyeste først kan velges", () => {
    expect(parseRekkefolge("nyeste")).toBe("nyeste");
    expect(sortByInvoiceDate(rows, "nyeste").map((x) => x.invoice_id)).toEqual(["c", "b2", "b1", "a", "x"]);
  });
  it("arbeidslisten bruker eldste først som standard", () => {
    expect(parseSort(null)).toBe("oldest");
    expect(parseSort("newest")).toBe("newest");
    expect(parseSort("impact")).toBe("impact");
    expect(GJORE_SORTS[0].id).toBe("oldest");
  });
  it("samme dato ulik pris har norsk forklaring", () => {
    expect(priceReferenceReasonText({ source: "conflict", reason: "flere_kjop_samme_dato_ulik_pris" })).toMatch(/samme dato/);
  });
});
