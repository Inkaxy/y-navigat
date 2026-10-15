import { describe, expect, it } from "vitest";
import { STATUS_GRID } from "@/ravarer/pages/oversikt/WorkStartView";

describe("Oversikt-statusrutenett: balanserte rader", () => {
  it("6 statusfelt gir 6/3/2 kolonner, aldri 5", () => {
    expect(STATUS_GRID[6]).toBe("sm:grid-cols-3 lg:grid-cols-6");
    expect(Object.values(STATUS_GRID).join(" ")).not.toMatch(/lg:grid-cols-5/);
  });
  it("hvert antall 1–6 deler seg jevnt i desktopkolonnene", () => {
    for (let n = 1; n <= 6; n++) {
      const cols = Number((STATUS_GRID[n].match(/(\d+)(?!.*\d)/) ?? [])[1]);
      expect(n % cols).toBe(0);
    }
  });
});
