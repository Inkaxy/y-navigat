import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RecipeSection } from "@/varer/components/recipes/editor/RecipeSections";
import { DoughTempPanel } from "@/varer/components/recipes/DoughTempPanel";
import { StepTimeline } from "@/varer/components/recipes/StepTimeline";
import { RecipeStepsEditor, type EditorStep } from "@/varer/components/recipes/RecipeStepsEditor";
import { RecipeImageUpload } from "@/varer/components/recipes/RecipeImageUpload";
import type { HeaderState, RecipeEditorState } from "@/varer/hooks/useRecipeEditor";

/**
 * Fanen «Fremgangsmåte»: steg øverst, deretter tidslinje, deigtemperatur,
 * notater, dekor og bilde. Innholdet og skriveveiene er flyttet uendret.
 */
export function RecipeProcessTab({
  recipeId,
  legalEntityId,
  header,
  patchHeader,
  steps,
  onStepsChange,
  editable,
  canWrite,
  temps,
  prefermentTemp,
  prefermentGrams,
  totalDoughG,
  imageUrl,
  onImageChange,
}: {
  recipeId: string;
  legalEntityId: string | null;
  header: RecipeEditorState["header"];
  patchHeader: (patch: Partial<HeaderState>) => void;
  steps: EditorStep[];
  onStepsChange: (steps: EditorStep[]) => void;
  editable: boolean;
  canWrite: boolean;
  temps: {
    roomTemp: number;
    flourTemp: number;
    onRoomTempChange: (v: number) => void;
    onFlourTempChange: (v: number) => void;
  };
  prefermentTemp: number | null;
  prefermentGrams: number;
  totalDoughG: number;
  imageUrl: string | null;
  onImageChange: (url: string | null) => void;
}) {
  return (
    <div className="space-y-6">
      <RecipeSection id="seksjon-prosess" title="Prosess">
        <RecipeStepsEditor steps={steps} canWrite={editable} onChange={onStepsChange} />

        <StepTimeline
          steps={steps}
          header={{
            autolyse_minutes: header.autolyse_minutes ?? null,
            mixing_speed1_minutes: header.mixing_speed1_minutes ?? null,
            mixing_speed2_minutes: header.mixing_speed2_minutes ?? null,
          }}
        />

        <DoughTempPanel
          roomTemp={temps.roomTemp}
          flourTemp={temps.flourTemp}
          onRoomTempChange={temps.onRoomTempChange}
          onFlourTempChange={temps.onFlourTempChange}
          onPrefermentTempChange={(v) => patchHeader({ preferment_temp_celsius: v })}
          targetDoughTemp={header.target_dough_temp_celsius ?? null}
          frictionFactor={header.friction_factor_celsius ?? null}
          prefermentTemp={prefermentTemp}
          prefermentGrams={prefermentGrams}
          totalDoughG={totalDoughG}
          canWrite={canWrite}
          onChange={patchHeader}
        />
      </RecipeSection>

      <RecipeSection id="seksjon-notater" title="Notater og ferdiggjøring">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Notater</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={3}
              aria-label="Notater"
              value={header.notes ?? ""}
              disabled={!editable}
              onChange={(e) => patchHeader({ notes: e.target.value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Dekor / ferdiggjøring</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={3}
              aria-label="Dekor / ferdiggjøring"
              value={header.decor_notes ?? ""}
              disabled={!editable}
              placeholder="Pynt, glasur, strø, ferdiggjøring…"
              onChange={(e) => patchHeader({ decor_notes: e.target.value })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Bilde</CardTitle></CardHeader>
          <CardContent>
            <RecipeImageUpload
              recipeId={recipeId}
              legalEntityId={legalEntityId}
              imageUrl={imageUrl}
              canWrite={canWrite}
              onChange={onImageChange}
            />
          </CardContent>
        </Card>
      </RecipeSection>
    </div>
  );
}
