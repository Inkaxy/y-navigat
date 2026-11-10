// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecipeRemainingPanel, type RemainingSource } from "@/varer/components/recipes/detail/RecipeRemainingPanel";
import { ProfitTable, type ProfitRow } from "@/varer/components/recipes/detail/ProfitTable";
import { RecipeTabBar } from "@/varer/components/recipes/detail/RecipeTabBar";
import { composeRemaining, labelItems } from "@/varer/lib/recipeRemaining";
import type { RecipeProductLinkRow } from "@/varer/hooks/useRecipeProductLinks";
import type { ProductMargins } from "@/varer/hooks/useProductCalc";

const ready: RemainingSource[] = [
  { key: "varsler", label: "råvaredata", state: "ready" },
  { key: "merking", label: "merkedata", state: "ready" },
];

describe("«Gjenstår»-panelet", () => {
  it("tom liste med alle kilder hentet viser «Alt påkrevd er på plass»", () => {
    render(<RecipeRemainingPanel summary={composeRemaining([])} sources={ready} collapsible={false} onSelect={() => {}} />, { wrapper: MemoryRouter });
    expect(screen.getAllByText("Alt påkrevd er på plass").length).toBeGreaterThan(0);
  });

  it("en kilde som laster eller feiler gir aldri «Alt påkrevd er på plass»", () => {
    const retry = vi.fn();
    render(
      <RecipeRemainingPanel
        summary={composeRemaining([])}
        sources={[{ key: "varsler", label: "råvaredata", state: "loading" }, { key: "merking", label: "merkedata", state: "error", retry }]}
        collapsible={false}
        onSelect={() => {}}
      />,
      { wrapper: MemoryRouter },
    );
    expect(screen.queryByText("Alt påkrevd er på plass")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Kunne ikke hente merkedata");
    fireEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("punktene er knapper som sender fane og mål; sperrende først", () => {
    const onSelect = vi.fn();
    const summary = composeRemaining([
      labelItems({
        checklist: [
          { key: "storage", label: "Oppbevaring", level: "warn", detail: "Oppbevaring mangler" },
          { key: "shelf_life", label: "Holdbarhet", level: "error", detail: "Holdbarhet mangler" },
        ],
        blockReasons: [],
        declarationManual: false,
      }),
    ]);
    render(<RecipeRemainingPanel summary={summary} sources={ready} collapsible={false} onSelect={onSelect} />, { wrapper: MemoryRouter });
    const must = screen.getByText("Må rettes før godkjenning").parentElement!;
    const should = screen.getByText("Bør sjekkes").parentElement!;
    expect(within(must).getByText("Holdbarhet")).toBeTruthy();
    expect(within(should).getByText("Oppbevaring")).toBeTruthy();
    fireEvent.click(within(must).getByRole("button", { name: /Holdbarhet/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ tab: "merking", target: { kind: "label", key: "shelf_life" } }));
  });

  it("på smal skjerm kan listen foldes sammen, overskriften vises alltid", () => {
    render(<RecipeRemainingPanel summary={composeRemaining([])} sources={ready} collapsible onSelect={() => {}} />, { wrapper: MemoryRouter });
    const toggle = screen.getByRole("button", { name: /Vis/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("gjenstar-liste")).toBeNull();
    fireEvent.click(toggle);
    expect(document.getElementById("gjenstar-liste")).not.toBeNull();
  });
});

const link = (over: Partial<RecipeProductLinkRow> = {}): RecipeProductLinkRow => ({
  id: "link-1",
  product_id: "p1",
  is_primary: true,
  declaration_mode: null,
  extra_lines: [],
  sales_unit_basis: null,
  units_per_sales_unit: null,
  sales_unit_weight_g: null,
  units_per_batch_override: null,
  products: { id: "p1", display_name: "Grovbrød", display_number: 101, status: "active", unit_of_sale: "stk", weight_per_unit_grams: 750, calc_type: "oppskrift" },
  ...over,
});

const withCost: ProductMargins = {
  has_cost: true,
  calc_type: "oppskrift",
  cost: { raw_cost: 8.5, labor_cost: 10, energy_cost: 1.5, cost_price: 20, notes: [] },
  levels: [
    {
      price_list_id: "u", code: null, name: "Butikk", price_level: "utsalg", is_provisional: false, price: 45,
      price_with_packaging: null, brutto_pct: 81.11, db2: 25, dg2_pct: 55.56, target_brutto_pct: 70, target_dg2_pct: 40,
      target_source: "kategori", avvik_pp: 11.11, needed_price: 33.33, needed_change_pct: -25.9, status: "gronn",
    },
    {
      price_list_id: "e", code: null, name: "Engros", price_level: "engros", is_provisional: false, price: 25,
      price_with_packaging: null, brutto_pct: 66, db2: 5, dg2_pct: 20, target_brutto_pct: 60, target_dg2_pct: 30,
      target_source: "kategori", avvik_pp: -10, needed_price: 28.57, needed_change_pct: 14.3, status: "rod",
    },
  ],
};

function table(rows: ProfitRow[]) {
  return render(
    <ProfitTable rows={rows} currentProductId={null} canWrite busy={false} onUnlink={() => {}} />,
    { wrapper: MemoryRouter },
  );
}

describe("Varer og lønnsomhet", () => {
  it("viser Brutto og DG2 per prisnivå nøyaktig som product_margins gir dem, og kilopris fra registrert vekt", () => {
    table([{ link: link(), state: "ready", margins: withCost, retry: () => {} }]);
    expect(screen.getByText(/Brutto 81,1 %/)).toBeTruthy();
    expect(screen.getByText(/DG2 55,6 %/)).toBeTruthy();
    expect(screen.getByText(/Brutto 66,0 %/)).toBeTruthy();
    expect(screen.getByText(/DG2 20,0 %/)).toBeTruthy();
    // 45 kr / 0,75 kg = 60 kr/kg
    expect(screen.getByText("60,00 kr/kg")).toBeTruthy();
    expect(screen.getByText("Svak")).toBeTruthy();
    expect(screen.getByText("God")).toBeTruthy();
    expect(screen.getByText("Ingen prisliste")).toBeTruthy();
  });

  it("vare uten kost viser årsakene, ikke 0", () => {
    table([{ link: link(), state: "ready", margins: { has_cost: false, cost: { notes: ["Smør mangler kostpris"] }, levels: [] }, retry: () => {} }]);
    expect(screen.getByText("Smør mangler kostpris")).toBeTruthy();
    expect(screen.queryByText(/0,00 kr/)).toBeNull();
    expect(screen.queryByText(/Brutto \d/)).toBeNull();
  });

  it("mangler vekt per salgsenhet vises kiloprisen som «–», ikke 0", () => {
    table([{ link: link({ products: { ...link().products!, weight_per_unit_grams: null } }), state: "ready", margins: withCost, retry: () => {} }]);
    expect(screen.queryByText(/kr\/kg/)).toBeNull();
    expect(screen.getAllByText("– /kg").length).toBe(2);
  });

  it("kalkyle som ikke kan hentes er ukjent med «Prøv igjen»", () => {
    const retry = vi.fn();
    table([{ link: link(), state: "error", margins: undefined, retry }]);
    expect(screen.getByRole("alert").textContent).toContain("Tallene er ukjente");
    fireEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(retry).toHaveBeenCalled();
  });

  it("primærmerke, arvet/overstyrt og «Koble fra» med navn; varen man står på kan ikke kobles fra", () => {
    const onUnlink = vi.fn();
    render(
      <ProfitTable
        rows={[
          { link: link(), state: "ready", margins: withCost, retry: () => {} },
          { link: link({ id: "link-2", product_id: "p2", is_primary: false, declaration_mode: "manual", products: { ...link().products!, id: "p2", display_name: "Grovbrød halv" } }), state: "ready", margins: withCost, retry: () => {} },
        ]}
        currentProductId="p1"
        canWrite
        busy={false}
        onUnlink={onUnlink}
      />,
      { wrapper: MemoryRouter },
    );
    expect(screen.getByText("Primær")).toBeTruthy();
    expect(screen.getByText("Arvet")).toBeTruthy();
    expect(screen.getByText("Overstyrt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Koble fra Grovbrød" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Koble fra Grovbrød halv" }));
    expect(onUnlink).toHaveBeenCalledWith({ id: "link-2", name: "Grovbrød halv" });
  });

  it("raden kan åpnes og viser DB2, avvik og pris som trengs", () => {
    table([{ link: link(), state: "ready", margins: withCost, retry: () => {} }]);
    fireEvent.click(screen.getByRole("button", { name: /Vis detaljer/ }));
    expect(screen.getByText("Kostoppsett")).toBeTruthy();
    expect(screen.getAllByText("25,00 kr").length).toBeGreaterThan(0);
    expect(screen.getByText(/^[−-]10,0 pp$/)).toBeTruthy();
    expect(screen.getByText("28,57 kr")).toBeTruthy();
  });
});

describe("fanelinjen", () => {
  it("knapper med antall og hake bare når kildene er kjent", () => {
    const onChange = vi.fn();
    render(
      <RecipeTabBar
        active="oppskrift"
        onChange={onChange}
        indicators={{ oppskrift: { must: 2, should: 1, known: true }, varer: { must: 0, should: 0, known: false }, merking: { must: 0, should: 0, known: true } }}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON"]);
    expect(tabs[0].textContent).toContain("2");
    expect(tabs[0].textContent).toContain("2 må rettes");
    expect(tabs[2].textContent).not.toContain("ferdig");
    expect(tabs[3].textContent).toContain("ferdig");
    fireEvent.click(screen.getByRole("tab", { name: /Merking/ }));
    expect(onChange).toHaveBeenCalledWith("merking");
  });
});
