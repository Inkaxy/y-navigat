import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiSuggestionCard } from "@/fakturaer/components/AiSuggestionCard";
import { parseAiSuggestion } from "@/fakturaer/lib/aiLineSuggestion";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

describe("AiSuggestionCard", () => {
  it("nytt utkast åpner eksisterende opprettelse med utkastet", () => {
    const s = parseAiSuggestion({ decision: "new_draft", line_class: "vare", draft: { name: "Pistasjpasta", item_type: "ravare", category: "Fyll", base_unit: "kg", supplier_sku: "P1" }, missing: ["pakningsstørrelse"], price_basis: "ukjent" })!;
    const onCreate = vi.fn();
    render(<AiSuggestionCard suggestion={s} rawMaterialName={null} canWrite onCreateDraft={onCreate} />);
    expect(screen.getByText("pakningsstørrelse")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Opprett ny vare/ }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Pistasjpasta", itemType: "ravare", category: "Fyll", baseUnit: "kg" });
  });
  it("lesetilgang gir ingen handlinger", () => {
    const s = parseAiSuggestion({ decision: "existing", raw_material_id: "rm-1", line_class: "vare" })!;
    render(<AiSuggestionCard suggestion={s} rawMaterialName="Mel" canWrite={false} onApply={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
