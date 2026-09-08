/**
 * Avrunding av bestillingsforslag til hele innkjøpspakninger.
 *
 * Ren funksjon fordi feilen her er dyr: runder man til `package_size` uten å ta
 * hensyn til enheten, blir «4 sekker à 25 kg» til «4 kg».
 */
import { toBaseFactor } from "@/fakturaer/lib/units";

export interface PackageInfo {
  /** Bekreftet innhold per pakning, allerede i baseenhet. */
  base_units_per_package?: number | null;
  /** Pakningsstørrelse oppgitt i `package_unit`. */
  package_size?: number | null;
  package_unit?: string | null;
}

export interface RawMaterialUnitLike {
  unit_label: string;
  units_in_base: number;
}

/**
 * Hvor mange BASEENHETER én innkjøpspakning inneholder.
 * Rekkefølge: bekreftet innhold → størrelse × enhetsfaktor → ukjent (null).
 */
export function packageBaseUnits(
  info: PackageInfo | null | undefined,
  baseUnit: string | null | undefined,
  units?: RawMaterialUnitLike[],
): number | null {
  if (!info) return null;
  const confirmed = Number(info.base_units_per_package);
  if (Number.isFinite(confirmed) && confirmed > 0) return confirmed;

  const size = Number(info.package_size);
  if (!Number.isFinite(size) || size <= 0) return null;

  // Pakningsenheten kan være en råvarespesifikk enhet («sekk» = 25 kg), ikke
  // bare en enhet toBaseFactor kjenner globalt.
  const customUnit = units?.find(u => u.unit_label.toLowerCase() === (info.package_unit ?? "").toLowerCase());
  if (customUnit && customUnit.units_in_base > 0) return size * customUnit.units_in_base;

  const factor = toBaseFactor(info.package_unit ?? "", baseUnit ?? "");
  if (factor == null || !(factor > 0)) return null;
  return size * factor;
}

export interface RoundedOrder {
  /** Antall hele pakninger. Null når pakningen er ukjent. */
  packages: number | null;
  /** Mengde i baseenhet etter opprunding. */
  orderBaseQty: number;
  /** Innhold per pakning i baseenhet, når kjent. */
  baseUnitsPerPackage: number | null;
}

/**
 * ceil(behov / innhold per pakning) × innhold per pakning.
 * Uten kjent pakning rundes det opp til hele grunnenheter.
 */
export function roundToPackages(behov: number, baseUnitsPerPackage: number | null): RoundedOrder {
  if (!Number.isFinite(behov) || behov <= 0) {
    return { packages: null, orderBaseQty: 0, baseUnitsPerPackage };
  }
  if (baseUnitsPerPackage == null || !(baseUnitsPerPackage > 0)) {
    return { packages: null, orderBaseQty: Math.ceil(behov), baseUnitsPerPackage: null };
  }
  const packages = Math.ceil(behov / baseUnitsPerPackage);
  // Flyttall: 3 × 0,1 skal bli 0,3, ikke 0,30000000000000004.
  const orderBaseQty = Number((packages * baseUnitsPerPackage).toFixed(6));
  return { packages, orderBaseQty, baseUnitsPerPackage };
}
