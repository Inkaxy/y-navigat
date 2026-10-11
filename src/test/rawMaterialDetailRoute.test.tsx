// @vitest-environment jsdom
/**
 * Produksjonsruten for råvarekortet (RawMaterialDetail, uendret) med data-hooks og tunge seksjoner mocket.
 * Barnestubbene registrerer lagring slik NutritionTab/OverviewTab gjør (effekt uten opprydding).
 * Dekker: Cmd-S-eierskap ved blokkert/fullført seksjonsbytte, sjekkliste-navigasjon, tilbake og
 * råvarebytte; topptekstens kostpris; ufullstendig næring vises ikke som komplett.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateOptions, type To } from "react-router-dom";

const saves: string[] = [];
let blockNav = false;

vi.mock("@/providers/UnsavedGuardProvider", () => ({
  useGuardedNavigate: () => {
    const nav = useNavigate();
    return (to: To | number, opts?: NavigateOptions) => {
      if (blockNav) return; // brukeren valgte «Bli» i ulagret-dialogen
      if (typeof to === "number") nav(to); else nav(to, opts);
    };
  },
}));

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
const NaeringStub = stubRegistering("naering");
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

let navRef: ((to: string) => void) | null = null;
function NavProbe() { const n = useNavigate(); navRef = (to) => n(to); return null; }

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <NavProbe />
      <Routes><Route path="/ravarer/varer/:id" element={<RawMaterialDetail />} /></Routes>
    </MemoryRouter>,
  );
}
const cmdS = () => act(() => { fireEvent.keyDown(window, { key: "s", metaKey: true }); });

beforeEach(() => { saves.length = 0; blockNav = false; nutrition = { energy_kj: 1, energy_kcal: 1, fat_g: 0, saturated_fat_g: 0, carbs_g: 1, sugars_g: 0, protein_g: 1, salt_g: 0, verified_at: "2026-01-01", is_complete: true }; });

describe("RawMaterialDetail — Cmd-S eierskap (produksjonsrute)", () => {
  it("blokkert seksjonsbytte beholder gjeldende lagring", async () => {
    renderAt("/ravarer/varer/A?seksjon=naering");
    cmdS();
    expect(saves).toEqual(["naering"]);
    blockNav = true;
    // Seksjonslenke i sidemenyen (vakten blokkerer → URL uendret)
    await act(async () => { navRef?.("/ravarer/varer/A?seksjon=naering"); });
    cmdS();
    expect(saves).toEqual(["naering", "naering"]);
  });

  it("bytte til ikke-redigerbar seksjon (sjekkliste/URL) frigir gammel lagring", async () => {
    renderAt("/ravarer/varer/A?seksjon=naering");
    await act(async () => { navRef?.("/ravarer/varer/A?seksjon=historikk"); });
    expect(screen.getByTestId("stub-historikk")).toBeInTheDocument();
    cmdS();
    expect(saves).toEqual([]);
  });

  it("tilbake til redigerbar seksjon og råvarebytte: bare montert seksjon for gjeldende råvare lagrer", async () => {
    renderAt("/ravarer/varer/A?seksjon=grunndata");
    await act(async () => { navRef?.("/ravarer/varer/A?seksjon=pris"); });
    cmdS();
    await act(async () => { navRef?.("/ravarer/varer/A?seksjon=deklarasjon"); });
    cmdS();
    await act(async () => { navRef?.("/ravarer/varer/B?seksjon=deklarasjon"); });
    cmdS();
    expect(saves).toEqual(["deklarasjon", "deklarasjon"]);
  });
});

describe("RawMaterialDetail — topptekst og sjekkliste", () => {
  it("viser gjeldende kostpris med status, presisjon og kilde i den faste toppteksten", () => {
    renderAt("/ravarer/varer/A?seksjon=historikk");
    const h = screen.getByTestId("header-cost");
    expect(h).toHaveTextContent("Verifisert");
    expect(h).toHaveTextContent("60,6035");
  });

  it("ufullstendig næring med verifiseringstidspunkt er ikke «ok»", () => {
    nutrition = { energy_kj: 1, energy_kcal: null, fat_g: 0, saturated_fat_g: 0, carbs_g: 1, sugars_g: 0, protein_g: 1, salt_g: 0, verified_at: "2026-01-01", is_complete: true };
    renderAt("/ravarer/varer/A");
    expect(screen.getAllByText(/Ufullstendig — mangler energi \(kcal\)/).length).toBeGreaterThan(0);
  });
});
