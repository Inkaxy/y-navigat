import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Printer } from "lucide-react";
import { useLabelMarks } from "@/varer/hooks/useLabelMarks";
import { useComputeRecipeLabel, useRecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import {
  GRAIN_MARK_KEY,
  fmtNum,
  grainCategoryFromPct,
  type FlourLine,
  type GrainCategory,
} from "@/varer/lib/breadscale";
import { CoverageSection } from "./CoverageSection";
import { DeclarationSection } from "./DeclarationSection";
import { NutritionSection } from "./NutritionSection";
import { GrainScaleSection } from "./GrainScaleSection";
import { KeyholeSection, type KeyholeResult } from "./KeyholeSection";
import { LABEL_SIZES, type LabelSizeKey } from "../ConsumerLabelPDFDocument";

interface Props {
  recipeId: string;
  recipeName: string;
  recipe: any;
  flourLines: FlourLine[];
  legalEntityId: string | undefined;
  canWrite: boolean;
}

const NUT_ROWS: Array<{ key: string; label: string; unit: string; d: number; indent?: boolean }> = [
  { key: "energy_kj", label: "Energi", unit: "kJ", d: 0 },
  { key: "energy_kcal", label: "Energi", unit: "kcal", d: 0 },
  { key: "fat_g", label: "Fett", unit: "g", d: 1 },
  { key: "saturated_fat_g", label: "hvorav mettede fettsyrer", unit: "g", d: 1, indent: true },
  { key: "carbs_g", label: "Karbohydrater", unit: "g", d: 1 },
  { key: "sugars_g", label: "hvorav sukkerarter", unit: "g", d: 1, indent: true },
  { key: "fiber_g", label: "Kostfiber", unit: "g", d: 1 },
  { key: "protein_g", label: "Protein", unit: "g", d: 1 },
  { key: "salt_g", label: "Salt", unit: "g", d: 2 },
];

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Merking — kan vi trykke dette på posen, og hvis ikke, hva må endres? */
export function LabelTab({ recipeId, recipeName, recipe, flourLines, legalEntityId, canWrite }: Props) {
  const qc = useQueryClient();
  const labelQuery = useRecipeLabelCalculated(recipeId);
  const compute = useComputeRecipeLabel();
  const marksQuery = useLabelMarks(legalEntityId);
  const [size, setSize] = useState<LabelSizeKey>("100x70");
  const [printing, setPrinting] = useState(false);

  const entityQuery = useQuery({
    queryKey: ["legal-entity-label", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data } = await supabase
        .from("legal_entities")
        .select("name, address_line1, postal_code, city")
        .eq("id", legalEntityId!)
        .maybeSingle();
      return data as any;
    },
  });

  const saveClaim = useMutation({
    mutationFn: async (input: { field: "label_claim_keyhole" | "label_claim_grain"; value: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      const patch: Record<string, unknown> = { [input.field]: input.value };
      if (input.value) {
        patch.label_claims_approved_by = u.user?.id ?? null;
        patch.label_claims_approved_at = new Date().toISOString();
      }
      const { error } = await supabase.from("recipes").update(patch as never).eq("id", recipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
      toast.success("Merkevalget er lagret");
    },
    onError: (e: any) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

  const label = labelQuery.data;
  const coveragePct = label?.coverage_by_weight_pct ?? null;
  const coverageOk = (coveragePct ?? 0) >= 90;
  const missing = (label?.missing_data?.nutrition ?? []) as any[];
  const keyhole = (label?.keyhole ?? null) as KeyholeResult | null;
  const grainCategory: GrainCategory | null =
    (label?.grain_category as GrainCategory | null) ??
    (label?.grain_score_pct != null ? grainCategoryFromPct(label.grain_score_pct) : null);

  const recompute = () =>
    compute.mutate(recipeId, { onSuccess: () => toast.success("Merkedata beregnet på nytt") });

  const nutritionRows = useMemo(
    () =>
      NUT_ROWS.map((r) => ({
        label: r.indent ? `— ${r.label}` : r.label,
        value:
          label?.nutrition_per_100g?.[r.key] == null
            ? "—"
            : `${fmtNum(label!.nutrition_per_100g![r.key], r.d)} ${r.unit}`,
        indent: r.indent,
      })),
    [label],
  );

  async function printLabel() {
    if (!label) return;
    setPrinting(true);
    try {
      const grainMark =
        recipe.label_claim_grain && grainCategory
          ? marksQuery.data?.find((m) => m.mark_key === GRAIN_MARK_KEY[grainCategory])
          : undefined;
      const grainMarkImage = grainMark?.signedUrl ? await toDataUrl(grainMark.signedUrl) : null;
      const entity = entityQuery.data;

      const [{ pdf }, mod] = await Promise.all([
        import("@react-pdf/renderer"),
        import("../ConsumerLabelPDFDocument"),
      ]);
      const blob = await pdf(
        <mod.ConsumerLabelPDFDocument
          size={size}
          data={{
            productName: recipeName,
            ingredientText: (label.ingredient_declaration ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
            allergenTerms: label.allergens?.contains ?? [],
            netWeightText: recipe.unit_weight_grams ? `${Math.round(recipe.unit_weight_grams)} g` : null,
            shelfLifeText: recipe.shelf_life_days
              ? `Best før: ${recipe.shelf_life_days} dager fra produksjonsdato`
              : null,
            storageText: recipe.storage_instructions ?? null,
            originText: recipe.country_of_origin ?? null,
            nutritionRows,
            nutritionUsable: coverageOk,
            producerName: entity?.name ?? null,
            producerAddress: entity
              ? [entity.address_line1, [entity.postal_code, entity.city].filter(Boolean).join(" ")]
                  .filter(Boolean)
                  .join(", ")
              : null,
            grainMarkImage,
            grainMarkFallbackText:
              recipe.label_claim_grain && !grainMarkImage && grainCategory
                ? `Brødskala'n: ${grainCategory.replace("_", " ")}`
                : null,
            keyholeMark: !!recipe.label_claim_keyhole,
          }}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke lage etiketten");
    } finally {
      setPrinting(false);
    }
  }

  if (labelQuery.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!label) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">Merkedata er ikke beregnet for denne oppskriften ennå.</p>
          <Button onClick={recompute} disabled={compute.isPending}>
            {compute.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Beregn merkedata
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <CoverageSection
        coveragePct={coveragePct}
        missing={missing}
        onRecalculate={recompute}
        recalculating={compute.isPending}
        canWrite={canWrite}
      />

      <DeclarationSection
        declarationHtml={label.ingredient_declaration}
        allergens={label.allergens}
        unlinkedCount={label.missing_data?.lines_without_raw_material ?? 0}
        unclassifiedNames={label.missing_data?.unclassified_grain_names ?? []}
      />

      <NutritionSection
        per100g={label.nutrition_per_100g}
        unitWeightGrams={recipe.unit_weight_grams ?? null}
        coverageOk={coverageOk}
      />

      <GrainScaleSection
        grainPct={label.grain_score_pct}
        grainCategory={label.grain_category}
        flourGrams={label.flour_grams}
        coarseWeightedGrams={label.whole_grain_grams}
        flourLines={flourLines}
        marks={marksQuery.data ?? []}
      />

      <KeyholeSection
        keyhole={keyhole}
        coverageOk={coverageOk}
        claimKeyhole={!!recipe.label_claim_keyhole}
        claimGrain={!!recipe.label_claim_grain}
        approvedBy={recipe.label_claims_approved_by ?? null}
        approvedAt={recipe.label_claims_approved_at ?? null}
        canWrite={canWrite}
        saving={saveClaim.isPending}
        onToggleClaim={(field, value) => saveClaim.mutate({ field, value })}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Forbrukeretikett</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Etikettstørrelse</Label>
            <select
              className="h-10 w-56 rounded-md border border-input bg-background px-3 text-sm"
              value={size}
              onChange={(e) => setSize(e.target.value as LabelSizeKey)}
            >
              {Object.entries(LABEL_SIZES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <Button onClick={printLabel} disabled={printing}>
            {printing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Skriv ut etikett
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            Ingredienslisten settes aldri mindre enn 1,2 mm x-høyde — det er minstekravet i regelverket. Får ikke
            teksten plass på valgt størrelse, velg et større format i stedet for å krympe skriften.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
