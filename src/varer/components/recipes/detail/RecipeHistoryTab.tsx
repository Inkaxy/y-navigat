import { Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryState } from "@/components/common/QueryState";
import { RecipeSection } from "@/varer/components/recipes/editor/RecipeSections";
import { useRecipeDeclarationVersions } from "@/varer/hooks/useLabelApproval";
import type { RecipeVersionRow } from "@/varer/lib/recipeVersions";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("nb-NO");

/**
 * Fanen «Historikk»: oppskriftsversjoner med «Gjenopprett» (uendret logikk),
 * godkjente deklarasjonsversjoner (bare lesing) og inngang til deling.
 */
export function RecipeHistoryTab({
  recipeId,
  versions,
  canWrite,
  restoringVersion,
  onRestore,
  onShare,
}: {
  recipeId: string;
  versions: { data: RecipeVersionRow[] | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  canWrite: boolean;
  restoringVersion: number | null;
  onRestore: (row: RecipeVersionRow) => void;
  onShare: () => void;
}) {
  const declarations = useRecipeDeclarationVersions(recipeId);

  return (
    <div className="space-y-6">
      <RecipeSection
        id="seksjon-historikk"
        title="Historikk"
        actions={
          <Button variant="outline" className="min-h-[44px]" onClick={onShare}>
            <Share2 className="mr-1.5 h-4 w-4" /> Del oppskriften
          </Button>
        }
      >
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Versjonshistorikk</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <QueryState
              scope="oppskrift:versjoner"
              isLoading={versions.isLoading}
              isError={versions.isError}
              error={versions.error}
              onRetry={versions.refetch}
              isEmpty={(versions.data ?? []).length === 0}
              emptyTitle="Ingen tidligere versjoner ennå."
              errorTitle="Kunne ikke hente versjonene"
              skeletonRows={2}
              compact
            >
              {(versions.data ?? []).map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">v{v.version}</span>{" "}
                    <span className="text-muted-foreground">{fmtTime(v.changed_at)}</span>
                    {v.change_summary && <div className="text-muted-foreground">{v.change_summary}</div>}
                  </div>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      disabled={restoringVersion !== null}
                      onClick={() => onRestore(v)}
                    >
                      {restoringVersion === v.version ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      Gjenopprett
                    </Button>
                  )}
                </div>
              ))}
            </QueryState>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Godkjente deklarasjoner</CardTitle>
            <p className="text-caption text-muted-foreground">
              Bare visning. Godkjenning og gjenoppretting av deklarasjon gjøres under Merking.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <QueryState
              scope="oppskrift:deklarasjonsversjoner"
              isLoading={declarations.isLoading}
              isError={declarations.isError}
              error={declarations.error}
              onRetry={() => void declarations.refetch()}
              isEmpty={(declarations.data ?? []).length === 0}
              emptyTitle="Ingen deklarasjon er godkjent ennå."
              errorTitle="Kunne ikke hente godkjente deklarasjoner"
              skeletonRows={2}
              compact
            >
              {(declarations.data ?? []).map((d, i) => (
                <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-medium">Versjon {d.version}</span>
                  {i === 0 && <Badge variant="outline" className="border-app/50 text-app">Gjeldende</Badge>}
                  <Badge variant="outline">{d.source === "manual" ? "Manuell" : "Beregnet"}</Badge>
                  <span className="text-muted-foreground">Godkjent {fmtTime(d.approved_at)}</span>
                  {d.restored_from_version_id && <span className="text-caption text-muted-foreground">Gjenopprettet fra tidligere versjon</span>}
                </div>
              ))}
            </QueryState>
          </CardContent>
        </Card>
      </RecipeSection>
    </div>
  );
}
