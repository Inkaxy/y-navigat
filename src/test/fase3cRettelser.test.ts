import { describe, expect, it } from "vitest";
import { parseUserNames, FORMER_USER } from "@/ravarer/hooks/useUserNames";
import { parseAuditRows, auditDetail, AUDIT_ENTITY_TYPE } from "@/fakturaer/components/decisions/AuditHistory";
import { auditActionLabel } from "@/ravarer/lib/labels";
import { notItemResultItems } from "@/ravarer/pages/priskontroll/faktura/notItemResult";

describe("rm_user_names", () => {
  it("navn, og «Tidligere bruker» når navn mangler", () => {
    const m = parseUserNames([{ id: "a", name: "Kari", active: true }, { id: "b", name: null, active: false }, { id: null, name: "x", active: true }]);
    expect(m.get("a")).toBe("Kari");
    expect(m.get("b")).toBe(FORMER_USER);
    expect(m.size).toBe(2);
  });
});

describe("rm_audit_history", () => {
  it("typer og etiketter", () => {
    expect(AUDIT_ENTITY_TYPE.supplier_link).toBe("raw_material_supplier");
    expect(auditActionLabel("invoice.auto_reconciled")).toBe("Avstemt automatisk");
    expect(auditActionLabel("ukjent.x")).toBe("Endring");
    const [r] = parseAuditRows([{ id: "1", occurred_at: "2026-10-01T10:00:00Z", action: "supplier_case.status", actor: "Kari", is_system: null, reason: null, changes: { from: "open", to: "resolved" } }]);
    expect(auditDetail(r)).toBe("Åpen → Løst");
    expect(parseAuditRows([{ id: "2", occurred_at: "x", action: "a", actor: null, is_system: true, reason: null, changes: [1] }])[0].changes).toEqual({});
  });
});

describe("Ikke vare — regelen beholdes ved angring", () => {
  it("sier fra når regel ble lagret", () => {
    expect(notItemResultItems("Frakt", "p1")).toHaveLength(2);
    expect(notItemResultItems("Frakt", null)).toEqual(["Frakt"]);
  });
});

import { firstCostLinesByInvoice, firstCostReport } from "@/ravarer/pages/priskontroll/gjore/firstCost";
import type { FirstCostLine } from "@/ravarer/pages/priskontroll/gjore/firstCost";

describe("F13 første kostpris på tvers av fakturaer", () => {
  const l = (p: Partial<FirstCostLine>): FirstCostLine => ({ id: "l", invoice_id: "i1", invoice_status: "ready", is_credit_note: false, cost_posted: false, raw_material_id: "rm", price_per_base_unit: 10, base_quantity: 2, flagged_at: null, ...p });
  it("grupperer trygge linjer per faktura", () => {
    const m = firstCostLinesByInvoice({ rm_id: "rm", rm_cost: null }, [
      l({ id: "a" }), l({ id: "b", invoice_id: "i2" }), l({ id: "c", invoice_id: "i3", invoice_status: "reconciled" }),
      l({ id: "d", invoice_id: "i4", is_credit_note: true }), l({ id: "e", base_quantity: null }),
    ]);
    expect([...m.keys()].sort()).toEqual(["i1", "i2"]);
  });
  it("tomt når varen har kostpris", () => expect(firstCostLinesByInvoice({ rm_id: "rm", rm_cost: 5 }, [l({})]).size).toBe(0));
  it("rapport", () => expect(firstCostReport([{ posted: 2, error: null }, { posted: 0, error: "x" }]).title).toContain("feilet"));
});
