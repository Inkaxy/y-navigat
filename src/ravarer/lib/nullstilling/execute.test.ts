// «Nullstill køen» – utføreren bruker de samme skriveveiene som knappene, og regel 6 bruker bare «hold utenfor».
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { executeStep, stepReason, type ExecDeps } from "./execute";
import type { ClaimedItem } from "./parse";
import { classifyUndo } from "./undo";

const RUN = "11111111-2222-3333-4444-555555555555";
const item = (o: Partial<ClaimedItem>): ClaimedItem => ({
  id: "it-1", seq: 1, phase: 1, rule: 1, action: "ikke_vare", supplier_id: "sup", item_key: "sku:p1", raw_material_id: null, line_ids: ["l1"],
  payload: { title: "Pant", supplier_name: "ASKO" }, reason_code: null, op_id: "op-1", claim_token: "tok", attempts: 1, ...o,
});
const linkOk = (o: Record<string, unknown> = {}) => ({ kind: "ok" as const, r: { ok: true, mode: "koblet" as const, raw_material_id: "rm1", raw_material_supplier_id: "rms1", created_raw_material: false, lines_updated: 1, invoices: [], still_open_lines: 0, failures: [], ...o } });
function deps(o: Partial<ExecDeps> = {}): ExecDeps {
  return {
    link: vi.fn(async () => linkOk()), rememberNames: vi.fn(async () => true),
    acceptPrice: vi.fn(async () => ({ kind: "ok" as const, accepted: 1, skipped: [] })),
    exclude: vi.fn(async () => ({ kind: "ok" as const, already: false, updatedAt: null, lines: null })),
    lineVersion: vi.fn(async () => ({ open: true, updatedAt: "v2", invoiceId: "inv" })), ...o,
  };
}
const ctx = { le: "le", runId: RUN };

