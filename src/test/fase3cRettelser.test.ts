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
