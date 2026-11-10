// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/functions-js";
import { describe, expect, it, vi } from "vitest";

const KEY_REJECTED = "OpenAI avviste nøkkelen. Kontroller oppsettet i innstillingene.";

function rejectedKeyResponse() {
  const res = new Response(JSON.stringify({ error: KEY_REJECTED, code: "provider_error" }), {
    status: 502,
    headers: { "Content-Type": "application/json" },
  });
  return { data: null, error: new FunctionsHttpError(res) };
}

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DeclarationAssistantPanel } from "@/varer/components/declaration/DeclarationAssistantPanel";
import { DeclarationAllergenExtractor } from "@/varer/components/declaration/DeclarationAllergenExtractor";

describe("OpenAI avviser nøkkelen (502 provider_error)", () => {
  it("AI-kontrollen viser meldingen og beholder forhåndsvisningen", async () => {
    invoke.mockResolvedValueOnce(rejectedKeyResponse());
    const onApply = vi.fn();
    render(
      <MemoryRouter>
        <DeclarationAssistantPanel
          target="recipe"
          targetId="recipe-1"
          value="*hvete*mel, vann"
          canWrite
          onApply={onApply}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kontroller med AI" }));
    await waitFor(() => expect(screen.getByText(KEY_REJECTED)).toBeTruthy());
    expect(screen.getByText("Forhåndsvisning (uten AI)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kontroller med AI" })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("allergenhjelpen viser meldingen uten å endre felter", async () => {
    const onApply = vi.fn();
    render(
      <DeclarationAllergenExtractor
        target="recipe"
        targetId="recipe-1"
        value="*hvete*mel, vann"
        current={{ contains: "", mayContain: "" }}
        canWrite
        onApply={onApply}
        invoke={() => Promise.resolve(rejectedKeyResponse())}
      />,
    );
    const btn = screen.getAllByRole("button")[0];
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(KEY_REJECTED)).toBeTruthy());
    expect(onApply).not.toHaveBeenCalled();
  });
});
