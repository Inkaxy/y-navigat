// Fra uthentingens linjer til invoice_lines-rader. Ren funksjon — testes i vitest.
// Bevarer linjetype, prisgrunnlag (per enhet / per kg/l) og linjerabatt slik at databasens
// lesekontroll (rm_line_read_issues_v2) regner med riktig grunnlag i stedet for å gjette.
import { parsePackageFromDescription } from "../_shared/units.ts";
import { resolveLineNumbers } from "../_shared/numberTokens.ts";
import { LINE_KINDS, normalizeUnit, num, toDbPriceBasis, discountAmountFrom, type DbPriceBasis } from "../_shared/invoiceExtraction.ts";

export interface InvoiceLineRow {
  invoice_id: string;
  line_number: number;
  supplier_sku: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  vat_rate: number | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  line_kind: string | null;
  unit_price_basis: DbPriceBasis | null;
  discount_amount: number | null;
  ledger_account: string | null;
  /** Leserens strukturerte varsler (f.eks. tvetydig tall) — lagres sammen med databasens egen kontroll. */
  read_issues: Array<{ code: string; message: string }>;
  /** Hvordan tallene ble lest (råtekst + tolkning) og linjens egen modellscore. */
  evidence: { confidence: number | null; number_evidence: unknown[] };
}

function issuesOf(v: unknown): Array<{ code: string; message: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ code: string; message: string }> = [];
  for (const x of v) {
    const r = rec(x);
    if (typeof r.code === "string" && r.code) out.push({ code: r.code.slice(0, 60), message: typeof r.message === "string" ? r.message.slice(0, 300) : "" });
    if (out.length >= 20) break;
  }
  return out;
}

const BASES: readonly string[] = ["mengdeenhet", "pakning", "stk", "kg", "g", "l", "ml"];

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function toInvoiceLineRows(rawLines: unknown, invoiceId: string, ledgerAccount: string | null): InvoiceLineRow[] {
  const list = Array.isArray(rawLines) ? rawLines.map(rec) : [];
  return list
    .filter((l) => (l.description ?? "") !== "" || num(l.total_amount) !== null)
    .map((l, i) => {
      // Pakningsfeltene kommer fra uthentingen. Mangler de, tolkes beskrivelsen («36X90G»).
      let packageSize = num(l.package_size);
      let packageUnit = normalizeUnit(l.package_unit);
      let countPerPackage = num(l.count_per_package);
      if (packageSize == null || !packageUnit) {
        const parsed = parsePackageFromDescription(typeof l.description === "string" ? l.description : null);
        if (parsed) {
          packageSize = parsed.size;
          packageUnit = parsed.unit;
          countPerPackage = parsed.count ?? 1;
        }
      }
      const unit = normalizeUnit(l.unit);
      const kindRaw = typeof l.line_kind === "string" ? l.line_kind.toLowerCase() : "";
      const kind = (LINE_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : null;
      // Foretrekk ferdig avledet grunnlag fra uthentingen; ellers avled fra modellens per_unit/per_base.
      const pb = typeof l.price_basis === "string" && BASES.includes(l.price_basis) ? (l.price_basis as DbPriceBasis) : null;
      const modelBasis = l.unit_price_basis === "per_base" ? "per_base" : l.unit_price_basis === "per_unit" ? "per_unit" : null;
      const basis = pb ?? toDbPriceBasis(modelBasis, unit, packageUnit);
      // Samme feltbevisste tolkning som leseren: tvetydig råtekst («10.000») avgjøres bare av regnestykket.
      const factor = basis && basis !== "mengdeenhet" && basis !== "pakning" && basis !== "stk" && packageSize != null && modelBasis === "per_base" ? packageSize * (countPerPackage ?? 1) : 1;
      const nums = resolveLineNumbers(l, factor);
      const total = nums.total_amount;
      const discRaw = num(l.discount_amount);
      const discount = discRaw != null && discRaw > 0 ? discRaw : discountAmountFrom(num(l.discount_pct), total);
      return {
        invoice_id: invoiceId,
        line_number: i + 1,
        supplier_sku: typeof l.sku === "string" && l.sku.trim() ? l.sku.trim() : null,
        description: typeof l.description === "string" ? l.description : null,
        quantity: nums.quantity,
        unit,
        unit_price: nums.unit_price,
        total_amount: total,
        vat_rate: num(l.vat_rate),
        package_size: packageSize,
        package_unit: packageUnit,
        count_per_package: countPerPackage,
        line_kind: kind,
        unit_price_basis: basis,
        discount_amount: discount,
        ledger_account: ledgerAccount,
        read_issues: [
          ...issuesOf(l.read_issues),
          ...nums.unresolved
            .filter(() => !issuesOf(l.read_issues).some((x) => x.code === "tvetydig_tall"))
            .map((f) => ({ code: "tvetydig_tall", message: `Tvetydig tall i ${f}: kan ikke avgjøres sikkert. Kontroller mot dokumentet.` })),
          // Samme regel som leseren: ugyldig trykt tallformat (f.eks. feil tusengruppe) erstattes aldri av modelltallet.
          ...nums.invalid
            .filter(() => !issuesOf(l.read_issues).some((x) => x.code === "ugyldig_tall"))
            .map((f) => ({ code: "ugyldig_tall", message: `Ugyldig tallformat i ${f}: tallet er ikke tolket. Les det av originalen.` })),
        ].slice(0, 20),
        evidence: {
          confidence: num(l.confidence),
          number_evidence: [...(Array.isArray(l.number_evidence) ? l.number_evidence : []), ...nums.evidence].slice(0, 10),
        },
      };
    });
}
