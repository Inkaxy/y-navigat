// @vitest-environment jsdom
/** Produktets forhåndsvisning/kopi/utskrift etter ny beregning: godkjent versjon er standard. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const tables: Record<string, Record<string, unknown>> = {
  products: {
    declaration_version_id: "v1",
    // Ny beregning har skrevet over produktets løpende felt.
    manual_ingredient_declaration: "Hvetemel (*hvete*), *sesam*", manual_allergens_contains: ["hvete", "sesam"],
    manual_allergens_may_contain: [], manual_nutrition_per_100g: { energy_kj: 9 },
  },
  recipe_declaration_versions: {
    id: "v1", version: 4, approved_at: "2026-10-01T10:00:00Z",
    ingredient_text: "Hvetemel (hvete), vann", ingredient_html: "Hvetemel (<strong>hvete</strong>), vann",
    allergens_contains: ["hvete"], allergens_may_contain: [], nutrition_per_100g: { energy_kj: 1000 },
    coverage_pct: 100, net_weight_g: 500, shelf_life_days: 3, storage_text: null, origin_text: null,
    claim_grain: false, claim_keyhole: false, breadscale_pct: null,
  },
};
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (t: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tables[t] ?? null, error: null }) };
    return q;
  };
  return { supabase: { from } };
});

import { PreviewDialog, type ComputedDeclaration } from "@/varer/components/products/DeclarationTab";

const draft: ComputedDeclaration = {
  mode: "auto", mode_source: "recipe_label", product_recipe_link_id: "l", product_id: "p1", recipe_id: "r1",
  product_name: "Kneipp", total_input_grams: 0, final_weight_grams: 0,
  ingredient_declaration_html: "Hvetemel (<strong>hvete</strong>), <strong>sesam</strong>",
  nutrition_per_100g: { energy_kj: 9 }, allergens_contains: ["hvete", "sesam"], allergens_may_contain: [],
  data_quality: { lines_total: 0, master_lines: 0, extra_lines: 0, master_lines_without_raw_material: 0,
    extra_lines_without_raw_material: 0, master_lines_without_nutrition: 0, extra_lines_without_nutrition: 0,
    nutrition_coverage_pct: 100, yield_grams_set: true },
  warnings: [], computed_lines: [],
};

describe("PreviewDialog etter ny beregning", () => {
  let clip: string[];
  let blobs: string[];
  beforeEach(() => {
    clip = []; blobs = [];
    Object.assign(navigator, { clipboard: { writeText: (t: string) => { clip.push(t); return Promise.resolve(); } } });
    URL.createObjectURL = (b: Blob | MediaSource) => { void (b as Blob).text().then((t) => blobs.push(t)); return "blob:x"; };
    URL.revokeObjectURL = () => {};
    window.open = () => null;
  });

  it("viser, kopierer og skriver ut godkjent versjon som standard; kladd er merket", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PreviewDialog open onClose={() => {}} productName="Kneipp" productId="p1" computed={draft} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /Sist godkjente \(versjon 4\)/ });
    expect(screen.queryByText(/sesam/)).toBeNull();
    expect(screen.queryByText(/KLADD/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Kopier tekst/ }));
    expect(clip[0]).toContain("Ingredienser: Hvetemel (**hvete**), vann");
    expect(clip[0]).not.toMatch(/sesam|KLADD/);

    fireEvent.click(screen.getByRole("button", { name: /Skriv ut$/ }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(blobs[0]).toContain("<strong>hvete</strong>), vann");
    expect(blobs[0]).not.toMatch(/sesam|KLADD/);

    fireEvent.click(screen.getByRole("button", { name: /Ny beregning – forslag/ }));
    fireEvent.click(screen.getByRole("button", { name: /Kopier kladd/ }));
    expect(clip[1]).toMatch(/^KLADD – ikke godkjent/);
  });
});
