import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createFakeClient, type Row, type Tables } from "./edge/fakeSupabase";

/**
 * Kjører den FAKTISKE match-invoice-lines-handleren mot en in-memory-transport:
 * låste (førte) linjer, flere bekreftede pakningsvarianter og kjent identitet
 * uten prisgrunnlag. Ingen ekte database berøres.
 */
const SERVICE = "service-role-test-key";
const INV = "inv-v";
const ENT = "ent-v";
const SUP = "sup-v";
const RM = "rm-flote";
let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const env = new Map([["SUPABASE_URL", "http://localhost"], ["SUPABASE_ANON_KEY", "anon"], ["SUPABASE_SERVICE_ROLE_KEY", SERVICE]]);
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env.get(k) }, serve: (fn: (r: Request) => Promise<Response>) => { handler = fn; } };
  const modulePath = ["..", "..", "supabase", "functions", "match-invoice-lines", "index.ts"].join("/");
  await import(/* @vite-ignore */ modulePath);
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).Deno;
  delete (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__;
});

function tables(line: Row, opts: { variants?: Row[]; settings?: Row; posted?: boolean } = {}): Tables {
  return {
    invoices: [{ id: INV, legal_entity_id: ENT, supplier_id: SUP, total_amount: 0, invoice_date: "2026-10-01", status: "processing", currency: "NOK", is_credit_note: false, extraction_confidence: 0.99, lines_sum_status: "ok", notes: null }],
    invoice_match_settings: opts.settings ? [{ legal_entity_id: ENT, ...opts.settings }] : [],
    invoice_match_category_tolerances: [],
    invoice_line_exclusion_patterns: [],
    raw_materials: [{ id: RM, legal_entity_id: ENT, is_active: true, name: "Matfløte", sku: "MF", category: "meieri", base_unit: "l", current_cost_price: null, price_updated_at: null, primary_supplier_id: SUP, package_size: null, package_unit: null, base_units_per_package: null, package_confirmed_at: null }],
    // Koblingsraden bærer SISTE bekreftede pakning (8 l). Eldre 12 l finnes som variant.
    raw_material_suppliers: [{ id: "rms-v", raw_material_id: RM, supplier_id: SUP, supplier_sku: "60241", supplier_product_name: "Matfløte", agreed_price_per_base_unit: null, agreement_valid_from: null, agreement_valid_to: null, last_invoice_price: null, last_invoice_date: null, package_size: 8, package_unit: "l", base_units_per_package: 8, package_confirmed_at: "2026-09-20T00:00:00Z", is_primary: true }],
    raw_material_supplier_packages: opts.variants ?? [
      { raw_material_supplier_id: "rms-v", supplier_sku_norm: "60241", package_size: 12, package_unit: "l", base_units_per_package: 12, confirmed_at: "2026-08-01T00:00:00Z" },
      { raw_material_supplier_id: "rms-v", supplier_sku_norm: "60241", package_size: 8, package_unit: "l", base_units_per_package: 8, confirmed_at: "2026-09-20T00:00:00Z" },
    ],
    raw_material_supplier_aliases: [{ id: "al-v", raw_material_supplier_id: "rms-v", alias_type: "supplier_sku", alias_value: "60241", alias_value_normalized: "60241", status: "confirmed", match_count: 9 }],
    invoice_line_cost_postings: opts.posted ? [{ invoice_line_id: "line-v", invoice_id: INV, revoked_at: null }] : [],
    raw_material_price_history: [],
    invoice_lines: [{ id: "line-v", invoice_id: INV, raw_material_id: null, match_confidence: null, description: "Matfløte 1L", supplier_sku: "60241", unit: "kartong", quantity: 1, unit_price: 504, total_amount: 504, requires_review: true, review_reason: "no_automatic_basis", price_variance_pct: null, package_size: 12, package_unit: "l", count_per_package: null, ...line }],
    invoice_line_match_suggestions: [],
  };
}

