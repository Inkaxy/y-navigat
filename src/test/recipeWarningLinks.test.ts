import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { paths } from "@/ravarer/lib/paths";

/**
 * Sjekker at lenkene useRecipeWarnings genererer mot /ravarer/vareliste/:id
 * faktisk matcher en definert rute i App.tsx.
 */
describe("useRecipeWarnings — lenker matcher registrerte ruter", () => {
  const rmId = "11111111-1111-1111-1111-111111111111";
  const hrefs = [
    paths.raavare(rmId, { tab: "suppliers" }),
    paths.raavare(rmId, { tab: "nutrition" }),
  ];

  const routesTsx = fs.readFileSync(path.resolve(__dirname, "../ravarer/routes.tsx"), "utf-8");

  it("finner /ravarer/varer/:id som registrert rute", () => {
    expect(routesTsx).toMatch(/path="\/ravarer\/varer\/:id"/);
  });

  it("hver lenke fra useRecipeWarnings matcher denne ruten", () => {
    const routePattern = /^\/ravarer\/varer\/[^/?]+(\?.*)?$/;
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
