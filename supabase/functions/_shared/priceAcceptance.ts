import { normalizeUnit } from "./units.ts";
import { packageSignature } from "./packageSignature.ts";

// deno-lint-ignore no-explicit-any
type AnyRec = Record<string, any>;

const ACCEPTABLE_PRICE_REASONS = new Set(["price_variance", "price_increase", "price_drop"]);
const round4 = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10000) / 10000);
const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

/**
 * Et godtatt prisavvik gjelder bare for NØYAKTIG samme grunnlag: samme vare,
 * mengde, enhet, beløp, beregnet pris og prisreferanse. Da fjernes kun de
 * prisårsakene som faktisk ble godtatt — alle andre årsaker står. Ved endret
 * grunnlag slettes godkjenningen og avviket må avklares igjen.
 */
export function reconcileAcceptance(
  line: AnyRec,
  target: AnyRec,
  rawMaterialId: string | null,
  /** Leverandørkoblingen motoren brukte som pakningskilde nå (null = ingen entydig). */
  rmsRow: AnyRec | null = null,
): void {
  const acc = line.price_acceptance as AnyRec | null;
  if (!acc) return;
  const unitNow = target.unit ?? line.unit;
  const identical =
    same(acc.raw_material_id, rawMaterialId) &&
    round4(acc.quantity) === round4(line.quantity) &&
    same(normalizeUnit(acc.unit), normalizeUnit(unitNow)) &&
    round4(acc.unit_price) === round4(line.unit_price) &&
    round4(acc.total_amount) === round4(line.total_amount) &&
    round4(acc.base_quantity) === round4(target.base_quantity) &&
    round4(acc.package_size) === round4(line.package_size) &&
    same(normalizeUnit(acc.package_unit), normalizeUnit(line.package_unit)) &&
    round4(acc.count_per_package) === round4(line.count_per_package) &&
    same(acc.rms_id, rmsRow?.id ?? null) &&
    (acc.rms_package == null) === (rmsRow == null) &&
    (rmsRow == null || packageSignature(acc.rms_package ?? {}) === packageSignature(rmsRow)) &&
    round4(acc.price_per_base_unit) === round4(target.price_per_base_unit) &&
    round4(acc.expected_price_per_base_unit) === round4(target.expected_price_per_base_unit) &&
    same(acc.price_reference_source, target.price_reference_source) &&
    same(acc.price_reference_id, target.price_reference_id) &&
    same(acc.price_reference_date, target.price_reference_date);
  if (!identical) {
    target.price_acceptance = null;
    return;
  }
  const accepted = new Set<string>(
    (Array.isArray(acc.accepted_reasons) ? acc.accepted_reasons : []).filter((r: string) => ACCEPTABLE_PRICE_REASONS.has(r)),
  );
  const reasons = String(target.review_reason ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const rest = reasons.filter((r) => !accepted.has(r));
  target.review_reason = rest.length ? rest.join(",") : null;
  // Bare når de godtatte prisårsakene var ALT som sto igjen. Et flagg uten
  // kjent årsak ryddes aldri bort her.
  if (reasons.length > 0 && rest.length === 0) target.requires_review = false;
  else if (rest.length > 0) target.requires_review = true;
  // Hvem og når står — motoren overskriver ikke et menneskes avgjørelse.
  target.resolution_note = line.resolution_note;
  target.resolved_by = line.resolved_by;
  target.resolved_at = line.resolved_at;
}

