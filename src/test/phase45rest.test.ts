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

import { nextActionable } from "@/ravarer/pages/oversikt/NextInvoicesView";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";
describe("Neste fakturaer på Oversikt", () => {
  it("bare åpne, ikke internt godkjente, eldste først, maks 5", () => {
    const mk = (id: string, date: string, tab: string, approved: boolean) => ({ id, invoice_date: date, tab, internally_approved: approved }) as unknown as InboxInvoice;
    const all = [mk("a", "2026-05-01", "open", true), mk("b", "2026-06-01", "open", false), mk("c", "2026-04-01", "ready", false),
      mk("d", "2026-03-01", "open", false), ...Array.from({ length: 6 }, (_, i) => mk(`x${i}`, `2026-07-0${i + 1}`, "open", false))];
    const r = nextActionable(all).map((i) => i.id);
    expect(r).toEqual(["d", "b", "x0", "x1", "x2"]);
  });
});
