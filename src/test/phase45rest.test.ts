import { describe, expect, it } from "vitest";
import { nextFix } from "@/ravarer/lib/nextFix";
import type { CheckItem } from "@/ravarer/lib/rawMaterialSections";
import { readSupplierSection, supplierGroupOf, supplierGroupSections } from "@/ravarer/lib/supplierSections";

const it_ = (id: CheckItem["id"], status: CheckItem["status"], section: CheckItem["section"]): CheckItem => ({ id, label: id, status, detail: "d", section });

describe("Rett det som mangler", () => {
  it("pakning før pris, og peker til riktig seksjon", () => {
    const r = nextFix([it_("pakning", "missing", "grunndata"), it_("prisgrunnlag", "missing", "pris")], false);
    expect(r).toMatchObject({ kind: "fix", item: { section: "grunndata" }, label: "Bekreft pakningsinnholdet" });
  });
  it("ikke 'pris' for alt: deklarasjon peker til deklarasjon", () => {
    const r = nextFix([it_("pakning", "ok", "grunndata"), it_("prisgrunnlag", "ok", "pris"), it_("deklarasjonsnavn", "missing", "deklarasjon")], false);
    expect(r).toMatchObject({ kind: "fix", item: { section: "deklarasjon" } });
  });
  it("ukjent prisstatus er aldri grønn", () => {
    expect(nextFix([it_("prisgrunnlag", "partial", "pris")], true).kind).toBe("unknown");
    expect(nextFix([it_("pakning", "ok", "grunndata")], true).kind).toBe("unknown");
    expect(nextFix([it_("pakning", "ok", "grunndata")], false).kind).toBe("complete");
  });
});

describe("leverandørkortets innganger", () => {
  it("tre hovedinnganger + Mer, gamle seksjonslenker virker", () => {
    expect(supplierGroupOf(readSupplierSection(new URLSearchParams("seksjon=aliaser")))).toBe("mer");
    expect(supplierGroupOf(readSupplierSection(new URLSearchParams("seksjon=varer")))).toBe("varer");
    expect(supplierGroupSections("mer")).toEqual(["fakturaer", "aliaser", "forhandlinger", "notater"]);
  });
});
