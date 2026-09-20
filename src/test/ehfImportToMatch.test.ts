import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parse as parseXmlStub } from "./edge/denoXmlStub";

// XML-parseren hentes fra en Deno-URL i produksjon; i test bruker vi stubben.
vi.mock("../../supabase/functions/import-ehf-invoice/xml.ts", () => ({ parse: parseXmlStub }));
import { createFakeClient, type Row, type Tables } from "./edge/fakeSupabase";

/**
 * Integrasjon fra EHF-import til matchemotor, med de FAKTISKE handlerne.
 *
 * Kjernen: en linje med rabatt og uten LineExtensionAmount har ikke noe
 * beløp i dokumentet. Importen merker den «extraction_unresolved», og en
 * senere matching skal verken fjerne merkingen eller dikte opp beløpet fra
 * enhetsprisen (som ville gitt prisen FØR rabatt).
 */

const SERVICE = "service-role-test-key";
const ENTITY = "ent-1";
const SUPPLIER = "sup-1";
const RM = "rm-1";

let importHandler: (req: Request) => Promise<Response>;
let matchHandler: (req: Request) => Promise<Response>;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <cbc:ID>F-2026-1</cbc:ID>
  <cbc:IssueDate>2026-09-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>NOK</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID>0192:111222333</cbc:EndpointID>
      <cac:PartyName><cbc:Name>Møllerens</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID>0192:999888777</cbc:EndpointID>
      <cac:PartyName><cbc:Name>Nøtterø Bakeri</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount>180</cbc:LineExtensionAmount>
    <cbc:PayableAmount>225</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="KGM">2</cbc:InvoicedQuantity>
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:Amount>20</cbc:Amount>
    </cac:AllowanceCharge>
    <cac:Item>
      <cbc:Name>Sukker</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>SUK</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount>100</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cac:Item>
      <cbc:Name>Salt</cbc:Name>
    </cac:Item>
    <cac:Price><cbc:PriceAmount>50</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>3</cbc:ID>
    <cbc:InvoicedQuantity unitCode="KGM">4</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount>400</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Gjær</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount>100</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="H87">10</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

function baseTables(): Tables {
  return {
    legal_entities: [{ id: ENTITY, legal_name: "Nøtterø Bakeri", org_number: "999888777" }],
    suppliers: [{ id: SUPPLIER, legal_entity_id: ENTITY, name: "Møllerens", org_number: "111222333" }],
    invoices: [],
    invoice_lines: [],
    invoice_match_settings: [],
    invoice_match_category_tolerances: [],
    invoice_line_exclusion_patterns: [],
    invoice_line_match_suggestions: [],
    raw_material_supplier_aliases: [],
    raw_material_suppliers: [
      {
        id: "rms-1",
        raw_material_id: RM,
        supplier_id: SUPPLIER,
        supplier_sku: "SUK",
        supplier_product_name: "Sukker",
        agreed_price_per_base_unit: null,
        agreement_valid_from: null,
        agreement_valid_to: null,
        package_size: null,
        package_unit: null,
        base_units_per_package: null,
        package_confirmed_at: null,
      },
    ],
    raw_materials: [
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
      },
    ],
  };
}

beforeAll(async () => {
  const env = new Map<string, string>([
    ["SUPABASE_URL", "http://localhost"],
    ["SUPABASE_ANON_KEY", "anon"],
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
  ]);
  let captured: ((req: Request) => Promise<Response>) | null = null;
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => env.get(k) },
    serve: (fn: (req: Request) => Promise<Response>) => {
      captured = fn;
    },
  };
  const load = async (name: string) => {
    captured = null;
    await import(/* @vite-ignore */ ["..", "..", "supabase", "functions", name, "index.ts"].join("/"));
    if (!captured) throw new Error(`Handler for ${name} ble ikke registrert`);
    return captured;
  };
  importHandler = await load("import-ehf-invoice");
  matchHandler = await load("match-invoice-lines");
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).Deno;
  delete (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__;
});

async function runImportThenMatch(): Promise<{ tables: Tables; invoice: Row }> {
  const tables = baseTables();
  const client = createFakeClient(tables, { rpc: { has_ravarer_invoice_access: true } });
  (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__ = () => client;

  const importRes = await importHandler(
    new Request("http://localhost/import-ehf-invoice", {
      method: "POST",
      headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
      body: JSON.stringify({ xml: XML }),
    }),
  );
  expect(importRes.status).toBe(200);
  const imported = (await importRes.json()) as { invoice_id: string };

  const matchRes = await matchHandler(
    new Request("http://localhost/match-invoice-lines", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: imported.invoice_id }),
    }),
  );
  expect(matchRes.status).toBe(200);

  return { tables, invoice: tables.invoices.find((i) => i.id === imported.invoice_id)! };
}

const reasons = (line: Row): string[] => String(line.review_reason ?? "").split(",").filter(Boolean);

describe("EHF-import → matching: uavklart beløp overlever", () => {
  it("rabattlinje uten linjebeløp beholder gjennomgang og får ingen pris", async () => {
    const { tables, invoice } = await runImportThenMatch();
    const line = tables.invoice_lines.find((l) => l.description === "Sukker")!;

    // Importen: beløpet finnes ikke i dokumentet og skal ikke dikte seg fram.
    expect(line.total_amount).toBeNull();
    expect(line.unit_price).toBe(100);

    // Matchingen: fant varen, men beløpet er fortsatt ukjent.
    expect(line.raw_material_id).toBe(RM);
    expect(line.requires_review).toBe(true);
    expect(reasons(line)).toContain("extraction_unresolved");
    expect(line.price_per_base_unit).toBeNull();
    expect(line.base_quantity).toBeNull();
    // 2 × 100 = 200 er prisen FØR rabatt — den skal aldri stå noe sted.
    expect(line.total_amount).not.toBe(200);
    expect(invoice.status).toBe("needs_review");
  });

  it("linje uten mengde får ikke mengde 1", async () => {
    const { tables } = await runImportThenMatch();
    const line = tables.invoice_lines.find((l) => l.description === "Salt")!;
    expect(line.quantity).toBeNull();
    expect(line.total_amount).toBeNull();
    expect(line.requires_review).toBe(true);
    expect(reasons(line)).toContain("extraction_unresolved");
  });

  it("BaseQuantity i en annen enhet gir ingen enhetspris", async () => {
    const { tables } = await runImportThenMatch();
    const line = tables.invoice_lines.find((l) => l.description === "Gjær")!;
    // PriceAmount 100 per 10 stk kan ikke gjøres om til pris per kg.
    expect(line.unit_price).toBeNull();
    expect(line.total_amount).toBe(400);
    expect(line.requires_review).toBe(true);
  });
});
