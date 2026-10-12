// @vitest-environment jsdom
/** R192/R195: innsyn fra reberegning til eksisterende pris-/kildevisning og pakningslisten; endring bare fra serverens tall. */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecalcDrilldown, costChange } from "@/ravarer/pages/reberegn/reberegnColumns";

describe("reberegning: kilde og pakning", () => {
  it("lenker til råvarekortets prisseksjon og pakningslisten med valgt vare", () => {
    render(<MemoryRouter><RecalcDrilldown rawMaterialId="rm-1" name="Mel" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Pris, prishistorikk og fakturaer for Mel" }).getAttribute("href")).toBe("/ravarer/varer/rm-1?seksjon=pris");
    expect(screen.getByRole("link", { name: "Pakning for Mel" }).getAttribute("href")).toBe("/ravarer/varer?liste=pakning&valgt=rm-1");
  });
  it("endring finnes bare når begge tall er bevist", () => {
    expect(costChange(10, 12.5)).toBe(2.5);
    expect(costChange(null, 12)).toBeNull();
    expect(costChange(10, Number.NaN)).toBeNull();
  });
});
