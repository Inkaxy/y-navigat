// @vitest-environment jsdom
/** Fase 4 avslutning: sjekkliste/peek-kost fra bundet bevis, referansekort uten foreldet «nå», næringspresisjon. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let rpcMode: "ok" | "pending" | "error" = "ok";
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => (rpcMode === "pending" ? new Promise(() => undefined) : Promise.resolve(rpcMode === "error" ? { data: null, error: { message: "x" } } : { data: { source: "last_purchase", price: 77.5, valid_from: "2026-09-01" }, error: null })) },
}));
vi.mock("@/hooks/useCompany", () => ({ useCompany: () => ({ data: { id: "E" } }) }));
vi.mock("@/fakturaer/hooks/useMatchTolerances", () => ({ useMatchTolerances: () => ({ toleranceFor: () => 3, byCategory: {} }) }));
vi.mock("@/fakturaer/lib/parseRpcJson", async (orig) => ({ ...(await orig<object>()), parsePriceReference: (d: unknown) => d }));

import { osloTodayISO } from "@/lib/osloDate";
import { completenessChecklist } from "@/ravarer/lib/rawMaterialSections";
import { formatNutrientValue, nutrientChange, nutritionValueDiff } from "@/ravarer/lib/nutritionLabels";
import { PriceBasisNowCard } from "@/ravarer/components/tabs/suppliers/PriceBasisNowCard";

const rm = {
  is_packaging: false, category: "mel", categories: null, declaration_name: "x", cost_basis_status: "verifisert", allergens_reviewed_at: null,
  package_size: null, package_unit: null, base_units_per_package: null, package_confirmed_at: null, package_confirmed_by: null,
};
const price = (ce: Parameters<typeof completenessChecklist>[0]["costEvidence"]) =>
  completenessChecklist({ rm, linkCount: 1, nutrition: null, hasDatasheet: false, costEvidence: ce }).find((c) => c.id === "prisgrunnlag");

describe("sjekkliste prisgrunnlag", () => {
  it("lagret verifisert men kilde foreldet/laster/ukontrollert er aldri ok", () => {
    expect(price({ status: "kontroll", reason: "Kostprisens kilde må kontrolleres" })).toMatchObject({ status: "partial", detail: "Kostprisens kilde må kontrolleres" });
    expect(price({ status: "ukjent", reason: "Kontrollerer kostprisens kilde …" })).toMatchObject({ status: "partial", detail: "Kontrollerer kostprisens kilde …" });
  });
  it("gyldig kost forblir ok (Combi, uavhengig av usikker faktura)", () => {
    expect(price({ status: "verifisert", reason: null })).toMatchObject({ status: "ok", detail: "Verifisert kostpris" });
  });
});

const wrap = (c: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
const card = <PriceBasisNowCard rawMaterialId="rm1" category={null} baseUnit="kg" links={[{ id: "L", supplier_id: "s", is_primary: true, notes: null }]} supplierNames={new Map([["s", "Lev"]])} />;

describe("PriceBasisNowCard", () => {
  it("vellykket: viser leverandørens referanse", async () => {
    rpcMode = "ok";
    render(card, { wrapper: wrap(new QueryClient({ defaultOptions: { queries: { retry: false } } })) });
    expect(await screen.findByText(/77,50/)).toBeTruthy();
  });
  it("feil etter tidligere svar: ingen bufret tall som gjeldende", async () => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    c.setQueryData(["rm-price-reference", "rm1", "s", osloTodayISO()], { source: "last_purchase", price: 77.5, valid_from: "2026-09-01" }, { updatedAt: 0 });
    rpcMode = "error";
    render(card, { wrapper: wrap(c) });
    expect(await screen.findByText("Kunne ikke hente prisgrunnlag")).toBeTruthy();
    expect(screen.queryByText(/77,50/)).toBeNull();
  });
  it("henter: ingen tall", () => {
    rpcMode = "pending";
    render(card, { wrapper: wrap(new QueryClient()) });
    expect(screen.getByText("Henter…")).toBeTruthy();
    expect(screen.queryByText(/kr|\d+,\d\d/)).toBeNull();
  });
});

describe("næringspresisjon (dialog + historikk)", () => {
  it.each([
    [0.01, 0.02, "0,01", "0,02", "+100 %"],
    [1.01, 1.04, "1,01", "1,04", "+3 %"],
    [1.0001, 1.0004, "1,0001", "1,0004", "+<0,1 %"],
    [0.00001, 0.00002, "0,00001", "0,00002", "+100 %"],
    [1.0004, 1.0001, "1,0004", "1,0001", "\u2212<0,1 %"],
  ])("%s → %s", (a, b, fa, fb, ch) => {
    expect(formatNutrientValue(a)).toBe(fa);
    expect(formatNutrientValue(b)).toBe(fb);
    expect(nutrientChange(a, b)).toBe(ch);
    expect(nutritionValueDiff("salt_g", a, b)).toMatchObject({ before: fa, after: fb, change: ch });
  });
  it("null/lik/0/ikke-endelig", () => {
    expect(nutritionValueDiff("salt_g", null, 0.01)).toMatchObject({ before: "—", after: "0,01", change: "ny" });
    expect(nutrientChange(0, 0)).toBe("uendret");
    expect(nutrientChange(0, 0.01)).toBe("fra 0 til 0,01");
    expect(formatNutrientValue(Number.NaN)).toBe("—");
    expect(nutrientChange(1, Number.POSITIVE_INFINITY)).toBe("—");
  });
});
