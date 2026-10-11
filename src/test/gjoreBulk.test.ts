import { describe, expect, it, vi } from "vitest";
import { eligible, runBulk, totalLines } from "@/ravarer/pages/priskontroll/gjore/bulkGjore";
import { frozenChange } from "@/ravarer/pages/priskontroll/gjore/VarekortPanel";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import type { LinkSupplierItemResult, SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const w = (o: Partial<WorkItem>): WorkItem => ({ key: o.key ?? "k", grp: "kobling", type: "varekort", kind: "ukoblet", supplier_id: "s1", supplier_name: "A", item_key: "sku:1", invoice_id: null, invoice_number: null, title: "Mel", sku: null, rm_id: null, rm_name: null, open_lines: 3, open_invoices: 2, invoice_count: 2, amount: 0, impact_nok: 0, last_date: null, last_open_line_id: null, reasons: [], ...o });
const res = (id: string): LinkSupplierItemResult => ({ ok: true, mode: "koblet", raw_material_id: id, raw_material_supplier_id: null, created_raw_material: true, lines_updated: 2, invoices: [], still_open_lines: 0, failures: [] });

describe("masseutvalg i Å gjøre", () => {
  it("opprett gjelder bare ukoblede varekort, ikke fakturasaker", () => {
    const r = eligible([w({ key: "a" }), w({ key: "b", kind: "prisavvik" }), w({ key: "c", type: "faktura", item_key: null })], "opprett");
    expect(r.ok.map((i) => i.key)).toEqual(["a"]);
    expect(eligible([w({ key: "b", kind: "prisavvik" })], "ikke_vare").ok).toHaveLength(1);
    expect(totalLines([w({}), w({ open_lines: 9 })])).toBe(12);
  });
  it("kjører på tvers av leverandører, fortsetter ved feil og oppretter like navn én gang", async () => {
    const link = vi.fn()
      .mockResolvedValueOnce(res("rm1"))
      .mockRejectedValueOnce(new Error("varenummer_stemmer_ikke"))
      .mockResolvedValueOnce(res("rm1"));
    const items = [w({ key: "a", supplier_id: "s1" }), w({ key: "b", supplier_id: "s2", title: "Sukker" }), w({ key: "c", supplier_id: "s3", title: " mel " })];
    const out = await runBulk(items, { kind: "opprett", category: "Mel", baseUnit: "kg" }, "le", link);
    expect(out.map((r) => r.ok)).toEqual([true, false, true]);
    expect(link.mock.calls[2][0]).toMatchObject({ supplier_id: "s3", raw_material_id: "rm1" });
    expect(link.mock.calls[2][0].new_raw_material).toBeUndefined();
  });
});

describe("fryst varekort", () => {
  const l = (id: string, open = true) => ({ id, requires_review: open }) as SupplierItemLine;
  const it0 = { status: "ukoblet", rm_id: null } as SupplierItem;
  it("melder nye og løste linjer, ellers ingenting", () => {
    expect(frozenChange([l("1")], [l("1")], it0, it0)).toBeNull();
    expect(frozenChange([l("1")], [l("1"), l("2")], it0, it0)).toContain("1 ny åpen linje");
    expect(frozenChange([l("1")], [l("1", false)], it0, it0)).toContain("løst et annet sted");
  });
});

import { candidatesFrom } from "@/ravarer/pages/priskontroll/gjore/bulkPreview";
import { correctionDocLine } from "@/ravarer/pages/priskontroll/faktura/correctionDocLine";

describe("F18/F28: fryste ID-er og forslag", () => {
  it("sender nøyaktige fryste linje-ID-er og hopper over tomt utvalg uten kall", async () => {
    const link = vi.fn().mockResolvedValue({ ...res("rm1"), skipped_line_ids: ["l2"] });
    const pv = new Map([
      ["a", { lineIds: ["l1", "l2"], candidates: [], unambiguous: null, error: null }],
      ["b", { lineIds: [], candidates: [], unambiguous: null, error: null }],
    ]);
    const out = await runBulk([w({ key: "a" }), w({ key: "b" })], { kind: "ikke_vare", reason: "Frakt" }, "le", link, undefined, pv);
    expect(link).toHaveBeenCalledTimes(1);
    expect(link.mock.calls[0][0].line_ids).toEqual(["l1", "l2"]);
    expect(out[1]).toMatchObject({ ok: false, text: expect.stringContaining("ingen åpne linjer") });
  });
  it("godta: entydig forslag kobles, manglende forslag hoppes over", async () => {
    const link = vi.fn().mockResolvedValue(res("rmX"));
    const pv = new Map([["a", { lineIds: ["l1"], candidates: [], unambiguous: null, error: null }], ["b", { lineIds: ["l9"], candidates: [], unambiguous: null, error: null }]]);
    const out = await runBulk([w({ key: "a" }), w({ key: "b" })], { kind: "godta", choices: new Map([["a", "rmX"]]) }, "le", link, undefined, pv);
    expect(link.mock.calls[0][0]).toMatchObject({ raw_material_id: "rmX", line_ids: ["l1"] });
    expect(out[1].text).toContain("ingen entydig");
  });
  it("kandidater: entydig bare når samme førstevalg på alle linjer", () => {
    const row = (l: string, rm: string, rank: number) => ({ invoice_line_id: l, raw_material_id: rm, rank, match_reason: "SKU", name: rm });
    expect(candidatesFrom([row("l1", "A", 1), row("l1", "B", 2), row("l2", "A", 1)], ["l1", "l2"]).unambiguous?.id).toBe("A");
    expect(candidatesFrom([row("l1", "A", 1), row("l2", "B", 1)], ["l1", "l2"]).unambiguous).toBeNull();
    expect(candidatesFrom([row("lx", "A", 1)], ["l1"]).candidates).toHaveLength(0);
  });
  it("rettedialogens dokument viser linjen som rettes, ikke køens aktive", () => {
    const hassel = { id: "h", d: "HASSEL" }, mandler = { id: "m", d: "MANDLER" };
    expect(correctionDocLine("m", [hassel, mandler], hassel)).toBe(mandler);
    expect(correctionDocLine("ukjent", [hassel], hassel)).toBeNull();
    expect(correctionDocLine(null, [hassel], hassel)).toBe(hassel);
  });
});

describe("F28: forhåndsvalg krever forslag for alle valgte linjer", () => {
  const s = (line: string, rm: string) => ({ invoice_line_id: line, raw_material_id: rm, rank: 1, match_reason: null, name: rm });
  it("2 valgte, 1 forslag => ikke entydig, kandidat står for eksplisitt valg", async () => {
    const { candidatesFrom } = await import("@/ravarer/pages/priskontroll/gjore/bulkPreview");
    const r = candidatesFrom([s("l1", "mel")], ["l1", "l2"]);
    expect(r.unambiguous).toBeNull();
    expect(r.candidates.map((c) => c.id)).toEqual(["mel"]);
  });
  it("2 valgte med samme forslag => forhåndsvalgt", async () => {
    const { candidatesFrom } = await import("@/ravarer/pages/priskontroll/gjore/bulkPreview");
    expect(candidatesFrom([s("l1", "mel"), s("l2", "mel")], ["l1", "l2"]).unambiguous?.id).toBe("mel");
  });
  it("tomt utvalg => null", async () => {
    const { candidatesFrom } = await import("@/ravarer/pages/priskontroll/gjore/bulkPreview");
    expect(candidatesFrom([s("l1", "mel")], []).unambiguous).toBeNull();
  });
});

describe("F28: ulike forslag", () => {
  it("2 valgte med ulike forslag => ikke entydig, begge kandidater vises", async () => {
    const { candidatesFrom } = await import("@/ravarer/pages/priskontroll/gjore/bulkPreview");
    const s = (line: string, rm: string) => ({ invoice_line_id: line, raw_material_id: rm, rank: 1, match_reason: null, name: rm });
    const r = candidatesFrom([s("l1", "mel"), s("l2", "smor")], ["l1", "l2"]);
    expect(r.unambiguous).toBeNull();
    expect(r.candidates.map((c) => c.id).sort()).toEqual(["mel", "smor"]);
  });
});
