import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecipeSection } from "@/varer/components/recipes/editor/RecipeSections";
import { RecipePartCard, type EditorLine, type EditorPart } from "@/varer/components/recipes/RecipePartCard";
import type { useRecipeEditor } from "@/varer/hooks/useRecipeEditor";
import { entryModeFor } from "@/varer/lib/percentFirst";
import type { BakersRawMaterialMap } from "@/varer/lib/bakersRawMaterials";

type Editor = ReturnType<typeof useRecipeEditor>;

/** «Ingredienser» på fanen Oppskrift — flyttet uendret fra oppskriftssiden. */
export function RecipeIngredientsSection({
  editor,
  parts,
  displayLines,
  editable,
  totalFlourG,
  rmMap,
  recipeId,
  warningsByLine,
  onRemovePart,
}: {
  editor: Editor;
  parts: EditorPart[];
  displayLines: EditorLine[];
  editable: boolean;
  totalFlourG: number;
  rmMap: BakersRawMaterialMap;
  recipeId: string;
  warningsByLine: Record<string, string | undefined>;
  onRemovePart: (part: EditorPart) => void;
}) {
  const { addPart, updatePart, duplicatePart, movePart, addLine, updateLine, removeLine, reorderLines } = editor;
  return (
    <RecipeSection id="seksjon-ingredienser" title="Ingredienser">
      <div className="space-y-3">
        {parts.map((p, i) => (
          <RecipePartCard
            key={p.id}
            part={p}
            lines={displayLines.filter((l) => l.recipe_part_id === p.id)}
            canWrite={editable}
            totalFlourG={totalFlourG}
            rmMap={rmMap}
            currentRecipeId={recipeId}
            isFirst={i === 0}
            isLast={i === parts.length - 1}
            onUpdate={(patch) => updatePart(p.id, patch)}
            onRemove={() => onRemovePart(p)}
            onDuplicate={() => duplicatePart(p.id)}
            onMove={(dir) => movePart(p.id, dir)}
            onAddLine={() => addLine(p.id)}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
            onReorderLines={reorderLines}
            entryMode={entryModeFor(editor.state.entryModes, p.id)}
            onEntryModeChange={(mode) => editor.setEntryMode(p.id, mode)}
            warningsByLine={warningsByLine}
          />
        ))}
        {editable && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => addPart("dough")}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Legg til del
            </Button>
            <Button variant="outline" size="sm" onClick={() => addPart("preferment")}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Legg til fordeig
            </Button>
          </div>
        )}
      </div>
    </RecipeSection>
  );
}
