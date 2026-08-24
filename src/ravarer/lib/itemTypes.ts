import { CATEGORY_CONSUMABLES, CATEGORY_PACKAGING } from "@/ravarer/lib/categories";

export type ItemType = "ravare" | "emballasje" | "forbruksvare" | "videresalg";

export const ITEM_TYPES: { value: ItemType; label: string; hint: string }[] = [
  { value: "ravare", label: "Råvare", hint: "Inngår i oppskrifter og produkter" },
  { value: "emballasje", label: "Emballasje", hint: "Bokser, lokk, film, etiketter — følger produktene ut" },
  { value: "forbruksvare", label: "Forbruksvare", hint: "Rengjøring, hansker o.l. — brukes i drift" },
  { value: "videresalg", label: "Videresalg", hint: "Kjøpes inn og selges videre uten bearbeiding" },
];

export function itemTypeLabel(t?: string | null): string {
  return ITEM_TYPES.find((i) => i.value === t)?.label ?? "Råvare";
}

/** Standard kategori-forslag ved oppretting. Videresalg lar kategori stå åpen. */
export function defaultCategoryFor(t: ItemType): string | null {
  if (t === "emballasje") return CATEGORY_PACKAGING;
  if (t === "forbruksvare") return CATEGORY_CONSUMABLES;
  return null;
}

export function isNonRavare(t?: string | null): boolean {
  return !!t && t !== "ravare";
}
