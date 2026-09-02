import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save } from "lucide-react";
import { showError } from "@/lib/userError";

interface Props {
  recipeId: string;
  unitWeightGrams: number | null;
  shelfLifeDays: number | null;
  storageInstructions: string | null;
  countryOfOrigin: string | null;
  canWrite: boolean;
}

function toStr(v: number | string | null | undefined): string {
  return v == null ? "" : String(v);
}

/** Etikettopplysninger — nettovekt, holdbarhet, oppbevaring og opprinnelse. */
export function LabelInfoCard({
  recipeId,
  unitWeightGrams,
  shelfLifeDays,
  storageInstructions,
  countryOfOrigin,
  canWrite,
}: Props) {
  const qc = useQueryClient();
  const saved = {
    weight: toStr(unitWeightGrams),
    shelf: toStr(shelfLifeDays),
    storage: toStr(storageInstructions),
    origin: toStr(countryOfOrigin),
  };
  const [form, setForm] = useState(saved);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setForm({
        weight: toStr(unitWeightGrams),
        shelf: toStr(shelfLifeDays),
        storage: toStr(storageInstructions),
        origin: toStr(countryOfOrigin),
      });
    }
  }, [unitWeightGrams, shelfLifeDays, storageInstructions, countryOfOrigin, touched]);

  const dirty =
    form.weight !== saved.weight ||
    form.shelf !== saved.shelf ||
    form.storage !== saved.storage ||
    form.origin !== saved.origin;

  const save = useMutation({
    mutationFn: async () => {
      const num = (v: string) => {
        const n = Number(v.replace(",", ".").trim());
        return v.trim() === "" || !Number.isFinite(n) ? null : n;
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
      qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
      toast.success("Etikettopplysninger lagret");
    },
    onError: (e: unknown) => showError("LabelInfoCard", e),
  });

  const set = (k: keyof typeof form, v: string) => {
    setTouched(true);
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Etikettopplysninger</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Nettovekt per enhet (g)</Label>
            <Input
              inputMode="decimal"
              value={form.weight}
              disabled={!canWrite}
              onChange={(e) => set("weight", e.target.value)}
              className="text-right tabular-nums"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Brukes til «per porsjon»-kolonnen i næringstabellen og nettovekten på etiketten.
            </p>
          </div>
          <div>
            <Label className="text-xs">Holdbarhet (dager)</Label>
            <Input
              inputMode="numeric"
              value={form.shelf}
              disabled={!canWrite}
              onChange={(e) => set("shelf", e.target.value)}
              className="text-right tabular-nums"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Gir «Best før»-teksten: antall dager fra produksjonsdato.
            </p>
          </div>
          <div>
            <Label className="text-xs">Oppbevaring</Label>
            <Textarea
              rows={2}
              value={form.storage}
              disabled={!canWrite}
              onChange={(e) => set("storage", e.target.value)}
              placeholder="Oppbevares tørt og romtemperert"
            />
            <p className="mt-1 text-xs text-muted-foreground">Trykkes som oppbevaringsanvisning på etiketten.</p>
          </div>
          <div>
            <Label className="text-xs">Opprinnelsesland</Label>
            <Input
              value={form.origin}
              disabled={!canWrite}
              onChange={(e) => set("origin", e.target.value)}
              placeholder="Norge"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Opprinnelse for produktet — kreves når merking ellers kan villede forbrukeren.
            </p>
          </div>
        </div>

        {canWrite && (
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Lagre etikettopplysninger
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
