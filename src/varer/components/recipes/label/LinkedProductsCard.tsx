import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { fmtPct } from "@/varer/lib/breadscale";
import { grainLevelLabel } from "@/varer/lib/breadscale";
import { grainCategoryFromBreadscaleValue } from "@/varer/lib/brodskalan";
import {
  useSyncBreadscaleProducts,
  type RecipeLinkedProduct,
} from "@/varer/hooks/useRecipeLabel";
import { syncEffectiveDeclaration } from "@/varer/lib/effectiveDeclaration";

interface Props {
  recipeId: string;
  links: RecipeLinkedProduct[];
  canWrite: boolean;
}

function declarationModeLabel(mode: string | null): string {
  if (!mode) return "Arvet fra oppskrift";
  if (mode === "manual") return "Overstyrt: Manuell";
  if (mode === "auto_with_overrides") return "Overstyrt: Auto + overstyringer";
  return "Overstyrt: Beregnet";
}

/** Koblede produkter — modus per kobling og manuell synk. */
export function LinkedProductsCard({ recipeId, links, canWrite }: Props) {
  const qc = useQueryClient();
  const syncBreadscale = useSyncBreadscaleProducts();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function syncAll() {
    setBusy(true);
    const errs: Record<string, string> = {};
    let ok = 0;
    for (const l of links) {
      try {
        await syncEffectiveDeclaration(l.id);
        ok++;
      } catch (e) {
        errs[l.id] = (e as Error).message ?? "Ukjent feil";
      }
    }
    try {
      await syncBreadscale.mutateAsync(recipeId);
    } catch (e) {
      toast.error(`Grovhetssynk feilet: ${(e as Error).message}`);
    }
    setErrors(errs);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["recipe-linked-products", recipeId] });
    if (Object.keys(errs).length === 0) toast.success(`${ok} produkter synkronisert`);
    else toast.error(`${Object.keys(errs).length} produkter feilet — se lista`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Koblede produkter ({links.length})</CardTitle>
        {canWrite && links.length > 0 && (
          <Button variant="outline" size="sm" onClick={syncAll} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            Synk alle nå
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-1">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen produkter er koblet til denne oppskriften ennå.</p>
        ) : (
          links.map((l) => {
            const p = l.products;
            const cat = grainCategoryFromBreadscaleValue(p?.breadscale_value);
            return (
              <div
                key={l.id}
                className="flex flex-wrap items-center gap-2 border-b border-border/50 py-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/varer/vareliste/${l.product_id}?tab=deklarasjon`}
                    className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                  >
                    {p?.display_name ?? "Uten navn"}
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                  {errors[l.id] && <p className="text-xs text-destructive">Synk feilet: {errors[l.id]}</p>}
                </div>
                {l.is_primary && <Badge variant="secondary">Primær</Badge>}
                <Badge variant="outline">{declarationModeLabel(l.declaration_mode)}</Badge>
                <Badge variant="outline" className="tabular-nums">
                  Grovhet: {p?.breadscale_mode === "manual" ? "Manuell" : "Auto"} · {fmtPct(p?.breadscale_pct ?? null)}
                  {cat ? ` · ${grainLevelLabel(cat)}` : ""}
                </Badge>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
