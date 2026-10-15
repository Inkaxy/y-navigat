import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createFakeClient, type FakeClientOptions, type Tables } from "./edge/fakeSupabase";

/** Kjører den FAKTISKE match-invoice-lines-handleren: låst/ukjent faktura gir 0 skriving. */
const SERVICE = "service-role-test-key";
let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const env = new Map([["SUPABASE_URL", "http://localhost"], ["SUPABASE_ANON_KEY", "anon"], ["SUPABASE_SERVICE_ROLE_KEY", SERVICE]]);
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env.get(k) }, serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; } };
  const modulePath = ["..", "..", "supabase", "functions", "match-invoice-lines", "index.ts"].join("/");
  await import(/* @vite-ignore */ modulePath);
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).Deno;
  delete (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__;
});

const tables = (inv: Record<string, unknown>, approvals: Record<string, unknown>[] = []): Tables => ({
  invoices: [{ id: "inv-1", legal_entity_id: "ent-1", supplier_id: "sup-1", total_amount: 0, invoice_date: "2026-09-01", status: "imported", excluded_at: null, currency: "NOK", is_credit_note: false, extraction_confidence: 0.99, lines_sum_status: "ok", notes: null, ...inv }],
  invoice_internal_approvals: approvals,
  invoice_match_settings: [], invoice_match_category_tolerances: [], invoice_line_exclusion_patterns: [],
  raw_material_suppliers: [], raw_material_supplier_aliases: [],
  raw_materials: [{ id: "rm-1", legal_entity_id: "ent-1", is_active: true, name: "Sukker", sku: "SUK", category: "tørrvare", base_unit: "kg", current_cost_price: null, primary_supplier_id: "sup-1" }],
  invoice_lines: [{ id: "line-1", invoice_id: "inv-1", raw_material_id: null, match_confidence: null, description: "Sukker", supplier_sku: "SUK", unit: "kg", quantity: 2, unit_price: 100, total_amount: 200, requires_review: false, review_reason: null, price_variance_pct: null }],
  invoice_line_match_suggestions: [],
});

async function run(t: Tables, options?: FakeClientOptions) {
  (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__ = () => createFakeClient(t, options);
  const res = await handler(new Request("http://localhost/match-invoice-lines", {
    method: "POST", headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ invoice_id: "inv-1" }),
  }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("match-invoice-lines: livsløpsvakt før all skriving", () => {
  const locked: Array<[string, Record<string, unknown>, Record<string, unknown>[], string]> = [
    ["aktiv intern godkjenning", { status: "needs_review" }, [{ id: "a1", invoice_id: "inv-1", status: "approved", revoked_at: null }], "internally_approved"],
    ["avstemt", { status: "reconciled" }, [], "final_status"],
    ["flagget", { status: "flagged" }, [], "final_status"],
    ["utelatt", { status: "excluded", excluded_at: "2026-10-01" }, [], "excluded"],
    ["manglende status", { status: null }, [], "status_unknown"],
    ["ukjent status", { status: "processing" }, [], "status_unknown"],
  ];
  for (const [name, inv, appr, reason] of locked) {
    it(`${name}: endelig låst kvittering og 0 endringer`, async () => {
      const t = tables(inv, appr);
      const before = JSON.stringify(t);
      const r = await run(t);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ skipped: true, locked: true, reason, processed: 0 });
      expect(JSON.stringify(t)).toBe(before);
    });
  }
  it("tilbakekalt godkjenning låser ikke; åpen faktura kjører og skriver", async () => {
    const t = tables({ status: "needs_review" }, [{ id: "a1", invoice_id: "inv-1", status: "approved", revoked_at: "2026-10-02" }]);
    const before = JSON.stringify(t);
    const r = await run(t);
    expect(r.status).toBe(200);
    expect(r.body.locked).toBeUndefined();
    expect(JSON.stringify(t)).not.toBe(before);
  });
  it("lesefeil på godkjenning: 503 og 0 endringer", async () => {
    const t = tables({ status: "ready" });
    const before = JSON.stringify(t);
    const r = await run(t, { failTables: { invoice_internal_approvals: "boom" } });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("lifecycle_check_failed");
    expect(JSON.stringify(t)).toBe(before);
  });
});
