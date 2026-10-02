import { describe, it, expect } from "vitest";
import { buildQualityTasks, type QualityInput } from "@/varer/lib/labelQualityTasks";
import { diffSegments } from "@/varer/lib/declarationDiff";

describe("fritekst-dedup via oppskriftslinje", () => {
  const md = {
    free_text_lines: [
      { name: "Alaska Ekspress bringebær, kartong 10 kg", grams: 5000 },
      { name: "Jilk Spesial, spann 10 kg", grams: 100 },
    ],
    nutrition: [
      { name: "alaska ekspress bringebær", grams: 5000, raw_material_id: null, critical: false },
      { name: "jilk spesial", grams: 100, raw_material_id: null, critical: false },
    ],
  } as unknown as QualityInput;
  const lines = [
    { id: "l1", name: "Alaska Ekspress bringebær, kartong 10 kg" },
    { id: "l2", name: "Jilk Spesial, spann 10 kg" },
  ];
  it("slår sammen samme linje", () => {
    expect(buildQualityTasks(md, lines).tasks).toHaveLength(2);
  });
  it("kobler ikke uten linje-id", () => {
    expect(buildQualityTasks(md, []).tasks.length).toBeGreaterThan(2);
  });
  it("kobler ikke ved tvetydig navn", () => {
    const amb = [...lines, { id: "l3", name: "Jilk Spesial, pose 1 kg" }];
    expect(buildQualityTasks(md, amb).tasks).toHaveLength(3);
  });
});

describe("diffSegments", () => {
  it("lager fra/til uten sammenlimte ord og ignorerer stjerner", () => {
    const s = diffSegments("*hvete*, alaska ekspress, salt", "hvete, vegetabilsk olje, salt");
    const ch = s.filter((x) => x.op === "change");
    expect(ch).toEqual([{ op: "change", removed: "alaska ekspress,", added: "vegetabilsk olje," }]);
  });
});
