import { WORK_ITEM_EFFECT_DEFAULTS } from "@/ravarer/lib/workRpcTypes";
import { describe, expect, it, vi } from "vitest";
import { frozenChange } from "@/ravarer/pages/priskontroll/gjore/VarekortPanel";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import type { LinkSupplierItemResult, SupplierItem, SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const w = (o: Partial<WorkItem>): WorkItem => ({ key: o.key ?? "k", grp: "kobling", type: "varekort", kind: "ukoblet", supplier_id: "s1", supplier_name: "A", item_key: "sku:1", invoice_id: null, invoice_number: null, title: "Mel", sku: null, rm_id: null, rm_name: null, open_lines: 3, open_invoices: 2, invoice_count: 2, amount: 0, impact_nok: 0, last_date: null, last_open_line_id: null, reasons: [], ...WORK_ITEM_EFFECT_DEFAULTS, read_integrity_flags: [], ...o });
const res = (id: string): LinkSupplierItemResult => ({ ok: true, mode: "koblet", raw_material_id: id, raw_material_supplier_id: null, created_raw_material: true, lines_updated: 2, invoices: [], still_open_lines: 0, failures: [] });


describe("fryst varekort", () => {
  const l = (id: string, open = true) => ({ id, requires_review: open }) as SupplierItemLine;
  const it0 = { status: "ukoblet", rm_id: null } as SupplierItem;
  it("melder nye og løste linjer, ellers ingenting", () => {
    expect(frozenChange([l("1")], [l("1")], it0, it0)).toBeNull();
    expect(frozenChange([l("1")], [l("1"), l("2")], it0, it0)).toContain("1 ny åpen linje");
    expect(frozenChange([l("1")], [l("1", false)], it0, it0)).toContain("løst et annet sted");
  });
});

import { correctionDocLine } from "@/ravarer/pages/priskontroll/faktura/correctionDocLine";

describe("F18/F28: fryste ID-er og forslag", () => {
  it("rettedialogens dokument viser linjen som rettes, ikke køens aktive", () => {
    const hassel = { id: "h", d: "HASSEL" }, mandler = { id: "m", d: "MANDLER" };
    expect(correctionDocLine("m", [hassel, mandler], hassel)).toBe(mandler);
    expect(correctionDocLine("ukjent", [hassel], hassel)).toBeNull();
    expect(correctionDocLine(null, [hassel], hassel)).toBe(hassel);
  });
});


