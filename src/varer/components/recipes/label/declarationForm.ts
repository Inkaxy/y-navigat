import { NUTRITION_KEYS } from "@/varer/lib/effectiveDeclaration";
import { NUTRIENT_LABEL } from "@/varer/lib/nutritionFormat";
import type { DeclarationDoc } from "./DeclarationDiffView";

const NUT_UNIT: Record<string, string> = {
  energy_kj: "kJ", energy_kcal: "kcal", fat_g: "g", saturated_fat_g: "g",
  carbs_g: "g", sugars_g: "g", fiber_g: "g", protein_g: "g", salt_g: "g",
};
export const NUT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(NUTRIENT_LABEL).map(([k, label]) => [k, `${label} (${NUT_UNIT[k] ?? "g"})`]),
);

export interface Form {
  ingredientText: string;
  contains: string;
  mayContain: string;
  nutrition: Record<string, string>;
}

export const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
export const parseNum = (v: string) => (v !== "" && Number.isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : null);

export function formToDoc(f: Form): DeclarationDoc {
  const nutrition: Record<string, number | null> = {};
  for (const k of NUTRITION_KEYS) nutrition[k] = parseNum(f.nutrition[k] ?? "");
  return { ingredientText: f.ingredientText.trim() || null, contains: splitList(f.contains), mayContain: splitList(f.mayContain), nutrition };
}

export type Pending = { kind: "fill"; next: Form } | { kind: "assistant"; text: string } | { kind: "save" } | { kind: "source" };
