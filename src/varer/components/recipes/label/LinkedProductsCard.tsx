import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Scale } from "lucide-react";
import { fmtPct } from "@/varer/lib/breadscale";
import { grainLevelLabel } from "@/varer/lib/breadscale";
import { grainCategoryFromBreadscaleValue } from "@/varer/lib/brodskalan";
import { useSyncBreadscaleProducts, type RecipeLinkedProduct } from "@/varer/hooks/useRecipeLabel";
import { SalesUnitSettings, type SalesUnitValues } from "@/varer/components/products/SalesUnitSettings";
import { conditionalLinkUpdate, linkBaseFrom, type LinkBase, type LinkWriteResult } from "@/varer/lib/recipeLinkWrite";
import { linkNetWeight } from "@/varer/lib/linkNetWeight";
import type { RecipeBasisInput } from "@/varer/lib/recipeLinkBasis";
import { PRODUCT_RECIPE_LINK_KEY } from "@/varer/hooks/useProductRecipeLink";
import { RECIPE_LINKS_KEY } from "@/varer/hooks/useRecipeProductLinks";
import { logAudit } from "@/varer/lib/audit";
import { formatDateTimeNb } from "./labelShared";

interface Props {
  recipeId: string;
  links: RecipeLinkedProduct[];
  canWrite: boolean;
  /** Oppskriftens utbytte — bare til forslag om nettovekt. */
  basisInput: RecipeBasisInput | null;
}

function declarationModeLabel(mode: string | null): string {
  if (!mode) return "Arvet fra oppskrift";
  if (mode === "manual") return "Overstyrt: Manuell";
  if (mode === "auto_with_overrides") return "Overstyrt: Auto + overstyringer";
  return "Overstyrt: Beregnet";
}

const grams = (n: number) => `${Math.round(n).toLocaleString("nb-NO")} g`;

/** Koblede varer — modus per kobling, nettovekt per salgsenhet og manuell synk. */
export function LinkedProductsCard({ recipeId, links, canWrite, basisInput }: Props) {
  const qc = useQueryClient();
  const syncBreadscale = useSyncBreadscaleProducts();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Synkron lås før await: én lagring av salgsenhet om gangen.
  const lockRef = useRef(false);
  const [saving, setSaving] = useState(false);

  async function syncAll() {
    setBusy(true);
    try {
      await syncBreadscale.mutateAsync(recipeId);
      toast.success("Grovhet synkronisert");
    } catch (e) {
      toast.error(`Grovhetssynk feilet: ${(e as Error).message}`);
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["recipe-linked-products", recipeId] });
  }

  async function invalidateFor(productId: string) {
    await qc.invalidateQueries({ queryKey: ["recipe-linked-products", recipeId] });
    qc.invalidateQueries({ queryKey: RECIPE_LINKS_KEY(recipeId) });
    qc.invalidateQueries({ queryKey: PRODUCT_RECIPE_LINK_KEY(productId) });
    qc.invalidateQueries({ queryKey: ["product-recipe-summary", productId] });
    qc.invalidateQueries({ queryKey: ["product-margins", productId] });
    qc.invalidateQueries({ queryKey: ["product-declaration", productId] });
  }

  /** Samme skrivevei som varekortets «Koblingens innstillinger». */
  async function saveSettings(name: string, frozen: LinkBase, next: SalesUnitValues): Promise<LinkWriteResult> {
    if (lockRef.current) return { kind: "error", code: null, message: "Annen lagring pågår." };
    lockRef.current = true;
    setSaving(true);
    try {
      const res = await conditionalLinkUpdate(frozen, { ...next, sales_unit_confirmed_at: new Date().toISOString() }, frozen.recipeId);
      if (res.kind !== "saved") {
        await invalidateFor(frozen.productId);
        return res;
      }
      try {
        await logAudit({
          action: "update",
          entity_type: "product_recipe_link",
          entity_id: frozen.productId,
          entity_display_reference: name,
          changes: next as unknown as Record<string, unknown>,
        });
      } catch (e) {
        console.warn("[oppskriftskobling] logg feilet", e instanceof Error ? e.name : "ukjent");
        toast.warning("Endringen er lagret, men kunne ikke loggføres.");
      }
      toast.success("Salgsenheten er lagret");
      await invalidateFor(frozen.productId);
      return res;
    } finally {
      lockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">Koblede varer ({links.length})</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Merkingen arves av varene. Nettovekt settes per vare på koblingen, med forslag fra oppskriften.
          </p>
        </div>
        {canWrite && links.length > 0 && (
          <Button variant="outline" className="min-h-11" onClick={syncAll} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            Synk alle nå
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-1">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen varer er koblet til oppskriften. Endringer her oppdaterer derfor ingen varer.</p>
        ) : (
          links.map((l) => {
            const p = l.products;
            const name = p?.display_name ?? "Uten navn";
            const cat = grainCategoryFromBreadscaleValue(p?.breadscale_value);
            const w = linkNetWeight(l, basisInput);
            const base = linkBaseFrom(l.product_id, l as unknown as Record<string, unknown>);
            const open = openId === l.id;
            return (
              <div key={l.id} className="space-y-2 border-b border-border/50 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/varer/vareliste/${l.product_id}?tab=deklarasjon`}
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium hover:underline"
                    >
                      {name}
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </Link>
                  </div>
                  {l.is_primary && <Badge variant="secondary">Primær</Badge>}
                  <Badge variant="outline">{declarationModeLabel(l.declaration_mode)}</Badge>
                  <Badge variant="outline" className="tabular-nums">
                    Grovhet: {p?.breadscale_mode === "manual" ? "Manuell" : "Auto"} · {fmtPct(p?.breadscale_pct ?? null)}
                    {cat ? ` · ${grainLevelLabel(cat)}` : ""}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Scale className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span>
                    Nettovekt:{" "}
                    {w.grams != null ? (
                      <b className="tabular-nums">{grams(w.grams)}</b>
                    ) : (
                      <span className="text-destructive">ikke registrert</span>
                    )}
                    {w.source === "vare" && <span className="text-muted-foreground"> · fra varen, ikke bekreftet på koblingen</span>}
                  </span>
                  {w.confirmedAt ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Bekreftet {formatDateTimeNb(w.confirmedAt)}
                    </span>
                  ) : w.source === "kobling" ? (
                    <span className="text-xs text-warning">Ikke bekreftet</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {w.suggestion ? `Forslag ${grams(w.suggestion.grams)} (${w.suggestion.text}). Lagres ikke før du bekrefter.` : w.note}
                </p>

                <div className="flex flex-wrap gap-2">
                  {canWrite && base ? (
                    <Button type="button" variant="outline" className="min-h-11" aria-expanded={open} onClick={() => setOpenId(open ? null : l.id)}>
                      {open ? "Lukk salgsenhet" : "Sett nettovekt"}
                    </Button>
                  ) : (
                    <Link to={`/varer/vareliste/${l.product_id}?tab=oppskrift`} className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-2">
                      Åpne varens salgsenhet <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
                {open && base && (
                  <SalesUnitSettings
                    base={base}
                    canWrite={canWrite}
                    pending={saving}
                    resetSignal={0}
                    suggestion={w.suggestion}
                    onSave={(frozen, next) => saveSettings(name, frozen, next)}
                  />
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
