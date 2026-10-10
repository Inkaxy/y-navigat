import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import type { PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";

/** Rad for PackageEditor når råvaren ikke står i pakningskøen. */
export function fallbackPackageRow(rm: RawMaterialRow): PackageWorklistRow {
  return {
    id: rm.id,
    legal_entity_id: rm.legal_entity_id,
    name: rm.name,
    base_unit: rm.base_unit,
    category: rm.category,
    current_cost_price: rm.current_cost_price,
    pakningsfaktor: rm.base_units_per_package,
    faktor_kilde: rm.package_confirmed_at ? "bekreftet" : null,
    bekreftet_dato: rm.package_confirmed_at,
    antall_fakturalinjer: null,
    antall_leverandorer: null,
    enheter_i_bruk: null,
    linjer_uten_pris: null,
    kjopt_kr_totalt: null,
    siste_faktura: null,
    pris_spredning: null,
    implisert_mengde: null,
    referansepris: null,
    referansekilde: null,
    referansedato: null,
  } as PackageWorklistRow;
}
