import type { SupplierItem } from "@/fakturaer/lib/supplierItems";

const DIMENSIONAL = new Set(["kg", "g", "l", "ml", "dl", "cl"]);
const SAME_DIM: Record<string, { dim: "m" | "v"; f: number }> = { g: { dim: "m", f: 1 }, kg: { dim: "m", f: 1000 }, ml: { dim: "v", f: 1 }, cl: { dim: "v", f: 10 }, dl: { dim: "v", f: 100 }, l: { dim: "v", f: 1000 } };
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
  const bu = (i.rm_base_unit ?? "").toLowerCase();
  if (i.base_units_per_package == null || i.package_size == null) return null;
  // Bare eksakt definert omregning innen samme dimensjon (g/kg, ml/cl/dl/l); aldri vekt↔volum.
  const fp = SAME_DIM[pu], fb = SAME_DIM[bu];
  if (!fp || !fb || fp.dim !== fb.dim) return null;
  const sizeInBase = (i.package_size * fp.f) / fb.f;
  if (Math.abs(sizeInBase - i.base_units_per_package) <= 1e-9 * Math.max(1, Math.abs(i.base_units_per_package))) return null;
  return `Lagret pakningsstørrelse ${n(i.package_size)} ${i.package_unit} stemmer ikke med innhold ${n(i.base_units_per_package)} ${i.rm_base_unit} — kontroller pakningen.`;
}
