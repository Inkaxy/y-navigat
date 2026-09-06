import { useEffect, useRef, useState } from "react";
import type { NutritionRow } from "@/ravarer/hooks/useNutrition";

export const EMPTY_NUTRITION: NutritionRow = {
  raw_material_id: "",
  energy_kj: null, energy_kcal: null,
  fat_g: null, saturated_fat_g: null,
  carbs_g: null, sugars_g: null,
  fiber_g: null, protein_g: null, salt_g: null,
  ingredient_declaration: null, country_of_origin: null,
  e_numbers: null, source: null, source_document_url: null,
  verified_at: null, verified_by: null,
};

export function emptyNutritionFor(rawMaterialId: string): NutritionRow {
  return { ...EMPTY_NUTRITION, raw_material_id: rawMaterialId };
}

interface Baseline {
  id: string;
  /** Serverraden slik den så ut sist skjemaet ble hydrert. */
  snapshot: string;
}

export interface NutritionDraftState {
  draft: NutritionRow;
  setDraft: React.Dispatch<React.SetStateAction<NutritionRow>>;
  /** Sann bare når brukeren har endret noe siden siste innlastede snapshot. */
  dirty: boolean;
  /** Sann til første svar fra serveren er hydret inn i skjemaet. */
  hydrated: boolean;
}

/**
 * Holder næringsskjemaet i takt med serveren uten å miste brukerens arbeid.
 *
 * «Endret» måles alltid mot SIST INNLASTEDE snapshot — ikke mot raden som
 * akkurat kom fra serveren. Ellers ville et tomt skjema mot en ny serverrad
 * blitt lest som en brukerendring, og næringsdata aldri kommet inn ved kald
 * åpning der spørringen svarer etter første render.
 */
export function useNutritionDraft(
  rawMaterialId: string,
  existing: NutritionRow | null | undefined,
  isLoaded: boolean,
): NutritionDraftState {
  const [draft, setDraft] = useState<NutritionRow>(() => emptyNutritionFor(rawMaterialId));
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    // Vi hydrerer først når spørringen faktisk har svart.
    if (!isLoaded) return;
    const base = existing ?? emptyNutritionFor(rawMaterialId);
    const snapshot = JSON.stringify(base);

    if (baseline?.id !== rawMaterialId) {
      // Ny råvare: alltid full hydrering.
      setBaseline({ id: rawMaterialId, snapshot });
      setDraft(base);
      return;
    }
    if (baseline.snapshot === snapshot) return;

    const userEdited = JSON.stringify(draftRef.current) !== baseline.snapshot;
    setBaseline({ id: rawMaterialId, snapshot });
    // Har brukeren skrevet noe, beholder vi utkastet ved refetch.
    if (!userEdited) setDraft(base);
  }, [existing, rawMaterialId, isLoaded, baseline]);

  const dirty = baseline != null && JSON.stringify(draft) !== baseline.snapshot;

  return { draft, setDraft, dirty, hydrated: baseline?.id === rawMaterialId };
}
