/**
 * Avdeling på oppskrifter (`recipes.department`). Kolonnen er nullable med
 * check på 'bakeri'/'konditori' — «ingen avdeling» er altså NULL.
 */

export type RecipeDepartment = "bakeri" | "konditori";

export const RECIPE_DEPARTMENTS: RecipeDepartment[] = ["bakeri", "konditori"];

export const RECIPE_DEPARTMENT_LABEL: Record<RecipeDepartment, string> = {
  bakeri: "Bakeri",
  konditori: "Konditori",
};

/** Dempede, men adskilte nyanser for badge i lister. */
export const RECIPE_DEPARTMENT_BADGE: Record<RecipeDepartment, string> = {
  bakeri: "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  konditori: "border-rose-600/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
};

/** Trygg innsnevring fra en fri tekstkolonne til den kjente unionen. */
export function asDepartment(value: string | null | undefined): RecipeDepartment | null {
  return value === "bakeri" || value === "konditori" ? value : null;
}

export function departmentLabel(value: string | null | undefined): string | null {
  const d = asDepartment(value);
  return d ? RECIPE_DEPARTMENT_LABEL[d] : null;
}
