import type { useLabelTabData } from "@/varer/hooks/useLabelTabData";
import { ApproveDeclarationDialog } from "./ApproveDeclarationDialog";
import type { LabelSource } from "./labelShared";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipeId: string;
  candidate: LabelSource;
  manualDirty: boolean;
  data: ReturnType<typeof useLabelTabData>;
}

/** Godkjenning av deklarasjonen — eneste vei til ny godkjent versjon (`useApproveDeclaration`). */
export function LabelApproveHost({ open, onOpenChange, recipeId, candidate, manualDirty, data }: Props) {
  const { approve, approveIssues, latestVersion, links, label, manualSource } = data;
  const recipe = data.recipeClaims;
  return (
    <ApproveDeclarationDialog
      open={open}
      onOpenChange={onOpenChange}
      currentMode={candidate}
      issues={approveIssues}
      manualDirty={manualDirty}
      previous={
        latestVersion
          ? {
              version: latestVersion.version,
              approvedAt: latestVersion.approved_at,
              source: latestVersion.source,
              doc: {
                ingredientText: latestVersion.ingredient_text,
                contains: latestVersion.allergens_contains ?? [],
                mayContain: latestVersion.allergens_may_contain ?? [],
                nutrition: (latestVersion.nutrition_per_100g ?? null) as Record<string, number | null> | null,
              },
            }
          : null
      }
      affected={links.map((l) => ({
        id: l.product_id,
        name: l.products?.display_name ?? "Uten navn",
        number: l.products?.display_number ?? null,
      }))}
      saving={approve.isPending}
      calculated={{
        ingredientText: label?.ingredient_declaration ?? null,
        contains: label?.allergens?.contains ?? [],
        mayContain: label?.allergens?.may_contain ?? [],
        nutrition: (label?.nutrition_per_100g ?? null) as Record<string, number | null> | null,
      }}
      manual={manualSource}
      onApprove={(mode, adopt) =>
        approve.mutate(
          {
            recipeId,
            source: mode === "manual" ? "manual" : "calculated",
            claims: { grain: recipe.grain, keyhole: recipe.keyhole },
            overrides: adopt
              ? {
                  ingredient_text: adopt.ingredientText,
                  allergens_contains: adopt.contains,
                  allergens_may_contain: adopt.mayContain,
                  nutrition_per_100g: adopt.nutrition,
                }
              : {},
          },
          { onSuccess: () => onOpenChange(false) },
        )
      }
    />
  );
}
