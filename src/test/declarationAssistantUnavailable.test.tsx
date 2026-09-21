// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue({
    data: {
      available: false,
      code: "not_configured",
      message: "Deklarasjonsassistenten er ikke satt opp ennå",
    },
    error: null,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeclarationAssistantPanel } from "@/varer/components/declaration/DeclarationAssistantPanel";

describe("deklarasjonsassistent uten oppsett", () => {
  it("beholder forhåndsvisningen og viser vei til innstillingene", async () => {
    render(
      <MemoryRouter>
        <DeclarationAssistantPanel
          target="product"
          targetId="product-1"
          value="hvetemel, vann"
          canWrite
          onApply={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Forhåndsvisning (uten AI)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kontroller med AI" }));

    await waitFor(() => {
      expect(screen.getByText(/Deklarasjonsassistenten er ikke satt opp ennå/)).toBeTruthy();
    });
    const settingsLink = screen.getByRole("link", {
      name: "Åpne innstillingene for deklarasjonsassistenten",
    });
    expect(settingsLink.getAttribute("href")).toBe("/varer/innstillinger/deklarasjonsassistent");
    expect(screen.getByText("Forhåndsvisning (uten AI)")).toBeTruthy();
  });
});