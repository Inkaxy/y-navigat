import { describe, it, expect } from "vitest";
import { nutritionValueDiff } from "@/ravarer/lib/nutritionLabels";

describe("nutritionValueDiff", () => {
  it("viser ny verdi som «ny» når det ikke fantes noe fra før", () => {
    const diff = nutritionValueDiff("fat_g", null, 0.8);
    expect(diff.label).toBe("Fett");
    expect(diff.before).toBe("—");
    expect(diff.after).toBe("0,8");
    expect(diff.change).toBe("ny");
  });

  it("regner ut endring i prosent når det finnes en verdi fra før", () => {
    const diff = nutritionValueDiff("protein_g", 2, 3);
    expect(diff.label).toBe("Protein");
    expect(diff.before).toBe("2");
    expect(diff.after).toBe("3");
    expect(diff.change).toBe("+50 %");
  });

  it("faller tilbake til feltnavnet når det ikke finnes en etikett", () => {
    const diff = nutritionValueDiff("ukjent_felt", null, 1);
    expect(diff.label).toBe("ukjent_felt");
  });
});
