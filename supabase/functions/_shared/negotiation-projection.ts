// Feltene leverandørportalene får se.
//
// Portalene er offentlige (token + passord), så et `select("*")` på
// negotiation_items ville sendt interne kost- og margintall ut av huset.
// Her er både SELECT-lista og responsprojeksjonen eksplisitt: nye kolonner i
// tabellen lekker aldri automatisk.

/** Interne felter som ALDRI skal ut. Brukes av tester som en ekstra sperre. */
export const FORBIDDEN_ITEM_FIELDS = [
  "actual_cost_baseline",
  "target_price",
  "current_price",
  "baseline_price",
  "internal_note",
  "internal_notes",
  "buyer_notes",
  "walk_away_price",
  "max_price",
  "margin",
  "margin_pct",
  "savings_target",
  "priority",
] as const;

export const RFQ_ITEM_SELECT =
  "id, raw_material_id, expected_annual_volume, expected_annual_volume_unit, suggested_package_size, suggested_package_unit, sort_order, raw_materials(name, base_unit, package_size, package_unit)";

export const LIVE_ITEM_SELECT =
  "id, raw_material_id, live_agreed_price, live_agreed_price_unit, live_agreed_package_size, live_agreed_package_unit, live_agreed_contract_months, live_agreed_min_volume, live_agreed_min_volume_unit, live_status, sort_order, raw_materials(name, base_unit)";

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}
function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function rawMaterial(row: Row, withPackage: boolean) {
  const rm = row.raw_materials as Row | null | undefined;
  if (!rm) return null;
  const base = { name: str(rm.name) ?? "", base_unit: str(rm.base_unit) ?? "" };
  if (!withPackage) return base;
  return { ...base, package_size: num(rm.package_size), package_unit: str(rm.package_unit) };
}

/** Bygger svaret til RFQ-portalen felt for felt. */
export function projectRfqItems(rows: Row[] | null | undefined) {
  return (rows ?? []).map((r) => ({
    id: str(r.id),
    raw_material_id: str(r.raw_material_id),
    expected_annual_volume: num(r.expected_annual_volume),
    expected_annual_volume_unit: str(r.expected_annual_volume_unit),
    suggested_package_size: num(r.suggested_package_size),
    suggested_package_unit: str(r.suggested_package_unit),
    raw_materials: rawMaterial(r, true),
  }));
}

/** Bygger svaret til bekreftelsesportalen felt for felt. */
export function projectLiveItems(rows: Row[] | null | undefined) {
  return (rows ?? []).map((r) => ({
    id: str(r.id),
    raw_material_id: str(r.raw_material_id),
    live_agreed_price: num(r.live_agreed_price),
    live_agreed_price_unit: str(r.live_agreed_price_unit),
    live_agreed_package_size: num(r.live_agreed_package_size),
    live_agreed_package_unit: str(r.live_agreed_package_unit),
    live_agreed_contract_months: num(r.live_agreed_contract_months),
    live_agreed_min_volume: num(r.live_agreed_min_volume),
    live_agreed_min_volume_unit: str(r.live_agreed_min_volume_unit),
    live_status: str(r.live_status),
    raw_materials: rawMaterial(r, false),
  }));
}

/** Leverandørens egne svar — bare det portalen selv har sendt inn. */
export const RFQ_RESPONSE_SELECT =
  "negotiation_item_id, offered_price, offered_price_unit, offered_package_size, offered_package_unit, contract_length_months, min_order_volume, min_order_unit, payment_terms, delivery_terms, notes, datasheet_url, status";

export function projectRfqResponses(rows: Row[] | null | undefined) {
  return (rows ?? []).map((r) => ({
    negotiation_item_id: str(r.negotiation_item_id),
    offered_price: num(r.offered_price),
    offered_price_unit: str(r.offered_price_unit),
    offered_package_size: num(r.offered_package_size),
    offered_package_unit: str(r.offered_package_unit),
    contract_length_months: num(r.contract_length_months),
    min_order_volume: num(r.min_order_volume),
    min_order_unit: str(r.min_order_unit),
    payment_terms: str(r.payment_terms),
    delivery_terms: str(r.delivery_terms),
    notes: str(r.notes),
    datasheet_url: str(r.datasheet_url),
    status: str(r.status),
  }));
}
