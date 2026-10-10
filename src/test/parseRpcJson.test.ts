import { describe, expect, it } from "vitest";
import { parseLinkResult, parsePackageInference, parsePriceReference, parseRematchStatus, parseRepairVat, parseSupplierItemLines, parseSupplierItemsResult } from "@/fakturaer/lib/parseRpcJson";
import { repairVatMessage, sumCheck, confidenceLabel, linesSourceLabel } from "@/fakturaer/lib/invoiceFacts";
import { supersededReasonText, priceReferenceDateText } from "@/ravarer/lib/priceReference";
import { priceSourceLabel } from "@/ravarer/lib/varelisteCsv";

describe("parseRpcJson", () => {
  it("leser varekort med standardverdier og hopper over ugyldige rader", () => {
    const r = parseSupplierItemsResult({ total: "3", counts: { ukoblet: 2 }, items: [{ supplier_id: "s", item_key: "sku:1", status: "ukoblet", line_count: 4, last_open_line_id: "l9", rms_notes: "karantene" }, { item_key: "x" }, 5] });
    expect(r.total).toBe(3);
    expect(r.counts.ukoblet).toBe(2);
    expect(r.counts.koblet).toBe(0);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].last_open_line_id).toBe("l9");
    expect(r.items[0].rms_notes).toBe("karantene");
    expect(r.items[0].open_lines).toBe(0);
  });
  it("tåler null og feil form", () => {
    expect(parseSupplierItemsResult(null).items).toEqual([]);
    expect(parseSupplierItemLines({ a: 1 })).toEqual([]);
    expect(parseSupplierItemLines([{ id: "l", invoice_id: "i", quantity: 2 }])[0].quantity).toBe(2);
  });
  it("pakningsutledning med direct", () => {
    const p = parsePackageInference({ ok: true, direct: true, direct_factor: 0.001, source: "tull", explanation: "g → kg" });
    expect(p.direct).toBe(true);
    expect(p.direct_factor).toBe(0.001);
    expect(p.source).toBeNull();
  });
  it("koblingssvar: feil og rematched=false", () => {
    expect(parseLinkResult({ ok: false, error: "Ingen tilgang", reason: "forbidden" })).toEqual({ error: "Ingen tilgang" });
    const r = parseLinkResult({ ok: true, mode: "koblet", lines_updated: 2, invoices: [{ invoice_id: "a", rematched: false, error: "Tidsavbrudd" }] });
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.invoices[0].rematched).toBe(false);
      expect(r.invoices[0].error).toBe("Tidsavbrudd");
    }
  });
  it("køstatus, prisgrunnlag og mva-retting", () => {
    expect(parseRematchStatus({ queued: 4, in_flight: 2 })).toMatchObject({ queued: 4, in_flight: 2, done_last_hour: 0 });
    expect(parsePriceReference({ source: "agreement", price: 11.2 }).source).toBe("agreement");
    expect(parsePriceReference({ source: "x" }).source).toBe("none");
    expect(repairVatMessage(parseRepairVat({ ok: true, mode: "linjer_skalert", lines: 5 }))).toContain("5 linjer regnes om");
    expect(repairVatMessage(parseRepairVat({ ok: false, reason: "kostpris_fort" }))).toBe("Kostpris er allerede ført fra denne fakturaen");
    expect(repairVatMessage(parseRepairVat({ ok: true, mode: "mva_utledet" }))).toContain("utledet");
  });
});

describe("etiketter", () => {
  it("sumkontroll, sikkerhet, linjekilde", () => {
    expect(sumCheck(1.9).label).toBe("stemmer");
    expect(sumCheck(-2.5).label).toBe("avviker");
    expect(sumCheck(null).label).toBe("ikke kontrollert");
    expect(confidenceLabel(0.85)).toBe("høy");
    expect(confidenceLabel(0.6)).toBe("middels");
    expect(confidenceLabel(0.3)).toBe("lav");
    expect(linesSourceLabel("pending_manual")).toBe("Venter på manuell registrering");
  });
  it("prishistorikk og priskilde", () => {
    expect(supersededReasonText("usannsynlig_pris_karantene")).toBe("Satt i karantene: usannsynlig pris");
    expect(supersededReasonText("ny_pakning")).toBe("Ny pakning");
    expect(priceReferenceDateText({ source: "last_purchase", reference_date: "2026-10-03" })).toMatch(/^siste kjøp/);
    expect(priceSourceLabel("invoice")).toBe("Faktura");
    expect(priceSourceLabel("manual")).toBe("Manuell");
    expect(priceSourceLabel(null)).toBe("—");
  });
});
