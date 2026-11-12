import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LabelMarksCard } from "@/varer/components/recipes/label/LabelMarksCard";

const base = {
  canWrite: true,
  saving: false,
  links: [],
  grain: { claim: false, effectivePct: 58, manual: false, locked: false, lockedReason: null, details: <p>grovhetsdetaljer</p> },
  keyhole: { claim: false, result: null, locked: true, lockedReason: "Låst til alle kriteriene er oppfylt.", details: <p>nøkkelhulldetaljer</p> },
};

describe("Merker-kortet", () => {
  it("bryteren kan ikke slås på når kravene ikke er oppfylt, og raden sier hvorfor", () => {
    const onToggle = vi.fn();
    render(<MemoryRouter><LabelMarksCard {...base} onToggleClaim={onToggle} /></MemoryRouter>);
    const keyhole = screen.getByRole("switch", { name: /Nøkkelhullet/ });
    expect(keyhole).toBeDisabled();
    expect(screen.getByText("Låst til alle kriteriene er oppfylt.")).toBeTruthy();
    fireEvent.click(keyhole);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("brødskala-bryteren lagrer bare merkevalget via onToggleClaim", () => {
    const onToggle = vi.fn();
    render(<MemoryRouter><LabelMarksCard {...base} onToggleClaim={onToggle} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("switch", { name: /Brødskala/ }));
    expect(onToggle).toHaveBeenCalledWith("label_claim_grain", true);
  });

  it("beregnet nivå er markert på skalaen", () => {
    render(<MemoryRouter><LabelMarksCard {...base} onToggleClaim={vi.fn()} /></MemoryRouter>);
    const current = document.querySelector("[aria-current='true'], [aria-current='step']");
    expect(current?.textContent).toContain("Grovt");
  });
});
