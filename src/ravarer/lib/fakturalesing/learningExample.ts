// Læring av rettinger (C3): hva en menneskelig avgjørelse i Fra faktura lagres som. Ren kode.
// Bare innloggede personer kan lagre eksempler (serveren krever auth.uid()); samlet gjenlesing kan aldri.
import type { PackageState } from "@/ravarer/lib/fraFaktura/newItems";

export type LearningKind = "kobling" | "pakning" | "varenummer" | "antall" | "ikke_vare" | "retting";
export interface LearningExample { kind: LearningKind; corrected: Record<string, string | number | boolean> }

/** Kobling eller ny vare i «Nye varer». Med bekreftet pakning blir det et pakningseksempel. */
export function linkLearning(targetName: string, pkg: PackageState): LearningExample | null {
  const name = targetName.trim();
  if (!name || pkg.state !== "valid") return null;
  const corrected: Record<string, string | number | boolean> = { raw_material_name: name.slice(0, 160), base_unit: pkg.baseUnit };
  if (!pkg.direct) {
    corrected.package_size = pkg.size;
    corrected.package_unit = pkg.unit;
    corrected.base_units_per_package = pkg.baseUnitsPerPackage;
    return { kind: "pakning", corrected };
  }
  return { kind: "kobling", corrected };
}

export const notItemLearning = (): LearningExample => ({ kind: "ikke_vare", corrected: { not_item: true } });
