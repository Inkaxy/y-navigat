/**
 * Visning av leverandørkoblingens pris og pakning (SupplierLinksTable, prisgrunnlag).
 * - Kanonisk enhetspris er `agreed_price_per_base_unit`. Legacy `agreed_price` gis aldri pakningsmening.
 * - Pakningsinnhold vises bare fra bekreftet faktor (`base_units_per_package` + `package_confirmed_at/by`);
 *   manglende `package_size` fylles aldri inn eller hentes fra varenavn.
 * - Avledet pakningspris = enhetspris × bekreftet positiv faktor; ellers «må bekreftes».
 * - Avtale uten `agreed_price_set_at/by` er «registrert, ikke bekreftet».
 */
import { isAgreementConfirmed } from "./priceTimeline";

export interface SupplierPackageInput {
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  package_confirmed_at: string | null;
  package_confirmed_by: string | null;
  agreed_price_per_base_unit: number | null;
  agreed_price_set_at: string | null;
  agreed_price_set_by: string | null;
}

const fmt = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 4 });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Bekreftet, endelig positiv faktor — ellers null. */
export function confirmedFactor(l: SupplierPackageInput): number | null {
  const f = Number(l.base_units_per_package);
  if (l.base_units_per_package == null || !Number.isFinite(f) || !(f > 0)) return null;
  return l.package_confirmed_at && l.package_confirmed_by ? f : null;
}

/** «Sekk · 20 kg per pakning», «25 kg», eller null når ingenting er dokumentert. */
export function packageLabel(l: SupplierPackageInput, baseUnit: string): { label: string | null; confirmed: boolean } {
  const f = confirmedFactor(l);
  const unit = l.package_unit?.trim() || null;
  const size = l.package_size != null && l.package_size > 0 ? l.package_size : null;
  const head = size != null && unit ? `${fmt(size)} ${unit}` : unit ? cap(unit) : null;
  if (f != null) return { label: `${head ? `${head} · ` : ""}${fmt(f)} ${baseUnit} per pakning`, confirmed: true };
  return { label: head, confirmed: false };
}

export type DerivedPackagePrice = { kind: "known"; price: number; factor: number } | { kind: "needs_confirmation" } | { kind: "no_price" };

export function derivedPackagePrice(l: SupplierPackageInput): DerivedPackagePrice {
  const p = l.agreed_price_per_base_unit;
  if (p == null || !Number.isFinite(Number(p))) return { kind: "no_price" };
  const f = confirmedFactor(l);
  if (f == null) return { kind: "needs_confirmation" };
  return { kind: "known", price: Number(p) * f, factor: f };
}

export function agreementStatusLabel(l: SupplierPackageInput): string | null {
  if (l.agreed_price_per_base_unit == null) return null;
  return isAgreementConfirmed(l) ? null : "Registrert avtalepris — ikke bekreftet";
}
