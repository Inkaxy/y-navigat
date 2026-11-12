import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { showError } from "@/lib/userError";

export interface LabelInfoValues {
  unitWeightGrams: number | null;
  shelfLifeDays: number | null;
  storageInstructions: string | null;
  countryOfOrigin: string | null;
}

export type LabelInfoField = "weight" | "shelf" | "storage" | "origin";
type Form = Record<LabelInfoField, string>;

function toStr(v: number | string | null | undefined): string {
  return v == null ? "" : String(v);
}

/**
 * Etikettopplysningene (nettovekt, holdbarhet, oppbevaring, opprinnelse).
 * Flyttet uendret fra det tidligere «Etikettopplysninger»-kortet: samme
 * felter i samme UPDATE, eksplisitt lagring og vakt mot ulagrede endringer.
 */
export function useLabelInfoForm(recipeId: string, v: LabelInfoValues, canWrite: boolean) {
  const qc = useQueryClient();
  const saved: Form = {
    weight: toStr(v.unitWeightGrams),
    shelf: toStr(v.shelfLifeDays),
    storage: toStr(v.storageInstructions),
    origin: toStr(v.countryOfOrigin),
  };
  const [form, setForm] = useState<Form>(saved);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setForm({
        weight: toStr(v.unitWeightGrams),
        shelf: toStr(v.shelfLifeDays),
        storage: toStr(v.storageInstructions),
        origin: toStr(v.countryOfOrigin),
      });
    }
  }, [v.unitWeightGrams, v.shelfLifeDays, v.storageInstructions, v.countryOfOrigin, touched]);

  const dirty =
    form.weight !== saved.weight ||
    form.shelf !== saved.shelf ||
    form.storage !== saved.storage ||
    form.origin !== saved.origin;

  // Rutevakt mot å miste ulagrede etikettopplysninger (lenkeklikk, tilbake, faneskift).
  const guard = useUnsavedChangesGuard(dirty, () => {
    setForm(saved);
    setTouched(false);
  });

  const save = useMutation({
    mutationFn: async () => {
      const num = (s: string) => {
        const n = Number(s.replace(",", ".").trim());
        return s.trim() === "" || !Number.isFinite(n) ? null : n;
      };
      const { error } = await supabase
        .from("recipes")
        .update({
          unit_weight_grams: num(form.weight),
          shelf_life_days: form.shelf.trim() === "" ? null : Math.round(Number(form.shelf) || 0),
          storage_instructions: form.storage.trim() || null,
          country_of_origin: form.origin.trim() || null,
        } as never)
        .eq("id", recipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      setTouched(false);
      // IKKE «recipe-detail»: den nullstiller oppskriftseditoren og kaster
      // ulagrede linjer. Bare merkedataene trenger å hentes på nytt.
      qc.invalidateQueries({ queryKey: ["recipe-label-calculated", recipeId] });
      toast.success("Etikettopplysninger lagret");
    },
    onError: (e: unknown) => showError("LabelInfoCard", e),
  });

  const set = (k: LabelInfoField, value: string) => {
    setTouched(true);
    setForm((f) => ({ ...f, [k]: value }));
  };
  const reset = () => {
    setForm(saved);
    setTouched(false);
  };

  return { form, set, dirty, save, guard, reset, canEdit: canWrite };
}
