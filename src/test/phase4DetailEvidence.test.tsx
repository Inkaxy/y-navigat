// @vitest-environment jsdom
/**
 * Fase 4-reparasjon: råvarekortets KPI/topptekst/pakningskost og listens kost/siste dato leser
 * samme bundne serverbevis. Leverandørbufferen brukes aldri. Mocket RPC, ingen skriving.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const V = "2026-10-11T12:00:00.123456+00:00";
type Row = Record<string, unknown>;
let rowFor: (id: string) => Row = () => ({});
let gate: Promise<void> | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (_n: string, a: { p_legal_entity_id: string; p_raw_material_ids: string[] }) => ({
    abortSignal: () => ({
      then: async (ok: (v: unknown) => unknown) => {
        if (gate) await gate;
        return ok({ data: { schema_version: 1, legal_entity_id: a.p_legal_entity_id, checked_at: V, requested_count: a.p_raw_material_ids.length, rows: a.p_raw_material_ids.map((id) => rowFor(id)) }, error: null });
      },
    }),
  }) },
}));
vi.mock("@/ravarer/hooks/useRavarerScope", () => ({ useRavarerScope: () => ({ legalEntityId: "E" }) }));
vi.mock("@/ravarer/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [{ id: "s1", name: "Lev" }] }) }));

import { useListPriceEvidence } from "@/ravarer/hooks/useListPriceEvidence";
import { useMaterialPriceEvidence } from "@/ravarer/hooks/useMaterialPriceEvidence";
import { RawMaterialKpiStrip } from "@/ravarer/components/RawMaterialKpiStrip";
import { bindEvidence, costEvidenceFor, latestInvoiceOf, type ListPriceEvidence } from "@/ravarer/lib/listPriceEvidence";
import { costSummary } from "@/ravarer/lib/costSummary";
import { formatNutrientValue, nutrientChange } from "@/ravarer/lib/nutritionLabels";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import type { RmSupplierRow } from "@/ravarer/hooks/useRmSuppliers";

const base = {
  material_updated_at: V, current_price: 60.6035, cost_basis_status: "verifisert", base_unit: "kg",
  cost_effective_date: "2026-08-18", currency: "NOK",
};
/** Combi: gyldig kost fra 18. aug, nyere usikker faktura 1. sep. */
const combiUnsafe = (id: string): Row => ({
  ...base, raw_material_id: id, status: "unknown", reason: "invoice_unverified", cost_reason: null, invoice_reason: "invoice_unverified",
  cost_evidence_status: "eligible", invoice_evidence_status: "unknown", invoice_id: "inv-sep", invoice_line_id: "l-sep", invoice_number: "S1",
  invoice_date: "2026-09-01", invoice_price_per_base_unit: null, deviation_pct: null,
});
const safe = (dev: number, ppbu: number) => (id: string): Row => ({
  ...base, raw_material_id: id, status: "eligible", reason: null, cost_reason: null, invoice_reason: null,
  cost_evidence_status: "eligible", invoice_evidence_status: "eligible", invoice_id: "inv-ok", invoice_line_id: "l-ok", invoice_number: "OK1",
  invoice_date: "2026-09-05", invoice_price_per_base_unit: ppbu, deviation_pct: dev,
});
const held = (id: string): Row => ({
  ...base, raw_material_id: id, status: "unknown", reason: "cost_source_held", cost_reason: "cost_source_held", invoice_reason: null,
  cost_evidence_status: "unknown", invoice_evidence_status: "eligible", invoice_id: "inv-ok", invoice_line_id: "l-ok", invoice_number: "OK1",
  invoice_date: "2026-09-05", invoice_price_per_base_unit: 60.6035, deviation_pct: null,
});

const rm = {
  id: "rm1", name: "Combi", updated_at: V, current_cost_price: 60.6035, cost_basis_status: "verifisert", base_unit: "kg",
  price_source: "faktura", price_updated_at: "2026-08-18", agreed_price: null, primary_supplier_id: "s1",
  base_units_per_package: 10, package_confirmed_at: "2026-08-01",
} as unknown as RawMaterialRow;
/** Leverandørbuffer med gammel augustpris — skal aldri vises. */
const links = [{ id: "L", supplier_id: "s1", is_primary: true, last_invoice_price: 60.6035, last_invoice_date: "2026-08-18", agreed_price_per_base_unit: null }] as unknown as RmSupplierRow[];

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
beforeEach(() => { gate = null; client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });

function Strip() {
  const ev = useMaterialPriceEvidence(rm);
  return <><span data-testid="hdr">{costSummary(rm, ev.cost).status}</span><RawMaterialKpiStrip rm={rm} evidence={ev} links={links} recipeCount={0} spend12m={null} /></>;
}

