import { describe, expect, it } from "vitest";
import { buildQualityTasks, dedupeMessages } from "@/varer/lib/labelQualityTasks";
import { fixTargetForChecklistKey, latestApprovalByRecipe } from "@/varer/lib/labelWorkspace";

describe("buildQualityTasks", () => {
  it("slår sammen samme råvare fra flere lister til én oppgave", () => {
    const { tasks } = buildQualityTasks({
      nutrition: [{ raw_material_id: "rm1", name: "Salt", grams: 20, pct_of_dough: 1.5 }],
      critical_missing_nutrition: ["Salt"],
      lines_without_nutrition_over_pct: [{ name: "Salt", pct_of_weight: 1.5 }],
      allergens_unreviewed: [{ raw_material_id: "rm1", name: "Salt" }],
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].issues.map((i) => i.kind)).toEqual(["critical_nutrition", "allergens"]);
    expect(tasks[0].blocking).toBe(true);
  });

  it("flytter navnebasert oppgave til råvare-id når id dukker opp senere", () => {
    const { tasks } = buildQualityTasks({
      water_content: ["Hvetemel"],
      allergens_unreviewed: [{ raw_material_id: "rm2", name: "Hvetemel" }],
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].rawMaterialId).toBe("rm2");
  });

  it("fritekstlinje vises én gang, og telleren legger ikke til duplikat", () => {
    const { tasks, recipeTasks } = buildQualityTasks({
      nutrition: [{ raw_material_id: null, name: "Pynt", grams: 5, pct_of_dough: 0.3 }],
      free_text_lines: [{ name: "Pynt" }],
      lines_without_raw_material: 1,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].issues.map((i) => i.kind)).toEqual(["free_text"]);
    expect(recipeTasks).toHaveLength(0);
  });

  it("tom eller manglende input gir ingen oppgaver", () => {
    expect(buildQualityTasks(null).tasks).toEqual([]);
  });
});

describe("dedupeMessages", () => {
  it("fjerner like meldinger på tvers av sperrer og advarsler", () => {
    expect(dedupeMessages(["Salt mangler næring."], ["salt mangler næring", "Annet"])).toEqual([
      "Salt mangler næring.",
      "Annet",
    ]);
  });
});

describe("fixTargetForChecklistKey", () => {
  it("peker til riktige felt", () => {
    expect(fixTargetForChecklistKey("net_weight", false)?.anchor).toBe("etikett-nettovekt");
    expect(fixTargetForChecklistKey("ingredients", true)?.section).toBe("deklarasjon");
    expect(fixTargetForChecklistKey("ingredients", false)?.section).toBe("datakvalitet");
    expect(fixTargetForChecklistKey("producer", true)).toBeNull();
  });
});

describe("latestApprovalByRecipe", () => {
  it("bruker nyeste versjon per oppskrift", () => {
    const m = latestApprovalByRecipe([
      { recipe_id: "a", approved_at: "2026-01-01T10:00:00Z" },
      { recipe_id: "a", approved_at: "2026-03-01T10:00:00Z" },
      { recipe_id: "b", approved_at: null },
    ]);
    expect(m.get("a")).toBe("2026-03-01T10:00:00Z");
    expect(m.has("b")).toBe(false);
  });
});
