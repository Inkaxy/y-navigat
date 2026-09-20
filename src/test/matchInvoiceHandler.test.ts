import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createFakeClient, type Row, type Tables } from "./edge/fakeSupabase";

/**
 * Kjører den FAKTISKE handleren i supabase/functions/match-invoice-lines mot en
 * mocket transport. Poenget er ikke hjelperens predikater, men hva som faktisk
 * skrives på linjen og fakturaen når kostprisen ikke lar seg regne ut.
 */

const SERVICE = "service-role-test-key";
const INVOICE = "inv-1";
const ENTITY = "ent-1";
const SUPPLIER = "sup-1";
const RM = "rm-1";

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const env = new Map<string, string>([
    ["SUPABASE_URL", "http://localhost"],
    ["SUPABASE_ANON_KEY", "anon"],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
  ]);
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => env.get(k) },
    serve: (fn: (req: Request) => Promise<Response>) => {
      handler = fn;
    },
  };
  // Indirekte spesifikator: edge-modulen er Deno-kode og skal ikke inn i
  // appens typekontroll, men den skal kjøres uendret her.
  const modulePath = ["..", "..", "supabase", "functions", "match-invoice-lines", "index.ts"].join("/");
  await import(/* @vite-ignore */ modulePath);
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).Deno;
  delete (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__;
});

interface Scenario {
  line: Row;
  rawMaterial?: Row | null;
}

function buildTables({ line, rawMaterial }: Scenario): Tables {
  const rm: Row[] = rawMaterial === null
    ? []
    : [
        {
          id: RM,
          legal_entity_id: ENTITY,
          is_active: true,
          name: "Sukker",
          sku: "SUK",
          category: "tørrvare",
          base_unit: "kg",
          current_cost_price: null,
          price_updated_at: null,
          primary_supplier_id: SUPPLIER,
          package_size: null,
          package_unit: null,
          base_units_per_package: null,
          package_confirmed_at: null,
          ...(rawMaterial ?? {}),
        },
      ];
  return {
    invoices: [
      {
        id: INVOICE,
        legal_entity_id: ENTITY,
        supplier_id: SUPPLIER,
        total_amount: 0,
        invoice_date: "2026-09-01",
        status: "processing",
        currency: "NOK",
        is_credit_note: false,
        extraction_confidence: 0.99,
        lines_sum_status: "ok",
        notes: null,
      },
    ],
    invoice_match_settings: [],
    invoice_match_category_tolerances: [],
    invoice_line_exclusion_patterns: [],
    raw_material_suppliers: [],
    raw_material_supplier_aliases: [],
    raw_materials: rm,
    invoice_lines: [
      {
        id: "line-1",
        invoice_id: INVOICE,
        raw_material_id: RM,
        match_confidence: "manual",
        description: "Sukker",
        supplier_sku: "SUK",
        unit: "kg",
        quantity: 2,
        unit_price: 100,
        total_amount: 200,
        requires_review: false,
        review_reason: null,
        price_variance_pct: 12.5,
        ...line,
      },
    ],
    invoice_line_match_suggestions: [],
  };
}

async function runMatcher(scenario: Scenario) {
  const tables = buildTables(scenario);
  const client = createFakeClient(tables);
  (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__ = () => client;
  const res = await handler(
    new Request("http://localhost/match-invoice-lines", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: INVOICE }),
    }),
  );
  const body = (await res.json()) as { ok?: boolean; results?: Array<Record<string, unknown>> };
  return {
    status: res.status,
    body,
    line: tables.invoice_lines[0],
    invoice: tables.invoices[0],
  };
}

const CASES: Array<{ name: string; scenario: Scenario; reason: string }> = [
  {
    name: "eksplisitt beløp 0",
    scenario: { line: { total_amount: 0 } },
    reason: "extraction_unresolved",
  },
  {
    name: "manglende beløp uten enhetspris",
    scenario: { line: { total_amount: null, unit_price: null } },
    reason: "extraction_unresolved",
  },
  {
    name: "mengde 0",
    scenario: { line: { quantity: 0 } },
    reason: "extraction_unresolved",
  },
  {
    name: "mengde mangler",
    scenario: { line: { quantity: null } },
    reason: "extraction_unresolved",
  },
  {
    name: "mengde er ikke et endelig tall",
    scenario: { line: { quantity: Number.NaN } },
    reason: "extraction_unresolved",
  },
  {
    // Et uendelig beløp er et ugyldig beløp, ikke et manglende beløp: det skal
    // ikke erstattes av mengde × enhetspris.
    name: "beløp er Infinity",
    scenario: { line: { total_amount: Number.POSITIVE_INFINITY, quantity: 2, unit_price: 100 } },
    reason: "extraction_unresolved",
  },
  {
    name: "beløp er -Infinity",
    scenario: { line: { total_amount: Number.NEGATIVE_INFINITY, quantity: 2, unit_price: 100 } },
    reason: "extraction_unresolved",
  },
  {
    name: "beløp er NaN",
    scenario: { line: { total_amount: Number.NaN, quantity: 2, unit_price: 100 } },
    reason: "extraction_unresolved",
  },
  {
    name: "beløp er teksten «NaN»",
    scenario: { line: { total_amount: "NaN", quantity: 2, unit_price: 100 } },
    reason: "extraction_unresolved",
  },
  {
    name: "varen mangler grunnenhet",
    scenario: { line: {}, rawMaterial: { base_unit: null } },
    reason: "missing_base_unit",
  },
];

