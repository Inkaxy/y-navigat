import { supabase } from "@/integrations/supabase/client";

export type LabelNumberImage = {
  label_unit_id?: string | null;
  label_number?: string | null;
};

export type LabelNumberByUnit = Record<string, string>;

/** Etikett-enheten er fasit; kopifeltet på kakebildet er kun fallback. */
export function resolveLabelNumber(
  image: LabelNumberImage,
  numberByUnit: LabelNumberByUnit = {},
): string | null {
  if (image.label_unit_id) {
    const number = numberByUnit[image.label_unit_id];
    if (number) return number;
  }
  return image.label_number?.trim() || null;
}

/** Henter numre for alle kakebilder i én spørring. */
export async function fetchLabelNumbersByUnit(
  images: LabelNumberImage[],
): Promise<LabelNumberByUnit> {
  const ids = Array.from(
    new Set(images.map((image) => image.label_unit_id).filter(Boolean) as string[]),
  );
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from("label_units")
    .select("id, number")
    .in("id", ids);
  if (error) throw error;

  return Object.fromEntries(
    (data ?? []).map((unit) => [String(unit.id), String(unit.number)]),
  );
}

export async function withResolvedLabelNumbers<T extends LabelNumberImage>(
  images: T[],
): Promise<Array<T & { resolved_label_number: string | null }>> {
  const numberByUnit = await fetchLabelNumbersByUnit(images);
  return images.map((image) => ({
    ...image,
    resolved_label_number: resolveLabelNumber(image, numberByUnit),
  }));
}