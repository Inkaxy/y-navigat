// @vitest-environment jsdom
/**
 * Produksjonsrenderer: Vareliste-kolonnene (buildVarelisteColumns) i felles DataTable.
 * Overskrift, celle og CSV skal ha samme rekkefølge — også med skjulte kolonner midt i listen
 * (regresjon: gammel rad rendret siste valgfrie celler i feil rekkefølge).
 */
import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/useUiPreference", () => ({ useUiPreference: <T,>(_s: string, f: T) => ({ value: f, setValue: vi.fn() }) }));

import { DataTable } from "@/ravarer/ui/DataTable";
import { buildVarelisteColumns } from "@/ravarer/components/vareliste/VarelisteCells";
import { LIST_COLUMNS } from "@/ravarer/lib/varelisteColumns";
import { tableCsv, visibleColumns } from "@/ravarer/ui/dataTableLogic";
import type { RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";

const item = {
  id: "r1", sku: "SKU-1", name: "Combisur", declarationName: null, categories: ["Mel"], itemType: "ravare", isActive: true, baseUnit: "kg",
  costPrice: 60.6035, costSource: "invoice", costUpdatedAt: "2026-08-18", agreedPrice: null, supplierId: "s1", supplierName: "Regal", supplierSku: null,
  primaryLinkId: null, matchedAlias: null, lastInvoicePrice: 60.6035, lastInvoiceDate: "2026-08-18", deviation: null,
  packageState: { kind: "unknown" }, volume12m: 480, currentStock: 7, stockTracking: true, minStock: null,
  hasNutrition: true, hasDatasheet: true, hasAllergens: true, searchText: "", aliases: [],
} as RawMaterialListItem;

const ctx = { canWrite: false, categoryOptions: [], toleranceFor: () => 5, hardCap: 15, editing: null, onStartEdit: vi.fn(), onCancelEdit: vi.fn(), onCommitPrice: vi.fn(), onCommitCategory: vi.fn(), listSearch: "" };

describe("Vareliste i felles DataTable — én kolonnerekkefølge", () => {
  it.each([[[]], [["category", "agreed", "volume_12m"]], [["price_source"]]])("skjult=%j: overskrift = celle = CSV", (hidden) => {
    const columns = buildVarelisteColumns(ctx);
    const vis = visibleColumns(columns, hidden);
    const { container } = render(
      <MemoryRouter><TooltipProvider>
        <DataTable rows={[item]} columns={columns} getId={(r) => r.id} hidden={hidden} ariaLabel="Råvarer" />
      </TooltipProvider></MemoryRouter>,
    );
    const table = container.querySelector("table");
    if (!table) throw new Error("ingen tabell");
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    const expected = LIST_COLUMNS.filter((c) => c.alwaysVisible || !hidden.includes(c.id)).map((c) => c.label);
    expect(heads).toEqual(expected);
    const cells = Array.from(table.querySelectorAll("tbody tr")[0].querySelectorAll("td"));
    expect(cells).toHaveLength(expected.length);
    const at = (id: string) => cells[vis.findIndex((c) => c.id === id)];
    expect(within(at("sku")).getByText("SKU-1")).toBeTruthy();
    expect(at("name").textContent).toContain("Combisur");
    expect(at("supplier").textContent).toContain("Regal");
    const csv = tableCsv([item], vis).split("\n");
    expect(csv[0].split(";")).toEqual(expected);
    const row = csv[1].split(";");
    expect(row[vis.findIndex((c) => c.id === "sku")]).toBe("SKU-1");
    expect(row[vis.findIndex((c) => c.id === "supplier")]).toBe("Regal");
  });
});
