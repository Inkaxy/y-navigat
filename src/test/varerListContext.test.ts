// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  parseRecipeListParams, writeRecipeListParams, parseProductListParams, writeProductListParams, RECIPE_LIST_DEFAULTS,
} from "@/varer/lib/listUrlState";
import { detailHref, listReturnHref, readFocusId, sanitizeListSearch } from "@/varer/lib/listReturn";
import { groupRecipeWarnings, distinctActions, focusRecipeLine } from "@/varer/lib/recipeWarningGroups";
import { filterProducts } from "@/varer/lib/productListFilter";
import { filterAndSortRecipes } from "@/varer/lib/recipeListFilter";
import { goToSection } from "@/varer/components/recipes/editor/RecipeSections";
import type { RecipeWarning } from "@/varer/hooks/useRecipeWarnings";

describe("liste-state i URL", () => {
  it("validerer og avgrenser oppskriftsparametre", () => {
    const s = parseRecipeListParams(new URLSearchParams("status=hacked&merking=stale&sort=evil&retning=desc&side=-3&avdeling=bakeri&q=" + "x".repeat(500)));
    expect(s.status).toBe("all");
    expect(s.labeling).toBe("stale");
    expect(s.sort).toBe("name");
    expect(s.dir).toBe("desc");
    expect(s.page).toBe(1);
    expect(s.dept).toBe("bakeri");
    expect(s.q.length).toBe(200);
    expect(parseRecipeListParams(new URLSearchParams("side=99999999")).page).toBe(1);
    expect(parseRecipeListParams(new URLSearchParams("side=3")).page).toBe(3);
  });

  it("bevarer ukjente parametre og fjerner standardverdier", () => {
    const next = writeRecipeListParams(new URLSearchParams("annet=1&side=4"), { ...RECIPE_LIST_DEFAULTS, q: "bolle" });
    expect(next.get("annet")).toBe("1");
    expect(next.get("q")).toBe("bolle");
    expect(next.has("side")).toBe(false);
    expect(next.has("sort")).toBe(false);
  });

  it("vareliste: rundtur gir samme state", () => {
    const s = parseProductListParams(new URLSearchParams("q=1791-1800&status=paused&variant=variants&merking=missing&kategori=Brød"));
    expect(parseProductListParams(writeProductListParams(new URLSearchParams(), s))).toEqual(s);
    expect(parseProductListParams(new URLSearchParams("status=x&variant=y")).status).toBe("all");
  });
});

describe("returkontekst", () => {
  it("detaljlenken bærer listevalget og tilbake gir samme liste", () => {
    const href = detailHref("recipes", "abc", "?q=bolle&side=2");
    const fra = new URL(href, "https://x.invalid").searchParams.get("fra");
    expect(listReturnHref("recipes", fra)).toBe("/varer/oppskrifter?q=bolle&side=2");
  });

  it("uten kontekst gir standardlisten", () => {
    expect(detailHref("products", "p1", "")).toBe("/varer/vareliste/p1");
    expect(listReturnHref("products", null)).toBe("/varer/vareliste");
  });

  it("avviser eksterne og andre interne mål", () => {
    for (const bad of ["//evil.example", "/ordre", "https://evil.example", "/\\evil", "?a=1#x", "/varer/vareliste/../../ordre"]) {
      const out = listReturnHref("recipes", bad);
      expect(out.startsWith("/varer/oppskrifter")).toBe(true);
      expect(out).not.toContain("evil");
    }
    expect(sanitizeListSearch("?fra=%3Fq%3D1&q=2")).toBe("?q=2");
  });

  it("leser bare gyldig fokus-id fra state", () => {
    expect(readFocusId({ focusId: "r1" })).toBe("r1");
    expect(readFocusId({ focusId: 5 })).toBeNull();
    expect(readFocusId(null)).toBeNull();
  });
});

const w = (p: Partial<RecipeWarning>): RecipeWarning => ({
  kind: "missing_nutrition", lineId: "l1", rawMaterialId: "rm1", name: "Mel", message: "«Mel» mangler næringsdata", action: { label: "Legg inn næring", href: "/ravarer/vareliste/rm1?tab=nutrition" }, ...p,
});

describe("gruppering av advarsler", () => {
  it("grupperer per linje og holder like navn på ulike linjer adskilt", () => {
    const s = groupRecipeWarnings([
      w({}),
      w({ kind: "missing_allergens", message: "«Mel» mangler allergeninformasjon" }),
      w({ lineId: "l2" }),
      w({ lineId: null, name: null, kind: "low_margin", message: "Lav", action: null }),
    ]);
    expect(s.groups.map((g) => g.key)).toEqual(["l1", "l2", "oppskrift"]);
    expect(s.affectedLineCount).toBe(2);
    expect(s.problemCount).toBe(4);
    expect(s.groups[0].items).toHaveLength(2);
  });

  it("dedupliserer kun likt problem med samme mål på samme linje", () => {
    const s = groupRecipeWarnings([w({}), w({}), w({ action: { label: "Annet", href: "/ravarer/vareliste/rm9" } })]);
    expect(s.problemCount).toBe(2);
    expect(distinctActions(s.groups[0].items)).toHaveLength(2);
  });
});

describe("navigasjon i oppskriften", () => {
  it("fokuserer ingrediensfeltet på riktig linje, ellers raden", () => {
    document.body.innerHTML = `
      <div data-line-id="a" tabindex="-1"><div data-grid-cell="a:name"><input id="ia" /></div></div>
      <div data-line-id="b" tabindex="-1"><div data-grid-cell="b:name"><input id="ib" disabled /></div></div>`;
    Element.prototype.scrollIntoView = () => {};
    expect(focusRecipeLine("a")).toBe(true);
    expect(document.activeElement?.id).toBe("ia");
    focusRecipeLine("b");
    expect(document.activeElement?.getAttribute("data-line-id")).toBe("b");
    expect(focusRecipeLine("finnes-ikke")).toBe(false);
  });

  it("«Gå til» fokuserer seksjonsoverskriften", () => {
    document.body.innerHTML = `<section id="seksjon-prosess"><h2 data-section-heading tabindex="-1">Prosess</h2></section>`;
    Element.prototype.scrollIntoView = () => {};
    expect(goToSection("seksjon-prosess")).toBe(true);
    expect(document.activeElement?.textContent).toBe("Prosess");
  });
});

describe("filtrering bevart", () => {
  const products = [1, 2, 3, 10].map((n) => ({ id: `p${n}`, display_number: n, display_name: `Vare ${n}`, code: `K${n}`, product_category: "Brød", status: "active", variant_of_product_id: null }));
  it("varenummer-intervall og liste", () => {
    const base = parseProductListParams(new URLSearchParams());
    expect(filterProducts(products, { ...base, q: "2-3" }, () => "missing").map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(filterProducts(products, { ...base, q: "1, 10" }, () => "missing").map((p) => p.id)).toEqual(["p1", "p10"]);
  });
  it("oppskrifter sorteres synkende", () => {
    const rows = ["b", "a", "c"].map((name) => ({ name, category: null, status: "draft", department: null, updated_at: null, products: [], labeling: "missing" as const, totals: { hydrationPct: 0, totalDoughG: 0 } }));
    expect(filterAndSortRecipes(rows, { ...RECIPE_LIST_DEFAULTS, dir: "desc" }).map((r) => r.name)).toEqual(["c", "b", "a"]);
  });
});
