import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Feltene brukeren faktisk redigerer i skjemaet. Alt annet på raden
 * (`verified_at`, `verified_by`, `updated_at`, `matvaretabellen_food_id` …) er
 * servermetadata: det skal aldri i seg selv gjøre skjemaet «endret», og det
 * skal aldri hindre at en vellykket lagring blir ren igjen.
 */
export const EDITABLE_NUTRITION_FIELDS = [
  "energy_kj",
  "energy_kcal",
  "fat_g",
  "saturated_fat_g",
  "carbs_g",
  "sugars_g",
  "fiber_g",
  "protein_g",
  "salt_g",
  "ingredient_declaration",
  "country_of_origin",
  "e_numbers",
  "source",
] as const;

export type EditableNutritionField = (typeof EDITABLE_NUTRITION_FIELDS)[number];

type PartialRow = Partial<NutritionRow> | null | undefined;

function fieldValue(row: PartialRow, field: EditableNutritionField): unknown {
  const v = row?.[field];
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.join("\u0000");
  return v;
}

function sameField(a: PartialRow, b: PartialRow, field: EditableNutritionField): boolean {
  return Object.is(fieldValue(a, field), fieldValue(b, field));
}

/** Sammenligner BARE de redigerbare feltene på to rader. */
export function sameEditableNutrition(a: PartialRow, b: PartialRow): boolean {
  return EDITABLE_NUTRITION_FIELDS.every((f) => sameField(a, b, f));
}

interface Baseline {
  id: string;
  /** Raden slik den sist ble bekreftet fra serveren. */
  row: NutritionRow;
  /** Referansen til serversvaret baseline kom fra (null = ingen rad ennå). */
  src: NutritionRow | null;
  /**
   * Raden som ble erstattet av en bekreftet lagring. Et forsinket svar med
   * akkurat disse verdiene er gammelt nytt og skal ikke rulle skjemaet tilbake.
   */
  superseded?: NutritionRow | null;
}

export interface NutritionDraftState {
  draft: NutritionRow;
  setDraft: React.Dispatch<React.SetStateAction<NutritionRow>>;
  /** Sann bare når brukeren har endret et redigerbart felt siden siste serverbekreftelse. */
  dirty: boolean;
  /** Sann til første svar fra serveren er hydret inn i skjemaet. */
  hydrated: boolean;
  /**
   * Kalles med raden serveren bekreftet, og utkastet slik det så ut da
   * lagringen startet. Uten dette ville en lagring som endrer `source`
   * (Matvaretabellen → manuell) eller `updated_at` blitt lest som en ny
   * brukerendring, og skjemaet stått som «ulagret» selv om alt gikk bra.
   */
  markSaved: (saved: NutritionRow, sentDraft: NutritionRow) => void;
}

/**
 * Holder næringsskjemaet i takt med serveren uten å miste brukerens arbeid.
 *
 * «Endret» måles alltid mot SIST BEKREFTEDE serverrad — og bare på de
 * redigerbare feltene.
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
  const idRef = useRef(rawMaterialId);
  idRef.current = rawMaterialId;

  useEffect(() => {
    // Vi hydrerer først når spørringen faktisk har svart.
    if (!isLoaded) return;
    const base = existing ?? emptyNutritionFor(rawMaterialId);

    const src = existing ?? null;
    if (baseline?.id !== rawMaterialId) {
      // Ny råvare: alltid full hydrering.
      setBaseline({ id: rawMaterialId, row: base, src });
      setDraft(base);
      return;
    }
    // Samme serversvar som sist — ingenting å gjøre. (Uten denne ville en ny,
    // tom rad blitt laget på hver render og satt tilstand i det uendelige.)
    if (baseline.src === src) return;
    if (
      baseline.superseded &&
      sameEditableNutrition(base, baseline.superseded) &&
      !sameEditableNutrition(base, baseline.row)
    ) {
      return;
    }

    const onlyMetadata = sameEditableNutrition(baseline.row, base);
    const userEdited = !sameEditableNutrition(draftRef.current, baseline.row);
    setBaseline({ id: rawMaterialId, row: base, src });
    // Bare nye VERDIER fra serveren skal skrive over et urørt skjema —
    // et nytt tidsstempel alene rører ingenting.
    if (!onlyMetadata && !userEdited) setDraft(base);
  }, [existing, rawMaterialId, isLoaded, baseline]);

  const markSaved = useCallback((saved: NutritionRow, sentDraft: NutritionRow) => {
    // Byttet brukeren råvare mens lagringen sto på, skal den gamle raden aldri
    // hydreres inn i det nye skjemaet.
    if (!saved || saved.raw_material_id !== idRef.current) return;
    const current = draftRef.current;
    const merged: NutritionRow = { ...saved };
    for (const f of EDITABLE_NUTRITION_FIELDS) {
      // Skrev brukeren noe nytt MENS lagringen pågikk, beholdes det.
      if (!sameField(current, sentDraft, f)) {
        (merged as unknown as Record<string, unknown>)[f] = current[f] ?? null;
      }
    }
    setBaseline((prev) => ({
      id: idRef.current,
      row: saved,
      src: saved,
      superseded: prev?.row ?? null,
    }));
    setDraft(merged);
  }, []);

  const dirty = baseline != null && !sameEditableNutrition(draft, baseline.row);

  return { draft, setDraft, dirty, hydrated: baseline?.id === rawMaterialId, markSaved };
}
