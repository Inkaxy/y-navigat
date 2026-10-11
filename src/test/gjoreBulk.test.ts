import { describe, expect, it, vi } from "vitest";
import { eligible, runBulk, totalLines } from "@/ravarer/pages/priskontroll/gjore/bulkGjore";
import { frozenChange } from "@/ravarer/pages/priskontroll/gjore/VarekortPanel";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import type { LinkSupplierItemResult, SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const w = (o: Partial<WorkItem>): WorkItem => ({ key: o.key ?? "k", grp: "kobling", type: "varekort", kind: "ukoblet", supplier_id: "s1", supplier_name: "A", item_key: "sku:1", invoice_id: null, invoice_number: null, title: "Mel", sku: null, rm_id: null, rm_name: null, open_lines: 3, open_invoices: 2, invoice_count: 2, amount: 0, impact_nok: 0, last_date: null, last_open_line_id: null, reasons: [], ...o });
const res = (id: string): LinkSupplierItemResult => ({ ok: true, mode: "koblet", raw_material_id: id, raw_material_supplier_id: null, created_raw_material: true, lines_updated: 2, invoices: [], still_open_lines: 0, failures: [] } as unknown as LinkSupplierItemResult);

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
