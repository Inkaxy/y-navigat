import { Link } from "react-router-dom";
import { Link2, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { computeTotalsForRecipe, fmtG, fmtPercent, RECIPE_STATUS_LABEL } from "@/varer/lib/bakers";
import { BASE_RECIPE_CATEGORY } from "@/varer/lib/halvfabrikat";
import { asDepartment, RECIPE_DEPARTMENT_BADGE, RECIPE_DEPARTMENT_LABEL } from "@/varer/lib/departments";
import type { LabelingStatus } from "@/varer/lib/labelStaleness";
import { LabelingBadge } from "@/varer/components/lists/LabelingBadge";
import { RecipeRowMenu } from "@/varer/components/recipes/list/RecipeRowMenu";

/** Minimum av oppskriftsraden kortet trenger. */
type RecipeCardData = {
  id: string;
  name: string | null;
  image_url: string | null;
  category: string | null;
  status: string | null;
  department: string | null;
  version: number | null;
  products: string[];
  labeling: LabelingStatus;
  totals: ReturnType<typeof computeTotalsForRecipe>;
};

/**
 * Kompakt kort for en oppskrift på smal skjerm. Navnet er en ekte lenke som
 * dekker hele kortet (Cmd/Ctrl-klikk og ny fane virker); menyen ligger over.
 */
export function RecipeListCard({
  recipe, href, shareCount, canWrite, copyingId, onCopy, onDelete,
}: {
  recipe: RecipeCardData;
  href: string;
  shareCount: number;
  canWrite: boolean;
  copyingId: string | null;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const department = asDepartment(recipe.department);
  const name = recipe.name || "Uten navn";
  return (
    <div className="relative flex gap-3 p-4 transition-colors focus-within:bg-muted/40 hover:bg-muted/30">
      {recipe.image_url ? (
        <img src={recipe.image_url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Wheat className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={href}
            data-focus-id={recipe.id}
            className="truncate font-medium text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {name}
          </Link>
          {shareCount > 0 && (
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] font-normal" title="Aktive delingslenker">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {shareCount}
            </Badge>
          )}
        </div>
        <div className="text-caption text-muted-foreground">
          v{recipe.version}
          {recipe.products.length > 0 && ` · ${recipe.products.slice(0, 2).join(", ")}${recipe.products.length > 2 ? ` +${recipe.products.length - 2}` : ""}`}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {recipe.category === BASE_RECIPE_CATEGORY ? (
            <Badge variant="outline" className="gap-1 border-app/50 text-app">
              <Wheat className="h-3.5 w-3.5" aria-hidden="true" /> Grunnoppskrift
            </Badge>
          ) : recipe.category ? (
            <Badge variant="outline" className="font-normal">{recipe.category}</Badge>
          ) : null}
          {department && (
            <Badge variant="outline" className={`font-normal ${RECIPE_DEPARTMENT_BADGE[department]}`}>
              {RECIPE_DEPARTMENT_LABEL[department]}
            </Badge>
          )}
          <Badge variant="outline">{RECIPE_STATUS_LABEL[recipe.status ?? "draft"] ?? recipe.status}</Badge>
          <LabelingBadge status={recipe.labeling} withPrefix />
        </div>

        <div className="mt-1.5 flex gap-4 text-caption text-muted-foreground tabular-nums">
          <span>Hydrering: {fmtPercent(recipe.totals.hydrationPct)}</span>
          <span>Deigvekt: {fmtG(recipe.totals.totalDoughG)} g</span>
        </div>
      </div>

      {canWrite && (
        <RecipeRowMenu name={name} copying={copyingId === recipe.id} onCopy={onCopy} onDelete={onDelete} />
      )}
    </div>
  );
}
