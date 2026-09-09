import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Sjekker at lenkene useRecipeWarnings genererer mot /ravarer/vareliste/:id
 * faktisk matcher en definert rute i App.tsx.
 */
describe("useRecipeWarnings — lenker matcher registrerte ruter", () => {
  const rmId = "11111111-1111-1111-1111-111111111111";
  const hrefs = [
    `/ravarer/vareliste/${rmId}?tab=suppliers`,
    `/ravarer/vareliste/${rmId}?tab=nutrition`,
  ];

  const appTsx = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf-8");

  it("finner /ravarer/vareliste/:id som registrert rute i App.tsx", () => {
    expect(appTsx).toMatch(/path="\/ravarer\/vareliste\/:id"/);
  });

  it("hver lenke fra useRecipeWarnings matcher denne ruten", () => {
    const routePattern = /^\/ravarer\/vareliste\/[^/?]+(\?.*)?$/;
    for (const href of hrefs) {
      expect(href).toMatch(routePattern);
    }
  });

  it("useRecipeWarnings.ts bruker ikke lenger den utdaterte /ravarer/vare/-ruten", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../varer/hooks/useRecipeWarnings.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/\/ravarer\/vare\//);
    expect(src).not.toMatch(/tab=pakninger/);
  });
});
