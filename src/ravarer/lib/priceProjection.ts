/**
 * Klientkontrakt for `rm_material_price_projection(p_raw_material_id)` — en skrivebeskyttet
 * kontroll NÅ av om den koblede fakturalinjen støtter prisen i en dokumentert enhet.
 *
 * Regler (material-price-projection-contract):
 * - Originalhistorikken beholdes uendret; projeksjonen flettes på eksakt `history_id`
 *   etter identitetssjekk (kilde/faktura/linje), aldri på pris.
 * - Låst snapshot vinner alltid; en projeksjon overskriver aldri en registrert enhet.
 * - Aktiv kontroll-hold overstyrer graf; duplikat-kilde vises som hendelse.
 * - Ugyldig svar avvises i sin helhet (null), aldri delvis tolket.
 */
import type { TimelineHistoryRow } from "./priceTimeline";

export type ProjectionUnit = "kg" | "g" | "l" | "ml" | "stk";

export interface VerifiedLineProjection {
  history_id: string;
  source: "invoice";
  provenance: "currently_verified_line";
  price: number;
  effective_date: string;
  created_at: string;
  supplier_id: string;
  invoice_id: string;
  invoice_line_id: string;
  invoice_number: string | null;
  unit: ProjectionUnit;
  currency: "NOK";
  line_version: string | null;
  line_unit: string;
  quantity: number;
  base_quantity: number;
  total_amount: number;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  base_units_per_package: number | null;
}

export interface MaterialPriceProjection {
  raw_material_id: string;
  checked_at: string;
  eligible_history_ids: string[];
  held_history_ids: string[];
  duplicate_history_ids: string[];
  projections: VerifiedLineProjection[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const fin = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: readonly string[] = ["kg", "g", "l", "ml", "stk"];

function ids(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) { const s = str(x); if (!s) return null; out.push(s); }
  return out;
}

function parseProjection(v: unknown): VerifiedLineProjection | null {
  if (!isRec(v)) return null;
  const history_id = str(v.history_id), supplier_id = str(v.supplier_id), invoice_id = str(v.invoice_id), invoice_line_id = str(v.invoice_line_id);
  const effective_date = str(v.effective_date), created_at = str(v.created_at), unit = str(v.unit), line_unit = str(v.line_unit);
  const price = fin(v.price), quantity = fin(v.quantity), base_quantity = fin(v.base_quantity), total_amount = fin(v.total_amount);
  if (!history_id || !supplier_id || !invoice_id || !invoice_line_id || !effective_date || !ISO_DATE.test(effective_date) || !created_at) return null;
  if (v.source !== "invoice" || v.provenance !== "currently_verified_line" || v.currency !== "NOK") return null;
  if (!unit || !UNITS.includes(unit) || !line_unit) return null;
  if (price == null || !(price > 0) || quantity == null || base_quantity == null || !(base_quantity > 0) || total_amount == null) return null;
  const optNum = (x: unknown) => (x == null ? null : fin(x));
  const bupp = optNum(v.base_units_per_package);
  if (v.base_units_per_package != null && (bupp == null || !(bupp > 0))) return null;
  return {
    history_id, source: "invoice", provenance: "currently_verified_line", price, effective_date, created_at,
    supplier_id, invoice_id, invoice_line_id, invoice_number: str(v.invoice_number), unit: unit as ProjectionUnit, currency: "NOK",
    line_version: str(v.line_version), line_unit, quantity, base_quantity, total_amount,
    package_size: optNum(v.package_size), package_unit: str(v.package_unit), count_per_package: optNum(v.count_per_package),
    base_units_per_package: bupp,
  };
}

/** Streng tolkning: feil råvare, manglende felt eller ugyldig projeksjon → null (ukjent). */
export function parseMaterialPriceProjection(data: unknown, rawMaterialId: string): MaterialPriceProjection | null {
  if (!isRec(data) || data.raw_material_id !== rawMaterialId) return null;
  const checked_at = str(data.checked_at);
  const eligible = ids(data.eligible_history_ids), held = ids(data.held_history_ids), dup = ids(data.duplicate_history_ids);
  if (!checked_at || !eligible || !held || !dup || !Array.isArray(data.projections)) return null;
  const projections: VerifiedLineProjection[] = [];
  for (const p of data.projections) {
    const parsed = parseProjection(p);
    if (!parsed) return null;
    projections.push(parsed);
  }
  // Tvetydig: samme historikk-ID to ganger → kontrollfeil (null), aldri «siste vinner».
  if (new Set(projections.map((p) => p.history_id)).size !== projections.length) return null;
  return { raw_material_id: rawMaterialId, checked_at, eligible_history_ids: eligible, held_history_ids: held, duplicate_history_ids: dup, projections };
}

const PRICE_EPS = 1e-9;

/**
 * Fletter projeksjonen inn i historikkradene. Hver originalrad beholdes (samme antall, samme id).
 * - hold → `held: true` (vises «Til kontroll», ikke i graf)
 * - duplikat-kilde → `duplicateSource: true` (hendelse, ikke trend/Δ)
 * - projeksjon → enhet/valuta/kilde «Kontrollert fra fakturalinje» KUN når raden mangler låst enhet,
 *   identiteten stemmer (faktura, kilde) og prisen er identisk.
 * Identitet: historikk-ID + kilde + faktura + fakturalinje + effektiv dato + leverandør må alle stemme.
 * Pris er aldri en erstatning for identitet. Avvik → `controlUnknown: "identitet"`.
 * Uten projeksjon (null: feil eller laster) er gjeldende kontroll UKJENT for fakturarader: de beholdes
 * som hendelser med originalverdi, men tas ut av graf/Δ (`controlUnknown`). Andre rader er urørt.
 */
export function mergeProjection(
  rows: readonly TimelineHistoryRow[],
  proj: MaterialPriceProjection | null,
  unknownReason: "feil" | "laster" = "feil",
): TimelineHistoryRow[] {
  if (!proj) return rows.map((r) => (r.source === "invoice" ? { ...r, controlUnknown: unknownReason } : r));
  const byId = new Map(proj.projections.map((p) => [p.history_id, p]));
  const held = new Set(proj.held_history_ids);
  const dup = new Set(proj.duplicate_history_ids);
  return rows.map((r) => {
    let out: TimelineHistoryRow = r;
    if (held.has(r.id)) out = { ...out, held: true };
    if (dup.has(r.id)) out = { ...out, duplicateSource: true };
    const p = byId.get(r.id);
    if (!p) return out;
    const sameIdentity =
      r.source === "invoice" && r.invoice_id === p.invoice_id && !!r.invoice_line_id && r.invoice_line_id === p.invoice_line_id &&
      r.effective_date === p.effective_date && r.supplier_id === p.supplier_id;
    if (!sameIdentity) return { ...out, controlUnknown: "identitet" };
    if (!r.unitSource && Math.abs(Number(r.price) - p.price) <= PRICE_EPS) {
      out = {
        ...out, unit: p.unit, currency: "NOK", unitSource: "currently_verified_line", checkedAt: proj.checked_at,
        invoiceNumber: out.invoiceNumber ?? p.invoice_number, sourceBasePerPackage: p.base_units_per_package,
      };
    }
    return out;
  });
}
