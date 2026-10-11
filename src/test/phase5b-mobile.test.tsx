// @vitest-environment jsdom
/** Fase 5B/6 mobil: faktisk tellekort og faktiske mobilnøkkeltall. Ingen nettverk eller skriving. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CountLineCard } from "@/ravarer/pages/varetelling/CountLineCard";
import { MobileKpis } from "@/ravarer/components/stock/MobileKpis";
import { emptyRow } from "@/ravarer/components/stock/UnitAmountRows";

const row = { raw_material_id: "R", name: "Hvetemel", current_stock: 10, base_unit: "kg", current_cost_price: 2 };

describe("tellekort", () => {
  it("mengde og enhet har navn med vare og formål; handlerne kalles uendret", () => {
    const onRows = vi.fn(); const onLocation = vi.fn(); const onNote = vi.fn(); const onUse = vi.fn();
    render(<CountLineCard row={row} unitText={null} frozenBase={8} onUseNewStock={onUse} location="" onLocation={onLocation}
      note="" onNote={onNote} rows={[emptyRow()]} onRows={onRows} units={[]} diff={-1} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Telt mengde for Hvetemel" }), { target: { value: "9" } });
    expect(onRows).toHaveBeenCalledWith([{ amount: "9", unitKey: "__base" }]);
    expect(screen.getByRole("combobox", { name: "Enhet for telt mengde for Hvetemel" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Lokasjon for Hvetemel" }), { target: { value: "Kjøl" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Notat for Hvetemel" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Bruk ny beholdning" }));
    expect([onLocation.mock.calls[0][0], onNote.mock.calls[0][0], onUse.mock.calls.length]).toEqual(["Kjøl", "x", 1]);
    // Mobil: full bredde for lokasjon/notat, fysisk 44 px.
    for (const n of ["Lokasjon for Hvetemel", "Notat for Hvetemel"]) {
      const c = screen.getByRole("textbox", { name: n }).className;
      expect(c).toContain("w-full"); expect(c).toContain("h-[44px]");
    }
  });
});

describe("mobilnøkkeltall", () => {
  it("to primærtall i rutenett, resten merket i sammenleggbar detalj; ukjent forblir «–»", () => {
    render(<MobileKpis testId="k" secondaryLabel="Flere nøkkeltall"
      primary={[{ label: "Videresalg under minimum", value: "–" }, { label: "Oversolgt", value: "…" }]}
      secondary={[{ label: "Lagerverdi (videresalg)", value: "–" }]} />);
    const k = screen.getByTestId("k");
    expect(k.className).toContain("sm:hidden");
    expect(within(k).getByText("Videresalg under minimum").nextSibling?.textContent).toBe("–");
    const details = k.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByText("Flere nøkkeltall")).toBeTruthy();
    expect(within(details).getByText("Lagerverdi (videresalg)")).toBeTruthy();
  });
});
