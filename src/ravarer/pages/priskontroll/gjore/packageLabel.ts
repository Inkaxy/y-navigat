import type { SupplierItem } from "@/fakturaer/lib/supplierItems";

const DIMENSIONAL = new Set(["kg", "g", "l", "ml", "dl", "cl"]);
const n = (v: number) => v.toLocaleString("nb-NO", { maximumFractionDigits: 3 });

type Pkg = Pick<SupplierItem, "base_units_per_package" | "rm_base_unit" | "package_unit" | "package_size">;

/** Pakningsinnhold uten å gjette beholder: en målenhet (kg/l …) er innhold, ikke et emballasjenavn. */
export function packageLabel(i: Pkg): string {
  if (i.base_units_per_package == null) return "Regnes direkte fra fakturaenheten";
  const content = `${n(i.base_units_per_package)} ${i.rm_base_unit ?? ""}`.trim();
  const pu = (i.package_unit ?? "").toLowerCase();
  if (!pu || DIMENSIONAL.has(pu)) return `Pakningsinnhold: ${content}`;
  return `${content} per ${i.package_unit}`;
}

/** Lagret pakningsstørrelse som motsier bekreftet innhold vises til kontroll — rettes aldri stille. */
export function packageConflict(i: Pkg): string | null {
  const pu = (i.package_unit ?? "").toLowerCase();
  if (i.base_units_per_package == null || i.package_size == null || !DIMENSIONAL.has(pu) || pu !== (i.rm_base_unit ?? "").toLowerCase()) return null;
  if (Math.abs(i.package_size - i.base_units_per_package) < 1e-9) return null;
  return `Lagret pakningsstørrelse ${n(i.package_size)} ${i.package_unit} stemmer ikke med innhold ${n(i.base_units_per_package)} ${i.rm_base_unit} — kontroller pakningen.`;
}
