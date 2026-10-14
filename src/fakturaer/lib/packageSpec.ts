// Felles pakningsspesifikasjon for begge pakningsskjemaer (koblingsskjemaet og linjeskjemaet):
// «Fakturert som» (rå enhet på fakturaen) · «Kjøpes som» (fysisk beholder) · «Innhold per beholder» (størrelse + enhet).
// Omregning til grunnenhet skjer bare via readPackageDraft/toBaseFactor; antall og vekt blandes aldri.
import { readPackageDraft } from "@/fakturaer/lib/packageDraft";
import { fmtNum, normalizeUnit, toBaseFactor } from "@/fakturaer/lib/units";

export const CONTAINER_OPTIONS = ["pose", "sekk", "kartong", "eske", "pakke", "stk"] as const;
export const CONTENT_UNITS = ["g", "kg", "ml", "l", "stk"] as const;

export interface PackageSpecInput { container: string; size: string; contentUnit: string }

export type PackageSpec =
  | { state: "empty"; containerMismatch: boolean }
  | { state: "invalid"; reason: string; containerMismatch: boolean }
  | { state: "valid"; size: number; unit: string; baseUnitsPerPackage: number; text: string; containerMismatch: boolean };

/** Innholdsenheter som kan regnes om til grunnenheten (stk-vare: bare stk; kg-vare: g/kg; l-vare: ml/l). */
export function contentUnitsFor(baseUnit: string | null | undefined): string[] {
  const base = normalizeUnit(baseUnit);
  if (!base) return [];
  return CONTENT_UNITS.filter((u) => toBaseFactor(u, base) != null);
}

/** Startverdi: fakturaens enhet som beholder når den er en kjent beholder, ellers tom. */
export function initialContainer(invoiceUnit: string | null | undefined): string {
  const n = normalizeUnit(invoiceUnit);
  return n && (CONTAINER_OPTIONS as readonly string[]).includes(n) ? n : "";
}

export function describePackageSpec(v: PackageSpecInput, baseUnit: string | null | undefined, invoiceUnit: string | null | undefined): PackageSpec {
  const inv = normalizeUnit(invoiceUnit);
  const containerMismatch = !!v.container && !!inv && inv !== normalizeUnit(v.container);
  const base = normalizeUnit(baseUnit);
  const cu = normalizeUnit(v.contentUnit);
  if (!v.size.trim()) return { state: "empty", containerMismatch };
  if (!v.container) return { state: "invalid", reason: "Velg hva varen kjøpes som (pose, sekk, kartong …).", containerMismatch };
  if (base && cu && toBaseFactor(cu, base) == null) {
    const kind = base === "stk" ? "et antall stk" : base === "kg" ? "vekt (g eller kg)" : "volum (ml eller l)";
    return { state: "invalid", reason: `Varen regnes i ${base}, så innholdet må oppgis som ${kind}. Antall og vekt kan ikke blandes.`, containerMismatch };
  }
  const d = readPackageDraft(v.size, v.contentUnit, baseUnit);
  if (d.state === "empty") return { state: "empty", containerMismatch };
  if (d.state === "invalid") return { state: "invalid", reason: d.reason, containerMismatch };
  const bu = d.baseUnitsPerPackage;
  const conv = normalizeUnit(d.unit) === base ? "" : ` = ${fmtNum(bu, 3)} ${base}`;
  return { state: "valid", size: d.size, unit: d.unit, baseUnitsPerPackage: bu, containerMismatch,
    text: `1 ${v.container} inneholder ${fmtNum(d.size, 3)} ${d.unit}${conv}.` };
}
