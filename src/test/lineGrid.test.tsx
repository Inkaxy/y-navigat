// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LineGrid } from "@/varer/components/recipes/LineGrid";
import type { EditorLine } from "@/varer/components/recipes/RecipePartCard";

vi.mock("@/varer/context/AppContext", () => ({
  useAppContext: () => ({ legalEntityId: "le-1" }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return { supabase: { from: () => builder } };
});

function makeLine(id: string, sort: number): EditorLine {
  return {
    id,
    recipe_part_id: "part-1",
    raw_material_id: null,
    sub_product_id: null,
    ingredient_name: `Linje ${id}`,
    quantity: 100,
    unit: "g",
    waste_percent: 0,
    sort_order: sort,
    entry_mode: "grams",
    bakers_percent: null,
  };
}

function renderGrid(lines: EditorLine[], onAddLine: () => string | null) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <LineGrid
        partId="part-1"
        lines={lines}
        canWrite
        totalFlourG={100}
        rmMap={{}}
        entryMode="grams"
        onUpdateLine={() => {}}
        onRemoveLine={() => {}}
        onReorderLines={() => {}}
        onAddLine={onAddLine}
      />
    </QueryClientProvider>,
  );
}

describe("LineGrid tastaturnavigasjon", () => {
  it("Tab fra Mengde gir fokus på Enhet-select", async () => {
    const lines = [makeLine("l1", 0)];
    renderGrid(lines, () => null);

    const qty = screen.getByLabelText("Mengde") as HTMLInputElement;
    qty.focus();
    fireEvent.keyDown(qty, { key: "Tab" });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const unitSelect = document.querySelector<HTMLSelectElement>(
      '[data-grid-cell="l1:unit"] select',
    );
    expect(document.activeElement).toBe(unitSelect);
  });

  it("Enter på siste rad legger til ny rad og fokuserer navnecellen", () => {
    const lines = [makeLine("l1", 0)];
    const onAddLine = vi.fn(() => "l2");
    const { rerender } = renderGrid(lines, onAddLine);

    const waste = screen.getByLabelText("Svinn") as HTMLInputElement;
    waste.focus();
    fireEvent.keyDown(waste, { key: "Enter" });

    expect(onAddLine).toHaveBeenCalled();

    // Griddet fokuserer navnecellen for den nye raden når den vises.
    const qc = new QueryClient();
    rerender(
      <QueryClientProvider client={qc}>
        <LineGrid
          partId="part-1"
          lines={[...lines, makeLine("l2", 1)]}
          canWrite
          totalFlourG={100}
          rmMap={{}}
          entryMode="grams"
          onUpdateLine={() => {}}
          onRemoveLine={() => {}}
          onReorderLines={() => {}}
          onAddLine={onAddLine}
        />
      </QueryClientProvider>,
    );

    const nameInput = document.querySelector<HTMLInputElement>(
      '[data-grid-cell="l2:name"] input',
    );
    expect(nameInput).not.toBeNull();
  });
});
