// Strenge lesere for rm_correct_raw_material_type_unit (forhåndsvisning og lagring).
import { isObj, num, str, bool, type Obj } from "@/fakturaer/lib/parseRpcJson";

export type TypeUnitBlocker =
  | { code: "kost_fort"; count: number }
  | { code: "lager_finnes"; count: number }
  | { code: "oppskrift_krever_mapping"; lines: { recipeLineId: string; recipeId: string; unit: string | null }[] };

export interface TypeUnitPreview {
  updatedAt: string;
  from: { itemType: string; baseUnit: string };
  unitChanges: boolean;
  typeChanges: boolean;
  blockers: TypeUnitBlocker[];
  compatibleRecipeLines: number;
  priceHistoryToSupersede: number;
  packageConfirmationsToReset: number;
  openInvoices: number;
}

export type TypeUnitApply =
  | { kind: "saved"; already: boolean; updatedAt: string; itemType: string; baseUnit: string; packageConfirmationsReset: number; priceHistorySuperseded: number; openInvoicesRequeued: number }
  | { kind: "rejected"; error: string; blockers: TypeUnitBlocker[] }
  | { kind: "unknown" };

function parseBlockers(v: unknown): TypeUnitBlocker[] | null {
  if (!Array.isArray(v)) return null;
  const out: TypeUnitBlocker[] = [];
  for (const b of v) {
    if (!isObj(b)) return null;
    const code = str(b, "code");
    if (code === "kost_fort" || code === "lager_finnes") out.push({ code, count: num(b, "count") ?? 0 });
    else if (code === "oppskrift_krever_mapping" && Array.isArray(b.lines)) {
      out.push({ code, lines: b.lines.filter(isObj).map((l: Obj) => ({ recipeLineId: str(l, "recipe_line_id") ?? "", recipeId: str(l, "recipe_id") ?? "", unit: str(l, "unit") })) });
    } else return null; // ukjent sperre: aldri tolket som «ingen sperre»
  }
  return out;
}

export function parseTypeUnitPreview(data: unknown, rawMaterialId: string): TypeUnitPreview | null {
  if (!isObj(data) || data.ok !== true || data.dry_run !== true || str(data, "raw_material_id") !== rawMaterialId) return null;
  const from = isObj(data.from) ? data.from : null;
  const updatedAt = str(data, "updated_at");
  const blockers = parseBlockers(data.blockers);
  const unitChanges = bool(data, "unit_changes");
  const typeChanges = bool(data, "type_changes");
  if (!from || !updatedAt || !blockers || unitChanges == null || typeChanges == null) return null;
  return {
    updatedAt, from: { itemType: str(from, "item_type") ?? "", baseUnit: str(from, "base_unit") ?? "" }, unitChanges, typeChanges, blockers,
    compatibleRecipeLines: num(data, "compatible_recipe_lines") ?? 0, priceHistoryToSupersede: num(data, "price_history_to_supersede") ?? 0,
    packageConfirmationsToReset: num(data, "package_confirmations_to_reset") ?? 0, openInvoices: num(data, "open_invoices") ?? 0,
  };
}

const KNOWN_REJECTIONS = new Set(["versjon_endret", "sperret", "ingen_endring", "begrunnelse_mangler", "ugyldig_varetype", "ugyldig_grunnenhet", "op_mangler"]);

export function parseTypeUnitApply(data: unknown, rawMaterialId: string): TypeUnitApply {
  if (!isObj(data)) return { kind: "unknown" };
  if (data.ok === false) {
    const error = str(data, "error");
    if (!error || !KNOWN_REJECTIONS.has(error)) return { kind: "unknown" };
    return { kind: "rejected", error, blockers: parseBlockers(data.blockers ?? []) ?? [] };
  }
  if (data.ok !== true || str(data, "raw_material_id") !== rawMaterialId) return { kind: "unknown" };
  const updatedAt = str(data, "updated_at"); const itemType = str(data, "item_type"); const baseUnit = str(data, "base_unit");
  if (!updatedAt || !itemType || !baseUnit) return { kind: "unknown" };
  return {
    kind: "saved", already: data.already === true, updatedAt, itemType, baseUnit,
    packageConfirmationsReset: num(data, "package_confirmations_reset") ?? 0,
    priceHistorySuperseded: num(data, "price_history_superseded") ?? 0,
    openInvoicesRequeued: num(data, "open_invoices_requeued") ?? 0,
  };
}

export const REJECTION_TEXT: Record<string, string> = {
  versjon_endret: "Varen er endret av noen andre. Ingenting er lagret – åpne rettingen på nytt.",
  sperret: "Rettingen er sperret. Se årsakene under.",
  ingen_endring: "Varetype og grunnenhet er allerede slik.",
  begrunnelse_mangler: "Skriv en begrunnelse (minst 5 tegn).",
  ugyldig_varetype: "Ugyldig varetype.",
  ugyldig_grunnenhet: "Ugyldig grunnenhet.",
  op_mangler: "Teknisk feil: mangler operasjons-ID.",
};

export function blockerText(b: TypeUnitBlocker): string {
  if (b.code === "kost_fort") return `Kostpris er ført på ${b.count} fakturalinje(r). Reverser føringen før grunnenheten endres.`;
  if (b.code === "lager_finnes") return "Varen har lagerbeholdning. Juster lageret til 0 før grunnenheten endres.";
  return `${b.lines.length} oppskriftslinje(r) bruker en enhet som ikke passer den nye grunnenheten (${[...new Set(b.lines.map((l) => l.unit ?? "ukjent"))].join(", ")}). Oppskriftene må rettes først – mengdene endres ikke automatisk.`;
}
