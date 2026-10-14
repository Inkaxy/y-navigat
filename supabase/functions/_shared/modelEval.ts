// Ren logikk for adminbeskyttet, skrivebeskyttet modellsammenligning (invoice-model-eval).
// Samme prompt, samme schema og samme kontrollfakta for alle modeller.

import { checkSum, type ExtractedLine } from "./invoiceExtraction.ts";

/** Server-allowlist. Ingen andre modeller kan kjøres fra evalen. */
export const EVAL_MODELS = ["gpt-4o", "gpt-6.1-sol", "gpt-6-luna"] as const;
export type EvalModel = (typeof EVAL_MODELS)[number];
export const isEvalModel = (v: unknown): v is EvalModel => typeof v === "string" && (EVAL_MODELS as readonly string[]).includes(v);

export const EVAL_LIMITS = {
  maxOutputTokens: 12000,
  timeoutMs: 140_000,
  maxPdfBytes: 15 * 1024 * 1024,
  /** Samme faktura+modell innen dette vinduet avvises (dobbeltklikk/duplikat). */
  dedupWindowMs: 2 * 60 * 1000,
  /** Maks evalkall per selskap per døgn (første test: ca. 6 PDF × 3 modeller). */
  maxPerDay: 24,
} as const;

const n = (t: string) => ({ anyOf: [{ type: t }, { type: "null" }] });

/** Versjon av schemaet. Følger hvert evalresultat slik at «nytt schema» ikke blandes med «ny modell». */
export const INVOICE_EXTRACTION_SCHEMA_VERSION = "strict-v2-2026-10-14";
const TOP_FIELDS = ["supplier_name", "supplier_org_number", "invoice_number", "invoice_date", "due_date", "total_amount", "total_excl_vat", "total_vat", "currency", "kid_number", "account_number"] as const;

/**
 * Strict schema for fakturaleserens JSON: ALLE felt prompten ber om og parseren leser
 * (inkl. field_confidence, *_raw, unit_price_basis, discount_pct). discount_amount/_raw/_kind ber prompten om;
 * parseren godtar bare trykt beløp bundet til råteksten (lineDiscountFrom).
 */
export const INVOICE_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["supplier_name", "supplier_org_number", "invoice_number", "invoice_date", "due_date", "total_amount", "total_excl_vat", "total_vat", "currency", "kid_number", "account_number", "lines", "lines_sum_self_check", "field_confidence"],
  properties: {
    supplier_name: n("string"), supplier_org_number: n("string"), invoice_number: n("string"),
    invoice_date: n("string"), due_date: n("string"), total_amount: n("number"), total_excl_vat: n("number"),
    total_vat: n("number"), currency: n("string"), kid_number: n("string"), account_number: n("string"),
    lines_sum_self_check: n("number"),
    field_confidence: {
      type: "object", additionalProperties: false, required: [...TOP_FIELDS],
      properties: Object.fromEntries(TOP_FIELDS.map((f) => [f, n("number")])),
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["line_kind", "sku", "sku_raw", "ean", "description", "quantity", "quantity_raw", "unit", "unit_price", "unit_price_raw", "unit_price_unit_raw", "unit_price_basis", "total_amount", "total_amount_raw", "discount_pct", "discount_amount", "discount_amount_raw", "discount_kind", "vat_rate", "package_size", "package_unit", "count_per_package", "package_raw", "page_number", "confidence"],
        properties: {
          line_kind: { anyOf: [{ type: "string", enum: ["vare", "pant", "frakt", "gebyr", "rabatt", "avrunding", "mva", "annet"] }, { type: "null" }] },
          sku: n("string"), sku_raw: n("string"), ean: n("string"), description: n("string"),
          quantity: n("number"), quantity_raw: n("string"), unit: n("string"),
          unit_price: n("number"), unit_price_raw: n("string"), unit_price_unit_raw: n("string"),
          unit_price_basis: { anyOf: [{ type: "string", enum: ["per_unit", "per_base"] }, { type: "null" }] },
          total_amount: n("number"), total_amount_raw: n("string"), discount_pct: n("number"), discount_amount: n("number"), discount_amount_raw: n("string"),
          discount_kind: { anyOf: [{ type: "string", enum: ["rabatt", "paslag"] }, { type: "null" }] }, vat_rate: n("number"),
          package_size: n("number"), package_unit: n("string"), count_per_package: n("number"), package_raw: n("string"),
          page_number: n("integer"), confidence: n("number"),
        },
      },
    },
  },
};

export interface EvalCheck { code: string; message: string; line?: number }

/** Deterministiske kontrollfeil — ingen fasit, bare dokumentets egne regnestykker. */
export function deterministicChecks(lines: readonly ExtractedLine[], expected: { excl: number | null; incl: number | null; vat: number | null }): { checks: EvalCheck[]; counts: Record<string, number> } {
  const checks: EvalCheck[] = [];
  lines.forEach((l, i) => {
    for (const ri of l.read_issues ?? []) checks.push({ code: String(ri.code), message: ri.message, line: i + 1 });
    const goods = (l.line_kind ?? "vare") === "vare";
    if (goods && l.package_size == null && !["kg", "g", "l", "ml", "dl"].includes(l.unit ?? "")) {
      checks.push({ code: "pakning_mangler", message: "Varelinje uten lest pakningsstørrelse", line: i + 1 });
    }
    if (goods && l.unit_price_basis == null) checks.push({ code: "prisgrunnlag_ukjent", message: "Prisgrunnlag ikke angitt", line: i + 1 });
  });
  const sc = checkSum(lines, expected.excl, expected.incl, expected.vat);
  for (const ri of sc.issues) checks.push({ code: String(ri.code), message: ri.message });
  if (lines.length === 0) checks.push({ code: "ingen_linjer", message: "Ingen linjer lest" });
  const counts: Record<string, number> = {};
  for (const c of checks) counts[c.code] = (counts[c.code] ?? 0) + 1;
  return { checks, counts };
}
