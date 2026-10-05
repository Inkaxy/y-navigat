// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeclarationAllergenExtractor } from "@/varer/components/declaration/DeclarationAllergenExtractor";
import { sourceFingerprint } from "@/varer/lib/declarationProposal";

const TEXT = "Hvetemel, vann, melk, gjær og salt.";
const ok = (text: string) => ({
  data: {
    mode: "allergens",
    source_fingerprint: sourceFingerprint(text),
    extraction: {
      contains: [
        { code: "gluten_wheat", label: "hvete", evidence: "Hvetemel" },
        { code: "milk", label: "melk", evidence: "melk" },
      ],
      mayContain: [],
      traceStatement: { stated: false, evidence: null },
      uncertainties: [],
      rejected: [],
    },
  },
  error: null,
});

const base = { target: "recipe" as const, targetId: "11111111-1111-1111-1111-111111111111", canWrite: true, current: { contains: "", mayContain: "" } };

describe("DeclarationAllergenExtractor", () => {
  it("viser kilde, «ikke oppgitt» for spor og overfører først ved klikk", async () => {
    const onApply = vi.fn();
    const invoke = vi.fn().mockResolvedValue(ok(TEXT));
    render(<DeclarationAllergenExtractor {...base} value={TEXT} onApply={onApply} invoke={invoke} />);
    fireEvent.click(screen.getByRole("button", { name: /Hent allergener fra deklarasjon/ }));
    await screen.findByText("kilde: «Hvetemel»");
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ mode: "allergens", draft_text: TEXT }));
    expect(screen.getByText("Ikke oppgitt i deklarasjonen")).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Bruk allergenforslag" }));
    expect(onApply.mock.calls[0][0].next).toEqual({ contains: "hvete, melk", mayContain: "" });
  });

  it("svar for gammel tekst kan ikke brukes", async () => {
    let resolve: (v: unknown) => void = () => {};
    const invoke = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const { rerender } = render(<DeclarationAllergenExtractor {...base} value={TEXT} onApply={vi.fn()} invoke={invoke} />);
    fireEvent.click(screen.getByRole("button", { name: /Hent allergener fra deklarasjon/ }));
    rerender(<DeclarationAllergenExtractor {...base} value={TEXT + " Egg."} onApply={vi.fn()} invoke={invoke} />);
    await act(async () => resolve(ok(TEXT)));
    await waitFor(() => expect(screen.getByText(/Teksten er endret etter/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Bruk allergenforslag" })).toBeNull();
  });

  it("bytte av oppskrift mens AI kjører forkaster svaret", async () => {
    let resolve: (v: unknown) => void = () => {};
    const invoke = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const { rerender } = render(<DeclarationAllergenExtractor {...base} value={TEXT} onApply={vi.fn()} invoke={invoke} />);
    fireEvent.click(screen.getByRole("button", { name: /Hent allergener fra deklarasjon/ }));
    rerender(<DeclarationAllergenExtractor {...base} targetId="22222222-2222-2222-2222-222222222222" value={TEXT} onApply={vi.fn()} invoke={invoke} />);
    await act(async () => resolve(ok(TEXT)));
    expect(screen.queryByText("kilde: «Hvetemel»")).toBeNull();
  });

  it("ugyldig modellsvar gir feilmelding og ingen forslag", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { mode: "allergens", source_fingerprint: "x", extraction: {} }, error: null });
    render(<DeclarationAllergenExtractor {...base} value={TEXT} onApply={vi.fn()} invoke={invoke} />);
    fireEvent.click(screen.getByRole("button", { name: /Hent allergener fra deklarasjon/ }));
    await screen.findByText(/ble forkastet/);
    expect(screen.queryByRole("button", { name: "Bruk allergenforslag" })).toBeNull();
  });
});
