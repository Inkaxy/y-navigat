import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, AlertTriangle, Save, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/userError";
import { parseNum } from "@/varer/lib/calcFormat";
import { formatNumber } from "@/ravarer/lib/constants";
import { GRAIN_LEVELS, grainCategoryFromPct } from "@/varer/lib/breadscale";

/**
 * Trinn 1–4 utledes av de offisielle grensene i `GRAIN_LEVELS`
 * (fint <26, halvgrovt 26–50,9, grovt 51–75,9, ekstra grovt ≥76) — samme som
 * DB-funksjonen `breadscale_step`. Ingen egen kopi av tersklene her.
 */
const STEP_LABELS: Record<number, string> = Object.fromEntries(
  GRAIN_LEVELS.map((l, i) => [i + 1, l.label]),
) as Record<number, string>;

function stepFromPct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const cat = grainCategoryFromPct(Number(pct));
  const idx = GRAIN_LEVELS.findIndex((l) => l.key === cat);
  return idx < 0 ? null : idx + 1;
}

function describe(pct: number | null | undefined): string {
  const step = stepFromPct(pct);
  if (step == null) return "—";
  return `${formatNumber(Number(pct), 1)} % · Trinn ${step} ${STEP_LABELS[step]}`;
}

interface Props {
  productId: string;
  canWrite: boolean;
}

/** Grovhet (Brødskala'n) — manuell verdi vs. NBhub-beregning, med bryter for hva som følger varen. */
export function BreadscaleSection({ productId, canWrite }: Props) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [auto, setAuto] = useState(false);

  const productQuery = useQuery({
    queryKey: ["product-breadscale", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, breadscale_mode, breadscale_manual_value, breadscale_pct, breadscale_value")
        .eq("id", productId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const calcQuery = useQuery({
    queryKey: ["product-breadscale-calculated", productId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("product_breadscale_calculated", {
        p_product_id: productId,
      });
      if (error) throw error;
      return data == null ? null : Number(data);
    },
  });

  const recipeQuery = useQuery({
    queryKey: ["product-primary-recipe", productId],
    queryFn: async () => {
      const { data } = await supabase
        .from("product_recipe_links")
        .select("recipe_id, recipes(name, breadscale_mode)")
        .eq("product_id", productId)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const product = productQuery.data;
  const recipeLink = recipeQuery.data as
    | { recipe_id: string | null; recipes?: { name?: string | null; breadscale_mode?: string | null } | null }
    | null
    | undefined;
  const recipeId = recipeLink?.recipe_id ?? null;
  const recipeName = recipeLink?.recipes?.name ?? null;
  const recipeMode = recipeLink?.recipes?.breadscale_mode === "manual" ? "manual" : "auto";

  useEffect(() => {
    if (!product) return;
    setAuto(product.breadscale_mode === "auto");
    setManualInput(
      product.breadscale_manual_value != null
        ? String(product.breadscale_manual_value).replace(".", ",")
        : "",
    );
  }, [product]);

  const manualPct = parseNum(manualInput);
  const calcPct = calcQuery.data ?? null;
  const manualStep = stepFromPct(manualPct);
  const calcStep = stepFromPct(calcPct);

  const effectivePct = product?.breadscale_pct ?? null;
  const effectiveStep = product?.breadscale_value ?? stepFromPct(effectivePct);
  const savedMode = product?.breadscale_mode ?? "manual";

  const deviation = useMemo(
    () => manualStep != null && calcStep != null && manualStep !== calcStep,
    [manualStep, calcStep],
  );

  const manualInvalid = manualInput !== "" && (manualPct == null || manualPct < 0 || manualPct > 100);

  async function save(nextAuto: boolean) {
    if (!canWrite) return;
    if (!nextAuto && manualInvalid) {
      toast.error("Manuell grovhet må være et tall mellom 0 og 100.");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("product_breadscale_set", {
        p_product_id: productId,
        p_mode: nextAuto ? "auto" : "manual",
        p_manual_value: nextAuto ? undefined : manualPct ?? undefined,
      });
      if (error) {
        setAuto(savedMode === "auto");
        toast.error(error.message);
        return;
      }
      toast.success(`Grovhet: ${describe(data == null ? null : Number(data))}`);
      await qc.invalidateQueries({ queryKey: ["product-breadscale", productId] });
      await qc.invalidateQueries({ queryKey: ["product", productId] });
    } catch (e) {
      setAuto(savedMode === "auto");
      showError("BreadscaleSection", e);
    } finally {
      setSaving(false);
    }
  }

  if (productQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Grovhet (Brødskala'n)</CardTitle>
          <Badge variant={savedMode === "auto" ? "default" : "secondary"}>
            {savedMode === "auto"
              ? `Følger varen: Fra oppskriften ${describe(effectivePct)} (oppdateres automatisk)`
              : `Følger varen: Manuell ${describe(effectivePct)}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* NBhub-beregning */}
          <div className="rounded-md border p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fra oppskriften
            </div>
            {calcQuery.isLoading ? (
              <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />
            ) : calcPct != null ? (
              <div className="mt-1 space-y-1">
                <div className="text-sm text-muted-foreground">
                  {recipeMode === "manual" ? "Manuell verdi i oppskriften" : "Beregnet av NBhub"}
                </div>
                <div className="text-lg font-semibold tabular-nums">{describe(calcPct)}</div>
                {recipeId && (
                  <Link
                    to={`/varer/oppskrifter/${recipeId}?tab=merking`}
                    className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                  >
                    Endre i oppskriften
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            ) : (
              <div className="mt-1 space-y-1 text-sm text-muted-foreground">
                <p>Ikke beregnet ennå — beregn merkedata på primæroppskriften.</p>
                {recipeId && (
                  <Link
                    to={`/varer/oppskrifter/${recipeId}?tab=merking`}
                    className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                  >
                    Endre i oppskriften{recipeName ? ` (${recipeName})` : ""}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Manuell */}
          <div className="rounded-md border p-3">
            <Label htmlFor="breadscale-manual" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Manuell
            </Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id="breadscale-manual"
                inputMode="decimal"
                value={manualInput}
                disabled={!canWrite}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="0–100"
                className="h-9 w-28"
              />
              <span className="text-sm text-muted-foreground">Grovhet (%) etter Brødskala'n</span>
            </div>
            <div className="mt-1 text-sm">
              {manualInvalid ? (
                <span className="text-destructive">Må være et tall mellom 0 og 100.</span>
              ) : manualStep != null ? (
                <span className="font-medium tabular-nums">{describe(manualPct)}</span>
              ) : (
                <span className="text-muted-foreground">Ingen manuell verdi satt.</span>
              )}
            </div>
          </div>
        </div>

        {deviation && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Oppskriften gir trinn {calcStep}, manuell verdi gir trinn {manualStep}.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-3">
            <Switch
              id="breadscale-mode"
              checked={auto}
              disabled={!canWrite || saving}
              onCheckedChange={(v) => {
                setAuto(v);
                void save(v);
              }}
            />
            <Label htmlFor="breadscale-mode" className="text-sm">
              Hvilken grovhet følger varen? — {auto ? "Automatisk fra oppskriften" : "Manuell"}
            </Label>
          </div>
          {!auto && canWrite && (
            <Button size="sm" onClick={() => void save(false)} disabled={saving || manualInvalid}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              Lagre manuell verdi
            </Button>
          )}
        </div>

        {effectiveStep != null && (
          <p className="text-xs text-muted-foreground">
            Etiketter og nettside bruker trinn {effectiveStep} {STEP_LABELS[effectiveStep] ?? ""}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
