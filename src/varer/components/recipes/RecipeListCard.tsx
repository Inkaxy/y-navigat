import { Loader2, Link2, Copy, MoreHorizontal, Trash2, Wheat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { computeTotalsForRecipe, fmtG, fmtPercent, RECIPE_STATUS_LABEL } from "@/varer/lib/bakers";
import { BASE_RECIPE_CATEGORY } from "@/varer/lib/halvfabrikat";
import { asDepartment, RECIPE_DEPARTMENT_BADGE, RECIPE_DEPARTMENT_LABEL } from "@/varer/lib/departments";

/** Minimum av oppskriftsraden kortet trenger — matcher `RecipeRow` i Recipes.tsx. */
type RecipeCardData = {
  id: string;
  name: string | null;
  image_url: string | null;
  category: string | null;
  status: string | null;
  department: string | null;
  version: number | null;
  products: string[];
  totals: ReturnType<typeof computeTotalsForRecipe>;
};

/** Mobilkort for en oppskriftsrad — vises i stedet for tabellrad under `sm`. */
export function RecipeListCard({
  recipe, shareCount, canWrite, copyingId, onOpen, onCopy, onDelete,
}: {
  recipe: RecipeCardData;
  shareCount: number;
  canWrite: boolean;
  copyingId: string | null;
  onOpen: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const department = asDepartment(recipe.department);
  return (
    <div className="flex gap-3 p-4" onClick={onOpen} role="button" tabIndex={0}>
      {recipe.image_url ? (
        <img
          src={recipe.image_url}
          alt={recipe.name || "Oppskrift"}
          className="h-12 w-12 shrink-0 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Wheat className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{recipe.name || "Uten navn"}</span>
          {shareCount > 0 && (
            <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] font-normal">
              <Link2 className="h-3 w-3" />
              {shareCount}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">v{recipe.version}</div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {recipe.category === BASE_RECIPE_CATEGORY ? (
            <Badge variant="outline" className="gap-1 border-app/50 text-app">
              <Wheat className="h-3.5 w-3.5" /> Grunnoppskrift
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
        </div>

        <div className="mt-1.5 flex gap-4 text-xs text-muted-foreground">
          <span>Hydrering: {fmtPercent(recipe.totals.hydrationPct)}</span>
          <span>Deigvekt: {fmtG(recipe.totals.totalDoughG)} g</span>
        </div>
      </div>

      {canWrite && (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Handlinger">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={copyingId === recipe.id} onSelect={onCopy}>
                {copyingId === recipe.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Lag kopi
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Slett
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