describe("utfører", () => {
  it("regel 1: «Ikke vare» via link-supplier-item med fryst linjeutvalg og begrunnelse med kjøring og steg", async () => {
    const d = deps();
    const o = await executeStep(item({}), ctx, d);
    expect(o.status).toBe("ferdig");
    const body = vi.mocked(d.link).mock.calls[0][0];
    expect(body).toMatchObject({ not_raw_material: true, line_ids: ["l1"], supplier_id: "sup", item_key: "sku:p1" });
    expect(body.reason).toBe(stepReason(1, RUN, "it-1"));
    expect(body.reason).toContain("Nullstilling 18.11.2026 – regel 1");
    expect(body.reason).toContain("kjøring 11111111");
    expect(d.rememberNames).not.toHaveBeenCalled();
  });
  it("regel 4 opprett: ny vare + pakning, skrivemåter huskes som ved knappen", async () => {
    const d = deps({ link: vi.fn(async () => linkOk({ created_raw_material: true })) });
    const pkg = { package_size: 10, package_unit: "kg", base_units_per_package: 10, confirm: true as const };
    const o = await executeStep(item({ rule: 4, action: "opprett", payload: { title: "Rugmel", supplier_name: null, package: pkg, new_raw_material: { name: "Rugmel", base_unit: "kg", item_type: "ravare", category: "Ny fra faktura" } } }), ctx, d);
    expect(o).toMatchObject({ status: "ferdig", result: { created: true, raw_material_id: "rm1", names_remembered: true } });
    expect(vi.mocked(d.link).mock.calls[0][0]).toMatchObject({ new_raw_material: { name: "Rugmel", category: "Ny fra faktura" }, package: pkg });
    expect(d.rememberNames).toHaveBeenCalledWith({ le: "le", supplierId: "sup", itemKey: "sku:p1", rmsId: "rms1" });
  });
  it("0 endrede linjer er aldri «ferdig»; 4xx = feilet; nettverk/5xx = uavklart", async () => {
    expect((await executeStep(item({}), ctx, deps({ link: vi.fn(async () => linkOk({ lines_updated: 0 })) }))).status).toBe("feilet");
    expect((await executeStep(item({}), ctx, deps({ link: vi.fn(async () => ({ kind: "rejected" as const, message: "Avvist" })) }))).status).toBe("feilet");
    expect((await executeStep(item({}), ctx, deps({ link: vi.fn(async () => ({ kind: "unknown" as const, message: "?" })) }))).status).toBe("uavklart");
    expect((await executeStep(item({}), ctx, deps({ link: vi.fn(async () => { throw new Error("brudd"); }) }))).status).toBe("uavklart");
  });
  it("regel 2: «Prisen stemmer» med prisen fra planen; 0 godtatt = feilet med årsak", async () => {
    const d = deps();
    const it2 = item({ rule: 2, action: "godta_pris", payload: { title: "", supplier_name: null, lines: [{ id: "l1", price_per_base_unit: 11 }] } });
    expect((await executeStep(it2, ctx, d)).status).toBe("ferdig");
    expect(vi.mocked(d.acceptPrice).mock.calls[0][0]).toMatchObject({ lines: [{ id: "l1", price_per_base_unit: 11 }], reason: stepReason(2, RUN, "it-1") });
    const none = await executeStep(it2, ctx, deps({ acceptPrice: vi.fn(async () => ({ kind: "ok" as const, accepted: 0, skipped: [{ id: "l1", message: "Linjen har andre åpne årsaker enn pris" }] })) }));
    expect(none.status).toBe("feilet");
    expect(none.error).toContain("andre åpne årsaker");
  });
  it("regel 6: bare «hold utenfor» med stegets op-id – ingen kobling, ingen prisgodkjenning", async () => {
    const d = deps();
    const it6 = item({ rule: 6, action: "hold_utenfor", phase: 2, payload: { title: "", supplier_name: null, invoice_id: "inv", line_updated_at: "v1", reason_text: "Avsluttet ved nullstilling 18.11.2026 – regel 6: Prishopp over 20 %" } });
    expect((await executeStep(it6, ctx, d)).status).toBe("ferdig");
    expect(d.exclude).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.exclude).mock.calls[0][0]).toMatchObject({ invoiceId: "inv", lineId: "l1", expectedUpdatedAt: "v1", opId: "op-1" });
    expect(vi.mocked(d.exclude).mock.calls[0][0].reason.startsWith("Avsluttet ved nullstilling 18.11.2026")).toBe(true);
    expect(d.link).not.toHaveBeenCalled();
    expect(d.acceptPrice).not.toHaveBeenCalled();
  });
  it("regel 6: linjen regnet om etter planen → fersk versjon; allerede løst → ingenting å gjøre", async () => {
    const changed = { kind: "rejected" as const, error: "versjon_endret", blocked: [] };
    const d = deps({ exclude: vi.fn().mockResolvedValueOnce(changed).mockResolvedValueOnce({ kind: "ok", already: false, updatedAt: null, lines: null }) });
    const it6 = item({ rule: 6, action: "hold_utenfor", payload: { title: "", supplier_name: null, invoice_id: "inv", line_updated_at: "v1" } });
    expect((await executeStep(it6, ctx, d)).status).toBe("ferdig");
    expect(vi.mocked(d.exclude).mock.calls[1][0].expectedUpdatedAt).toBe("v2");
    const solved = await executeStep(it6, ctx, deps({ exclude: vi.fn(async () => changed), lineVersion: vi.fn(async () => ({ open: false, updatedAt: "v3", invoiceId: "inv" })) }));
    expect(solved).toMatchObject({ status: "ferdig", result: { already_resolved: true } });
    expect((await executeStep(it6, ctx, deps({ exclude: vi.fn(async () => ({ kind: "unknown" as const })) }))).status).toBe("uavklart");
    expect((await executeStep(it6, ctx, deps({ exclude: vi.fn(async () => ({ kind: "rejected" as const, error: "reversering_kreves", blocked: [{ lineId: "l1", lineNumber: 3, blocker: "prisobservasjon" }] })) }))).status).toBe("feilet");
  });
  it("lagrer aldri læringseksempler for fakturaleseren", () => {
    for (const f of ["execute.ts", "api.ts", "plan.ts"]) expect(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")).not.toMatch(/rm_record_extraction_example\s*"/);
  });
});

describe("angre", () => {
  it("tolker svaret fra de eksisterende angre-funksjonene", () => {
    expect(classifyUndo({ ok: true, undone: [{}, {}], skipped: [] }, 2).status).toBe("angret");
    expect(classifyUndo({ ok: true, undone: [{}], skipped: [{}] }, 2).status).toBe("delvis");
    expect(classifyUndo({ ok: true, undone: [], skipped: [{}] }, 1).status).toBe("kan_ikke");
    expect(classifyUndo(null, 1).status).toBe("ukjent");
  });
});