async function run(t: Tables, reference: Record<string, unknown> = { source: "none" }) {
  const client = createFakeClient(t, { rpc: { rm_price_reference: reference } });
  (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__ = () => client;
  const res = await handler(new Request("http://localhost/match-invoice-lines", { method: "POST", headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ invoice_id: INV }) }));
  const body = (await res.json()) as { results?: Row[] };
  return { status: res.status, body, line: t.invoice_lines[0] };
}
const reasons = (l: Row) => String(l.review_reason ?? "").split(",").filter(Boolean);

describe("1: linje med aktiv ført kostpris er låst", () => {
  it("rematch endrer ikke linjen og skriver ingen prishistorikk", async () => {
    const t = tables({ raw_material_id: RM, match_confidence: "manual", price_per_base_unit: 42, base_quantity: 12, review_reason: null, requires_review: false }, { posted: true });
    const before = JSON.stringify(t.invoice_lines[0]);
    const r = await run(t, { source: "last_purchase", price: 30 });
    expect(r.status).toBe(200);
    expect(JSON.stringify(t.invoice_lines[0])).toBe(before);
    expect(t.raw_material_price_history).toHaveLength(0);
    expect(r.body.results?.[0]).toMatchObject({ skipped: true, reason: "cost_posted" });
  });
});

describe("2: flere bekreftede pakninger for samme varenummer", () => {
  it("12 l og 8 l gjenbrukes hver for seg, også etter veksling", async () => {
    for (const size of [12, 8, 12]) {
      const r = await run(tables({ package_size: size, total_amount: size * 42, unit_price: size * 42 }));
      expect(r.line.raw_material_id).toBe(RM);
      expect(Number(r.line.base_quantity)).toBe(size);
      expect(Number(r.line.price_per_base_unit)).toBeCloseTo(42, 6);
      expect(reasons(r.line)).not.toContain("unknown_package_size");
    }
  });
  it("ny 15 l-pakning arver ikke siste variant (8 l), men råvaren beholdes", async () => {
    const r = await run(tables({ package_size: 15, total_amount: 630, unit_price: 630 }));
    expect(r.line.raw_material_id).toBe(RM);
    expect(Number(r.line.base_quantity)).not.toBe(8);
  });
  it("motstridende varianter for samme pakning gir ingen stille gjenbruk", async () => {
    const r = await run(tables({ package_size: 12 }, { variants: [
      { raw_material_supplier_id: "rms-v", supplier_sku_norm: "60241", package_size: 12, package_unit: "l", base_units_per_package: 12, confirmed_at: "2026-08-01T00:00:00Z" },
      { raw_material_supplier_id: "rms-v", supplier_sku_norm: "60241", package_size: 12, package_unit: "l", base_units_per_package: 6, confirmed_at: "2026-09-01T00:00:00Z" },
    ] }));
    expect(r.line.raw_material_id).toBe(RM);
    expect([6, 8]).not.toContain(Number(r.line.base_quantity));
  });
});

describe("3: kjent vare/pakning og separat prisvurdering", () => {
  it("første kjøp uten noe prisgrunnlag: kjent identitet, ingen ny vare-/pakningsbekreftelse", async () => {
    const r = await run(tables({}));
    expect(r.line.raw_material_id).toBe(RM);
    expect(r.line.match_confidence).toBe("auto_high");
    expect(reasons(r.line)).not.toContain("no_automatic_basis");
    expect(reasons(r.line)).not.toContain("unknown_package_size");
  });
  it("forrige kjøp finnes og innstillingen er av: bare prisvalg, ikke vare/pakning", async () => {
    const r = await run(tables({}), { source: "last_purchase", price: 42 });
    expect(r.line.raw_material_id).toBe(RM);
    expect(reasons(r.line)).toContain("no_automatic_basis");
    expect(reasons(r.line)).not.toContain("unknown_package_size");
    expect(reasons(r.line)).not.toContain("package_conflict");
  });
  it("forrige kjøp og innstillingen er på: går automatisk", async () => {
    const r = await run(tables({}, { settings: { auto_check_against_last_purchase: true } }), { source: "last_purchase", price: 42 });
    expect(r.line.requires_review).toBe(false);
  });
});
