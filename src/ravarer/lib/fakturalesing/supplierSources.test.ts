import { describe, expect, it } from "vitest";
import { summarizeSupplierSources } from "./supplierSources";

const row = (id: string, src: string | null, payload: unknown = null, date = "2026-11-01") =>
  ({ supplier_id: id, supplier_name: id.toUpperCase(), lines_source: src, invoice_date: date, ehf_payload: payload });

describe("summarizeSupplierSources", () => {
  it("teller kilde per leverandør og velger hovedkilde", () => {
    const [a, b] = summarizeSupplierSources([row("asko", "pdf_extracted"), row("asko", "ehf_attachment"), row("tine", "ehf_attachment"), row("tine", null)]);
    expect(a).toMatchObject({ name: "ASKO", ehf: 1, pdf: 1, main: "blandet" });
    expect(b).toMatchObject({ name: "TINE", ehf: 1, unread: 1, main: "ehf" });
  });
  it("viser siste lagrede grunn til PDF, aldri grunn fra en EHF-lesing", () => {
    const [a] = summarizeSupplierSources([
      row("asko", "pdf_extracted", { kilde: "pdf", grunn: "gammel" }, "2026-10-01"),
      row("asko", "pdf_extracted", { kilde: "pdf", grunn: "ny" }, "2026-11-01"),
      row("asko", "ehf_attachment", { kilde: "ehf", grunn: null }, "2026-11-05"),
    ]);
    expect(a.lastReason).toBe("ny");
  });
});
