import { describe, expect, it } from "vitest";
import { buildUserText, type Hints } from "../../supabase/functions/_shared/invoiceExtraction.ts";
import { INVOICE_EXTRACTION_SYSTEM_PROMPT } from "../../supabase/functions/_shared/invoiceExtractionPrompt.ts";

const hints: Hints = {
  expected_total_excl_vat: null, expected_total_incl_vat: null, expected_vat: null,
  supplier_name: "Leverandør", invoice_number: null, is_credit: false,
  // Registerets kortere nummer motsier det trykte («5301 0», «6541 1»).
  known_items: [{ sku: "5301", name: "HASSELNØTTKJERNER" }, { sku: "6541", name: "TRANEBÆR" }],
};

describe("registerhint overskriver aldri trykt varenummer", () => {
  const t = buildUserText(hints, null, []);
  it("instruerer aldri kopiering av registerets varenummer", () => {
    expect(t).not.toMatch(/bruk NØYAKTIG samme varenummer/i);
    expect(t).not.toMatch(/bruk (det|samme) varenummer(et)? fra listen/i);
  });
  it("sier at trykt nummer vinner, også ved avvik", () => {
    expect(t).toMatch(/KUN som kontekst/);
    expect(t).toMatch(/nøyaktig slik det er trykt/);
    expect(t).toMatch(/Endre aldri et trykt varenummer/);
  });
  it("systemprompten krever fullt sku_raw med alle siffer", () => {
    expect(INVOICE_EXTRACTION_SYSTEM_PROMPT).toContain("«5301 0» er ikke «5301»");
    expect(INVOICE_EXTRACTION_SYSTEM_PROMPT).toContain("ingen kandidatliste kan endre den");
  });
});
