// @vitest-environment jsdom
/** Ekte gjennomgangsvisning (skrivebeskyttet forhåndsvisning): presisjon, trykkflater, fast bunnlinje. */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import DatasheetReviewPreviewContent from "@/dev/DatasheetReviewPreviewContent";

describe("DatasheetReviewView", () => {
  it("salt 0,01 vises som 0,01 og uendret, ikke 0", () => {
    render(<DatasheetReviewPreviewContent />);
    const salt = screen.getByRole("checkbox", { name: /Salt.*fra databladet/i }).closest("tr") as HTMLElement;
    expect(within(salt).getAllByText("0,01")).toHaveLength(2);
    expect(within(salt).getByText("uendret")).toBeTruthy();
  });
  it("hver næringsrad har en 44 px merket trykkflate som veksler valget", () => {
    render(<DatasheetReviewPreviewContent />);
    const targets = screen.getAllByTestId("nutrient-target");
    expect(targets.length).toBeGreaterThan(5);
    for (const t of targets) expect(t.className).toMatch(/min-h-\[44px\].*min-w-\[44px\]/);
    const cb = within(targets[0]).getByRole("checkbox");
    const before = cb.getAttribute("aria-checked");
    fireEvent.click(targets[0]);
    expect(cb.getAttribute("aria-checked")).not.toBe(before);
  });
  it("innholdet ruller separat, handlinger står i fast bunnlinje, lukk er norsk og 44 px", () => {
    render(<DatasheetReviewPreviewContent />);
    expect(screen.getByTestId("review-body").className).toMatch(/overflow-y-auto/);
    const footer = screen.getByTestId("review-footer");
    expect(footer.className).toMatch(/shrink-0/);
    expect(within(footer).getByRole("button", { name: /Anvend valgte/ })).toBeTruthy();
    const close = screen.getByRole("button", { name: "Lukk" });
    expect(close.className).toMatch(/h-\[44px\].*w-\[44px\]/);
  });
});
