import { describe, expect, it } from "vitest";
import {
  composeRemaining,
  costItem,
  labelItems,
  marginItems,
  severityForWarning,
  totalsItem,
  warningItems,
} from "@/varer/lib/recipeRemaining";
import type { RecipeWarning } from "@/varer/hooks/useRecipeWarnings";
import type { MarginLevel, ProductMargins } from "@/varer/hooks/useProductCalc";

const level = (over: Partial<MarginLevel>): MarginLevel => ({
  price_list_id: "pl-utsalg",
  code: null,
  name: "Utsalg",
  price_level: "utsalg",
  is_provisional: false,
  price: 40,
  price_with_packaging: null,
  brutto_pct: 70,
  db2: 10,
  dg2_pct: 25,
  target_brutto_pct: 65,
  target_dg2_pct: 30,
  target_source: "kategori",
  avvik_pp: -5,
  needed_price: 44.5,
  needed_change_pct: 11,
  status: "gronn",
  ...over,
});

const margins = (over: Partial<ProductMargins>): ProductMargins => ({
  ok: true,
  has_cost: true,
  calc_type: "oppskrift",
  cost: { raw_cost: 8, labor_cost: 12, energy_cost: 2, cost_price: 22, notes: [] },
  levels: [],
  ...over,
});

describe("«Gjenstår» — oppskriftsvarsler", () => {
  it("varsler som påvirker deklarasjon og vekt sperrer, pakning og kost er anbefaling", () => {
    expect(severityForWarning("missing_nutrition")).toBe("must");
    expect(severityForWarning("missing_allergens")).toBe("must");
    expect(severityForWarning("zero_quantity")).toBe("must");
    expect(severityForWarning("missing_package")).toBe("should");
    expect(severityForWarning("missing_cost")).toBe("should");
    expect(severityForWarning("low_margin")).toBe("should");
  });

  it("alle varsler fra useRecipeWarnings blir punkter, med linje som mål", () => {
    const warnings: RecipeWarning[] = [
      { kind: "missing_nutrition", message: "«Blåbær» mangler næringsdata", lineId: "l1", rawMaterialId: "rm1", action: { label: "Åpne råvare", href: "/ravarer/varer/rm1" } },
      { kind: "missing_package", message: "«Mel» mangler pakning", lineId: "l2", rawMaterialId: "rm2", action: null },
    ] as RecipeWarning[];
    const items = warningItems(warnings);
    expect(items).toHaveLength(2);
    const nut = items.find((i) => i.title.includes("Blåbær"))!;
    expect(nut.severity).toBe("must");
    expect(nut.tab).toBe("oppskrift");
    expect(nut.target).toEqual({ kind: "line", lineId: "l1" });
    expect(nut.action?.href).toBe("/ravarer/varer/rm1");
  });

  it("lav dekningsgrad peker på primærvaren i fanen Varer og lønnsomhet", () => {
    const items = warningItems([{ kind: "low_margin", message: "Dekningsgraden er 20 %", lineId: null, rawMaterialId: null, action: null } as RecipeWarning], "p1");
    expect(items[0].tab).toBe("varer");
    expect(items[0].target).toEqual({ kind: "product", productId: "p1" });
  });
});

describe("«Gjenstår» — kost og deigvekt fra statslinjen", () => {
  it("ufullstendig kost tas med som anbefaling med linjene", () => {
    const item = costItem({ incomplete: true, missing: [{ name: "Smør", reason: "mangler pris" }] });
    expect(item?.severity).toBe("should");
    expect(item?.title).toBe("Kostnaden er ufullstendig — 1 linje mangler grunnlag");
    expect(item?.details).toEqual(["Smør: mangler pris"]);
    expect(costItem({ incomplete: false, missing: [] })).toBeNull();
  });

  it("ufullstendig deigvekt sperrer", () => {
    const item = totalsItem({ incomplete: true, warnings: ["«Egg» mangler vekt per stk"] });
    expect(item?.severity).toBe("must");
    expect(item?.details).toEqual(["«Egg» mangler vekt per stk"]);
    expect(totalsItem({ incomplete: false, warnings: [] })).toBeNull();
  });
});