describe("detalj-KPI fra bundet bevis", () => {
  it("Combi: nyere usikker faktura → ukjent, ingen 0 %, ingen augustbuffer; kost forblir verifisert", async () => {
    rowFor = combiUnsafe;
    render(<Strip />, { wrapper });
    await screen.findByText(/1\. sep/);
    expect(screen.getByText("Siste faktura mot kostpris")).toBeTruthy();
    expect(screen.queryByText(/0,0 %/)).toBeNull();
    expect(screen.queryByText(/18\. aug.*Lev/)).toBeNull();
    expect(screen.getByText("Ukjent")).toBeTruthy();
    expect(screen.getByTestId("hdr").textContent).toBe("Verifisert");
  });
  it("trygg siste faktura: eksakt fortegnet avvik, også 0 og negativt", async () => {
    rowFor = safe(-12.34, 53.12);
    const { unmount } = render(<Strip />, { wrapper });
    expect(await screen.findByText("-12,3 %")).toBeTruthy();
    unmount();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rowFor = safe(0, 60.6035);
    render(<Strip />, { wrapper });
    expect(await screen.findByText("0,0 %")).toBeTruthy();
  });
  it("holdt kostkilde: ingen verifisert merke og ingen pakningspris", async () => {
    rowFor = held;
    render(<Strip />, { wrapper });
    await waitFor(() => expect(screen.getByTestId("hdr").textContent).toBe("Kostprisens kilde er til kontroll"));
    expect(screen.queryByText(/606/)).toBeNull();
  });
  it("lasting: ingen sertifisering, ingen bufferpris", () => {
    gate = new Promise(() => undefined);
    rowFor = safe(0, 60.6035);
    render(<Strip />, { wrapper });
    expect(screen.getByTestId("hdr").textContent).toBe("Kontrollerer kostprisens kilde …");
    expect(screen.getAllByText("Kontrollerer prisgrunnlag …").length).toBeGreaterThan(0);
  });
});

describe("liste-hook og rene regler", () => {
  it("deaktivert observatør sertifiserer ikke hurtigbuffer", async () => {
    rowFor = safe(1, 61);
    const { result, rerender } = renderHook(({ en }) => useListPriceEvidence("E", ["rm1"], en), { wrapper, initialProps: { en: true } });
    await waitFor(() => expect(result.current.certified).not.toBeNull());
    rerender({ en: false });
    expect(result.current.certified).toBeNull();
  });
  const ev = (o: Partial<ListPriceEvidence>): ListPriceEvidence => ({
    rawMaterialId: "rm1", materialUpdatedAt: V, status: "unknown", reason: "x", costReason: null, invoiceReason: null, costEvidence: "eligible",
    invoiceEvidence: "unknown", currentPrice: 5, baseUnit: "kg", costBasisStatus: "verifisert", costEffectiveDate: null, invoiceId: "i", invoiceLineId: "l",
    invoiceNumber: "1", invoiceDate: "2026-09-01", invoicePricePerBaseUnit: null, deviationPct: null, ...o,
  });
  it("binding krever samme versjon og kostpris", () => {
    expect(bindEvidence({ id: "rm1", updatedAt: V, costPrice: 5 }, ev({}))).not.toBeNull();
    expect(bindEvidence({ id: "rm1", updatedAt: V, costPrice: 6 }, ev({}))).toBeNull();
    expect(bindEvidence({ id: "rm1", updatedAt: "2026-10-11T12:00:00.123457+00:00", costPrice: 5 }, ev({}))).toBeNull();
  });
  it("lagret verifisert uten bevis/avvist kilde er aldri verifisert; usikker faktura gir dato uten pris", () => {
    expect(costEvidenceFor("verifisert", null, false).status).toBe("ukjent");
    expect(costEvidenceFor("verifisert", ev({ costEvidence: "unknown", costReason: "cost_source_stale" }), false).status).toBe("kontroll");
    expect(costEvidenceFor("uverifisert", ev({}), false).status).toBe("uverifisert");
    const l = latestInvoiceOf(ev({ invoicePricePerBaseUnit: null }));
    expect(l.date).toBe("2026-09-01");
    expect(l.price).toBeNull();
    expect(latestInvoiceOf(null).date).toBeNull();
  });
  it("næringsverdier: små verdier rundes ikke bort", () => {
    expect(formatNutrientValue(0.01)).toBe("0,01");
    expect(formatNutrientValue(0.1)).toBe("0,1");
    expect(formatNutrientValue(0)).toBe("0");
    expect(formatNutrientValue(12.5)).toBe("12,5");
    expect(formatNutrientValue(0.0004)).toBe("0,0004");
    expect(nutrientChange(0, 0.01)).toBe("fra 0 til 0,01");
    expect(nutrientChange(0.01, 0.01)).toBe("uendret");
  });
});