describe("matchemotoren: ubrukelig kostpris blokkerer i den manuelle grenen", () => {
  for (const c of CASES) {
    it(`${c.name} gir «${c.reason}» og stopper fakturaen`, async () => {
      const { status, body, line, invoice } = await runMatcher(c.scenario);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(line.price_per_base_unit).toBeNull();
      expect(line.base_quantity).toBeNull();
      expect(line.requires_review).toBe(true);
      expect(String(line.review_reason).split(",")).toContain(c.reason);
      // Et gammelt avvik skal ikke bli stående når det ikke er regnet ut nå.
      expect(line.price_variance_pct).toBeNull();
      expect(invoice.status).toBe("needs_review");
    });
  }
});

describe("matchemotoren: ubrukelig kostpris blokkerer i den automatiske grenen", () => {
  for (const c of CASES) {
    it(`${c.name} gir «${c.reason}»`, async () => {
      const scenario: Scenario = {
        ...c.scenario,
        line: { ...c.scenario.line, match_confidence: null, raw_material_id: null },
      };
      const tables = buildTables(scenario);
      // Bekreftet alias slik at den automatiske grenen finner varen selv.
      tables.raw_material_suppliers.push({
        id: "rms-1",
        raw_material_id: RM,
        supplier_id: SUPPLIER,
        supplier_sku: "SUK",
        supplier_product_name: "Sukker",
        agreed_price_per_base_unit: null,
        agreement_valid_from: null,
        agreement_valid_to: null,
        last_invoice_date: null,
        package_size: null,
        package_unit: null,
        base_units_per_package: null,
        package_confirmed_at: null,
        is_primary: true,
      });
      tables.raw_material_supplier_aliases.push({
        id: "alias-1",
        raw_material_supplier_id: "rms-1",
        alias_type: "supplier_sku",
        alias_value: "SUK",
        alias_value_normalized: "suk",
        status: "confirmed",
        match_count: 3,
      });
      const client = createFakeClient(tables);
      (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__ = () => client;
      const res = await handler(
        new Request("http://localhost/match-invoice-lines", {
          method: "POST",
          headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: INVOICE }),
        }),
      );
      expect(res.status).toBe(200);
      const line = tables.invoice_lines[0];
      expect(line.price_per_base_unit).toBeNull();
      expect(line.base_quantity).toBeNull();
      expect(line.requires_review).toBe(true);
      expect(String(line.review_reason).split(",")).toContain(c.reason);
      expect(line.price_variance_pct).toBeNull();
      expect(tables.invoices[0].status).toBe("needs_review");
    });
  }
});

describe("matchemotoren: en fullt avklart linje går fortsatt gjennom", () => {
  it("kjent mengde, beløp og grunnenhet gir pris og ingen gjennomgang", async () => {
    const { line, invoice } = await runMatcher({ line: {} });
    expect(line.price_per_base_unit).toBeCloseTo(100, 6);
    expect(line.requires_review).toBe(false);
    expect(invoice.status).toBe("ready");
  });
});

/**
 * Automatisk kobling uten gyldig prisgrunnlag skal aldri ferdigmerke linjen.
 * Forrige kjøp er kun en sammenligning — det er ikke et godkjenningsgrunnlag.
 */
describe("matchemotoren: automatisk kobling krever gyldig prisgrunnlag", () => {
  async function runAuto(reference: Record<string, unknown>) {
    const tables = buildTables({ line: { match_confidence: null, raw_material_id: null } });
    tables.raw_material_suppliers.push({
      id: "rms-1",
      raw_material_id: RM,
      supplier_id: SUPPLIER,
      supplier_sku: "SUK",
      supplier_product_name: "Sukker",
      agreed_price_per_base_unit: null,
      agreement_valid_from: null,
      agreement_valid_to: null,
      last_invoice_date: null,
      package_size: 1,
      package_unit: "kg",
      base_units_per_package: 1,
      package_confirmed_at: "2026-08-01T00:00:00Z",
      is_primary: true,
    });
    tables.raw_material_supplier_aliases.push({
      id: "alias-1",
      raw_material_supplier_id: "rms-1",
      alias_type: "supplier_sku",
      alias_value: "SUK",
      alias_value_normalized: "suk",
      status: "confirmed",
      match_count: 5,
    });
    const client = createFakeClient(tables, { rpc: { rm_price_reference: reference } });
    (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__ = () => client;
    const res = await handler(
      new Request("http://localhost/match-invoice-lines", {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: INVOICE }),
      }),
    );
    expect(res.status).toBe(200);
    return { line: tables.invoice_lines[0], invoice: tables.invoices[0] };
  }

  it("forrige kjøp med lik pris blir stående til gjennomgang", async () => {
    const { line, invoice } = await runAuto({ source: "last_purchase", price: 100 });
    expect(line.requires_review).toBe(true);
    expect(String(line.review_reason).split(",")).toContain("no_automatic_basis");
    expect(invoice.status).toBe("needs_review");
  });

  it("gyldig avtalepris med lik pris ferdigmerker linjen", async () => {
    const { line } = await runAuto({ source: "agreement", price: 100 });
    expect(line.requires_review).toBe(false);
    expect(String(line.review_reason ?? "")).not.toContain("no_automatic_basis");
  });

  it("bekreftet startpris er et gyldig grunnlag (men følger innstillingen for manuell kontroll)", async () => {
    const { line } = await runAuto({ source: "start_price", price: 100 });
    expect(String(line.review_reason ?? "")).not.toContain("no_automatic_basis");
  });
});
