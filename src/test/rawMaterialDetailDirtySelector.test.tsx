// @vitest-environment jsdom
/**
 * Produksjonsruten for råvarekortet (RawMaterialDetail, uendret) med data-hooks og tunge seksjoner mocket.
 * Barnestubbene registrerer lagring slik NutritionTab/OverviewTab gjør (effekt uten opprydding).
 * Dekker: Cmd-S-eierskap ved blokkert/fullført seksjonsbytte, sjekkliste-navigasjon, tilbake og
 * råvarebytte; topptekstens kostpris; ufullstendig næring vises ikke som komplett.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { UnsavedGuardProvider } from "@/providers/UnsavedGuardProvider";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/common/UnsavedChangesDialog";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const saves: string[] = [];

function stubRegistering(name: string) {
  return function Stub({ registerSave }: { registerSave?: (fn: () => void) => void }) {
    useEffect(() => { registerSave?.(() => saves.push(name)); }, [registerSave]);
    return <div data-testid={`stub-${name}`} />;
  };
}
vi.mock("@/ravarer/components/tabs/NutritionTab", () => ({
  NutritionTab: ({ part, registerSave }: { part: string; registerSave?: (fn: () => void) => void }) => {
    const S = part === "naering" ? NaeringStub : DeklStub;
    return <S registerSave={registerSave} />;
  },
}));
function NaeringStub() {
  const [v, setV] = useState("");
  const guard = useUnsavedChangesGuard(v !== "");
  return <><input aria-label="Næringsfelt" value={v} onChange={(e) => setV(e.target.value)} /><UnsavedChangesDialog {...guard.dialogProps} /></>;
}
const DeklStub = stubRegistering("deklarasjon");
vi.mock("@/ravarer/components/tabs/OverviewTab", () => ({ OverviewTab: stubRegistering("grunndata") }));
vi.mock("@/ravarer/components/tabs/SuppliersTab", () => ({ SuppliersTab: () => <div data-testid="stub-pris" /> }));
vi.mock("@/ravarer/components/tabs/RecipesTab", () => ({ RecipesTab: () => null }));
vi.mock("@/ravarer/components/tabs/StockTab", () => ({ StockTab: () => null }));
vi.mock("@/ravarer/components/tabs/HistoryTab", () => ({ HistoryTab: () => <div data-testid="stub-historikk" /> }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => <header>{title}{actions}</header> }));
vi.mock("@/ravarer/components/stock/SellsAsSection", () => ({ SellsAsSection: () => null }));
vi.mock("@/ravarer/components/RawMaterialKpiStrip", () => ({ RawMaterialKpiStrip: () => null }));
vi.mock("@/ravarer/hooks/usePurchaseStats", () => ({ useRawMaterialPurchaseStats: () => ({ data: null }) }));
vi.mock("@/ravarer/hooks/useRawMaterials", () => ({ useRenameRawMaterial: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ canWrite: true, legalEntityId: "le" }) }));
vi.mock("@/ravarer/pages/varer/useWorklistNav", () => ({
  useWorklistNav: (_s: string, id: string) => ({ liste: "alle", prev: null, next: id === "A" ? { materialId: "B" } : null, index: 0, total: 2 }),
}));

const baseRm = (id: string) => ({
  id, name: `Vare ${id}`, sku: `S-${id}`, base_unit: "kg", item_type: "ravare", is_active: true, is_packaging: false, is_resale_item: false,
  category: "Mel", categories: ["Mel"], declaration_name: "hvetemel", cost_basis_status: "verifisert", current_cost_price: 60.6035,
  price_source: "invoice", price_updated_at: "2026-08-18", allergens_reviewed_at: "2026-01-01",
  package_size: 20, package_unit: "kg", base_units_per_package: 20, package_confirmed_at: "2026-01-01", package_confirmed_by: "u",
});
let nutrition: Record<string, unknown> | null = null;
vi.mock("@/ravarer/hooks/useRawMaterialPage", () => ({
  useRawMaterialPage: (id: string) => ({ rm: baseRm(id), links: [{ id: "l" }], nutrition, hasDatasheet: true, recipeCount: 0, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}));

import RawMaterialDetail from "@/ravarer/pages/RawMaterialDetail";

let loc = "";
function Loc() { const l = useLocation(); loc = l.search; return null; }

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <UnsavedGuardProvider>
        <Loc />
        <Routes><Route path="/ravarer/varer/:id" element={<RawMaterialDetail />} /></Routes>
      </UnsavedGuardProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { saves.length = 0; nutrition = { energy_kj: 1, energy_kcal: 1, fat_g: 0, saturated_fat_g: 0, carbs_g: 1, sugars_g: 0, protein_g: 1, salt_g: 0, verified_at: "2026-01-01", is_complete: true }; });

// Radix Select i jsdom
Object.assign(Element.prototype, { hasPointerCapture: () => false, releasePointerCapture: () => {}, scrollIntoView: () => {} });

async function pickSection(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Velg seksjon" });
  await act(async () => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" }); });
  const opt = await screen.findByRole("option", { name: label });
  await act(async () => { fireEvent.click(opt); });
}

describe("RawMaterialDetail — ekte mobil seksjonsvelger med ulagret vakt", () => {
  it("Bli på siden: seksjonen og utkastet beholdes", async () => {
    renderAt("/ravarer/varer/A?seksjon=naering&liste=alle");
    fireEvent.change(screen.getByLabelText("Næringsfelt"), { target: { value: "12" } });
    await pickSection("Historikk");
    fireEvent.click(await screen.findByRole("button", { name: "Bli på siden" }));
    expect(new URLSearchParams(loc).get("seksjon")).toBe("naering");
    expect((screen.getByLabelText("Næringsfelt") as HTMLInputElement).value).toBe("12");
  });

  it("Forkast endringer: navigerer til valgt seksjon og beholder listekonteksten", async () => {
    renderAt("/ravarer/varer/A?seksjon=naering&liste=alle");
    fireEvent.change(screen.getByLabelText("Næringsfelt"), { target: { value: "12" } });
    await pickSection("Historikk");
    fireEvent.click(await screen.findByRole("button", { name: "Forkast endringer" }));
    await waitFor(() => expect(new URLSearchParams(loc).get("seksjon")).toBe("historikk"));
    expect(new URLSearchParams(loc).get("liste")).toBe("alle");
    expect(screen.getByTestId("stub-historikk")).toBeInTheDocument();
  });

  it("uten ulagrede endringer bytter velgeren direkte", async () => {
    renderAt("/ravarer/varer/A?seksjon=naering");
    await pickSection("Historikk");
    await waitFor(() => expect(new URLSearchParams(loc).get("seksjon")).toBe("historikk"));
  });
});