describe("«Gjenstår» — merking", () => {
  it("røde punkter i etikettkontrollen sperrer, gule er anbefaling, grønne utelates", () => {
    const items = labelItems({
      checklist: [
        { key: "shelf_life", label: "Holdbarhet", level: "error", detail: "Holdbarhet mangler" },
        { key: "storage", label: "Oppbevaring", level: "warn", detail: "Oppbevaring mangler" },
        { key: "ingredients", label: "Ingrediensliste", level: "ok", detail: "OK" },
      ],
      blockReasons: [],
      declarationManual: false,
    });
    expect(items.map((i) => [i.id, i.severity])).toEqual([
      ["merking:shelf_life", "must"],
      ["merking:storage", "should"],
    ]);
    expect(items[0].target).toEqual({ kind: "label", key: "shelf_life" });
  });

  it("varenavn rettes i Oppskriftsinfo", () => {
    const [item] = labelItems({
      checklist: [{ key: "name", label: "Varenavn", level: "error", detail: "Navn mangler" }],
      blockReasons: [],
      declarationManual: false,
    });
    expect(item.tab).toBe("oppskrift");
    expect(item.target).toEqual({ kind: "anchor", id: "seksjon-info" });
  });

  it("block_reasons sperrer i beregnet modus, men ikke når kilden er manuell", () => {
    const auto = labelItems({ checklist: [], blockReasons: ["Råvaren «X» mangler allergenvurdering", "Råvaren «X» mangler allergenvurdering"], declarationManual: false });
    expect(auto).toHaveLength(1);
    expect(auto[0].severity).toBe("must");
    const manual = labelItems({ checklist: [], blockReasons: ["Råvaren «X» mangler allergenvurdering"], declarationManual: true });
    expect(manual[0].severity).toBe("should");
  });
});

describe("«Gjenstår» — lønnsomhet fra product_margins", () => {
  it("prisnivå med status rod og prisnivå uten pris tas med; gul og grønn ikke", () => {
    const items = marginItems([
      {
        productId: "p1",
        name: "Grovbrød",
        data: margins({
          levels: [
            level({ price_list_id: "a", status: "rod", needed_price: 44.5 }),
            level({ price_list_id: "b", price_level: "engros", name: "Engros", status: "ingen_pris", price: null }),
            level({ price_list_id: "c", price_level: "internpris", name: "Intern", status: "gul" }),
          ],
        }),
      },
    ]);
    expect(items.map((i) => i.id)).toEqual(["lonnsomhet:p1:a:rod", "lonnsomhet:p1:b:pris"]);
    expect(items[0].title).toBe("Grovbrød: svak margin på utsalg");
    expect(items[0].details).toEqual(["Pris som trengs: 44,50 kr"]);
    expect(items[0].target).toEqual({ kind: "product", productId: "p1" });
    expect(items.every((i) => i.tab === "varer" && i.severity === "should")).toBe(true);
  });

  it("vare uten kost viser årsakene fra cost.notes, ikke 0", () => {
    const [item] = marginItems([
      { productId: "p2", name: "Rundstykke", data: margins({ has_cost: false, cost: { notes: ["Smør mangler kostpris"] }, levels: [] }) },
    ]);
    expect(item.title).toBe("Rundstykke: mangler kalkyle");
    expect(item.details).toEqual(["Smør mangler kostpris"]);
  });

  it("halvfabrikat har ingen salgspris og meldes ikke for manglende pris", () => {
    const items = marginItems([
      { productId: "p3", name: "Deig", data: margins({ calc_type: "halvfabrikat", levels: [level({ status: "ingen_pris", price: null })] }) },
    ]);
    expect(items).toEqual([]);
  });
});

describe("«Gjenstår» — sammenstilling", () => {
  it("sperrende punkter kommer først og teller per fane", () => {
    const s = composeRemaining([
      [costItem({ incomplete: true, missing: [{ name: "Smør", reason: "mangler pris" }] })!],
      [totalsItem({ incomplete: true, warnings: [] })!],
      labelItems({ checklist: [{ key: "shelf_life", label: "Holdbarhet", level: "error", detail: "Mangler" }], blockReasons: [], declarationManual: false }),
    ]);
    expect(s.must.map((i) => i.id)).toEqual(["vekt:ufullstendig", "merking:shelf_life"]);
    expect(s.should.map((i) => i.id)).toEqual(["kost:ufullstendig"]);
    expect(s.byTab).toEqual({ oppskrift: { must: 1, should: 1 }, merking: { must: 1, should: 0 } });
  });

  it("lav dekningsgrad utelates når samme vare er meldt med svak margin", () => {
    const low = warningItems([{ kind: "low_margin", message: "Dekningsgraden er lav", lineId: null, rawMaterialId: null, action: null } as RecipeWarning], "p1");
    const rod = marginItems([{ productId: "p1", name: "Brød", data: margins({ levels: [level({ status: "rod" })] }) }]);
    const s = composeRemaining([low, rod]);
    expect(s.should.map((i) => i.id)).toEqual(["lonnsomhet:p1:pl-utsalg:rod"]);
  });

  it("tom liste gir ingen punkter", () => {
    const s = composeRemaining([[], []]);
    expect(s.must).toEqual([]);
    expect(s.should).toEqual([]);
  });
});
