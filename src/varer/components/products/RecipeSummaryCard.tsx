import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ChefHat,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  Plus,
  Repeat,
} from "lucide-react";
import { useStockTrackedRawMaterials } from "@/varer/hooks/useStockTrackedRawMaterials";
import { fmtG, fmtPercent, RECIPE_STATUS_LABEL } from "@/varer/lib/bakers";
import { logAudit } from "@/varer/lib/audit";
import {
  PRODUCT_RECIPE_LINK_KEY,
  useProductRecipeLink,
} from "@/varer/hooks/useProductRecipeLink";
import {
  SALES_UNIT_BASIS_HELP,
  SALES_UNIT_BASIS_LABEL,
  isSalesUnitBasis,
  type SalesUnitBasis,
} from "@/varer/lib/recipeLinkBasis";
import { LinkRecipeDialog, type RecipeLinkSelection } from "./LinkRecipeDialog";

interface Props {
  productId: string;
  productName: string;
  legalEntityId: string | null;
  canWrite: boolean;
}

function nok(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Oppskriftsfanen på varekortet. Selve redigeringen bor i oppskriftsmodulen —
 * her kobler, tilpasser og leser vi grunnlaget koblingen gir varen.
 */
export function RecipeSummaryCard({ productId, productName, legalEntityId, canWrite }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const { bundle, isLoading, hasRecipe } = useProductRecipeLink(productId);
  const trackedQuery = useStockTrackedRawMaterials();
  const { link, recipe, lines, basis, cost } = bundle;

  const approvedQuery = useQuery({
    queryKey: ["recipe-approved-declaration", recipe?.id],
    enabled: !!recipe?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("recipe_declaration_versions")
        .select("id, version, approved_at")
        .eq("recipe_id", recipe!.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
  });

  async function invalidate() {
    await qc.invalidateQueries({ queryKey: PRODUCT_RECIPE_LINK_KEY(productId) });
    qc.invalidateQueries({ queryKey: ["product-recipe-summary", productId] });
    qc.invalidateQueries({ queryKey: ["product-margins", productId] });
    qc.invalidateQueries({ queryKey: ["product-declaration", productId] });
  }

  async function createRecipe() {
    const { data, error } = await supabase
      .from("recipes")
      .insert({
        name: productName,
        product_id: productId,
        legal_entity_id: legalEntityId,
        status: "draft",
        yield_quantity: 1,
        yield_unit: "stk",
      } as never)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    await supabase
      .from("recipe_parts")
      .insert({ recipe_id: data.id, name: "Hoveddeig", sort_order: 0, part_type: "dough" } as never);
    await supabase
      .from("product_recipe_links")
      .insert({ product_id: productId, recipe_id: data.id, is_primary: true } as never);
    await logAudit({
      action: "create",
      entity_type: "product_recipe_link",
      entity_id: productId,
      entity_display_reference: productName,
      changes: { recipe_id: { from: null, to: data.id } },
    });
    await invalidate();
    navigate(`/varer/oppskrifter/${data.id}`);
  }

  async function handleLinkConfirm(sel: RecipeLinkSelection) {
    const payload = {
      sales_unit_basis: sel.salesUnitBasis,
      units_per_sales_unit: sel.unitsPerSalesUnit,
      sales_unit_weight_g: sel.salesUnitWeightG,
      sales_unit_confirmed_at: new Date().toISOString(),
    };
    const previousRecipeId = link?.recipe_id ?? null;

    if (link?.id) {
      const { error } = await supabase
        .from("product_recipe_links")
        .update({ recipe_id: sel.recipeId, ...payload } as never)
        .eq("id", link.id);
      if (error) {
        toast.error(linkErrorMessage(error));
        return;
      }
    } else {
      const { error } = await supabase
        .from("product_recipe_links")
        .insert({ product_id: productId, recipe_id: sel.recipeId, is_primary: true, ...payload } as never);
      if (error) {
        toast.error(linkErrorMessage(error));
        return;
      }
    }

    await logAudit({
      action: previousRecipeId ? "update" : "create",
      entity_type: "product_recipe_link",
      entity_id: productId,
      entity_display_reference: productName,
      changes: {
        recipe_id: { from: previousRecipeId, to: sel.recipeId },
        sales_unit_basis: { from: link?.sales_unit_basis ?? null, to: sel.salesUnitBasis },
        units_per_sales_unit: { from: link?.units_per_sales_unit ?? null, to: sel.unitsPerSalesUnit },
      },
    });
    toast.success(previousRecipeId ? "Oppskriften er byttet" : `«${sel.recipeName}» er koblet til varen`);
    await invalidate();
  }

  async function saveSettings(next: {
    sales_unit_basis?: SalesUnitBasis | null;
    units_per_sales_unit?: number | null;
    sales_unit_weight_g?: number | null;
    units_per_batch_override?: number | null;
  }) {
    if (!link?.id) {
      toast.error("Koblingen må lagres før innstillingene kan endres. Bytt oppskrift for å opprette koblingen.");
      return;
    }
    setSavingSettings(true);
    const { error } = await supabase
      .from("product_recipe_links")
      .update({ ...next, sales_unit_confirmed_at: new Date().toISOString() } as never)
      .eq("id", link.id);
    setSavingSettings(false);
    if (error) {
      toast.error(linkErrorMessage(error));
      return;
    }
    await logAudit({
      action: "update",
      entity_type: "product_recipe_link",
      entity_id: productId,
      entity_display_reference: productName,
      changes: next as Record<string, unknown>,
    });
    toast.success("Koblingens innstillinger er lagret");
    await invalidate();
  }

  async function removeLink() {
    setConfirmUnlink(false);
    if (!link?.id) {
      toast.error("Denne varen har en gammel direktekobling. Åpne oppskriften for å endre den.");
      return;
    }
    const { error } = await supabase.from("product_recipe_links").delete().eq("id", link.id);
    if (error) {
      toast.error(linkErrorMessage(error));
      return;
    }
    await logAudit({
      action: "delete",
      entity_type: "product_recipe_link",
      entity_id: productId,
      entity_display_reference: productName,
      changes: { recipe_id: { from: link.recipe_id, to: null } },
    });
    toast.success("Koblingen er fjernet. Oppskriften er ikke slettet.");
    await invalidate();
  }

  if (isLoading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasRecipe || !recipe) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ChefHat className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Ingen oppskrift koblet til denne varen.</p>
            {canWrite && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => setLinkDialogOpen(true)}>
                  <Link2 className="mr-2 h-4 w-4" /> Koble eksisterende oppskrift
                </Button>
                <Button variant="outline" onClick={createRecipe}>
                  <Plus className="mr-2 h-4 w-4" /> Opprett oppskrift
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        <LinkRecipeDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          productName={productName}
          legalEntityId={legalEntityId}
          onConfirm={handleLinkConfirm}
        />
      </>
    );
  }

  const trackedIds = trackedQuery.data;
  const trackedCount = lines.filter((l) => l.raw_material_id && trackedIds?.has(l.raw_material_id)).length;
  const subRecipeCount = lines.filter((l) => l.sub_product_id || l._rm?.produced_by_recipe_id).length;
  const confirmedAt = link?.sales_unit_confirmed_at ?? null;
  const recipeChangedAfterConfirm =
    !!confirmedAt && !!recipe.updated_at && new Date(recipe.updated_at) > new Date(confirmedAt);
  const approved = approvedQuery.data;
  const approvedNeedsReview =
    !!approved?.approved_at && !!recipe.updated_at && new Date(recipe.updated_at) > new Date(approved.approved_at);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <ChefHat className="h-4 w-4 text-app" />
            {recipe.name || "Oppskrift"}
            <span className="text-xs font-normal text-muted-foreground">v{recipe.version}</span>
            <Badge variant="outline">{RECIPE_STATUS_LABEL[recipe.status ?? "draft"] ?? recipe.status}</Badge>
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/varer/oppskrifter/${recipe.id}`)}>
              Åpne oppskrift <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
            {canWrite && (
              <>
                <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)}>
                  <Repeat className="mr-1.5 h-3.5 w-3.5" /> Bytt oppskrift
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmUnlink(true)}>
                  <Link2Off className="mr-1.5 h-3.5 w-3.5" /> Fjern kobling
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Melvekt" value={bundle.totalFlourG ? `${fmtG(bundle.totalFlourG)} g` : "—"} origin="Fra oppskrift" />
          <Stat label="Hydrering" value={fmtPercent(bundle.hydrationPct ?? 0)} origin="Beregnet" />
          <Stat label="Deigvekt" value={bundle.totalDoughG ? `${fmtG(bundle.totalDoughG)} g` : "—"} origin="Beregnet" />
          <Stat label="Ferdigvekt" value={bundle.finalWeightG ? `${fmtG(bundle.finalWeightG)} g` : "Mangler"} origin="Beregnet" />
          <Stat label="Ingredienser" value={`${lines.length}`} origin="Fra oppskrift" />
          <Stat label="Underoppskrifter" value={`${subRecipeCount}`} origin="Fra oppskrift" />
          <Stat
            label="Antall emner"
            value={bundle.unitCount != null ? `${bundle.unitCount} stk` : "Mangler"}
            origin="Fra oppskrift"
          />
          <Stat
            label="Registrert svinn"
            value={recipe.dough_waste_pct != null ? `${recipe.dough_waste_pct} %` : "Mangler"}
            origin="Fra oppskrift"
          />
        </CardContent>
        {trackedCount > 0 && (
          <CardContent className="pt-0 text-xs text-muted-foreground">
            Lagertrekk aktivt: {trackedCount} av {lines.length} ingredienser lagerføres og trekkes ved kjørt pakkseddel.
          </CardContent>
        )}
      </Card>

      {(recipeChangedAfterConfirm || approvedNeedsReview) && (
        <Card className="border-amber-500/40 bg-amber-500/[0.06]">
          <CardContent className="flex gap-3 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              {recipeChangedAfterConfirm && (
                <p>
                  Oppskriften er endret {formatTimestamp(recipe.updated_at)}, etter at koblingen ble bekreftet{" "}
                  {formatTimestamp(confirmedAt)}. Kontroller innstillingene under.
                </p>
              )}
              {approvedNeedsReview && (
                <p>
                  Godkjent deklarasjon (versjon {approved?.version}) er beholdt, men trenger ny gjennomgang fordi
                  oppskriften er endret etter godkjenningen.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <SalesUnitSettings
        link={link}
        canWrite={canWrite}
        saving={savingSettings}
        onSave={saveSettings}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Beregningsgrunnlag for salgsenheten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Enheter per salgsenhet"
              value={basis.unitsPerSalesUnit != null ? `${basis.unitsPerSalesUnit}` : "Ikke bekreftet"}
              origin="Bekreftet på koblingen"
            />
            <Stat
              label="Vekt per salgsenhet"
              value={basis.weightPerSalesUnitG ? `${fmtG(basis.weightPerSalesUnitG)} g` : "Mangler"}
              origin={link?.sales_unit_weight_g ? "Bekreftet på koblingen" : "Beregnet"}
            />
            <Stat
              label="Råvarekost per stk"
              value={basis.costPerUnit != null ? nok(basis.costPerUnit) : "Mangler"}
              origin="Beregnet"
            />
            <Stat
              label="Råvarekost per salgsenhet"
              value={basis.costPerSalesUnit != null ? nok(basis.costPerSalesUnit) : "Mangler"}
              origin="Beregnet"
            />
          </div>
          {basis.missing.length > 0 && (
            <div className="rounded-md bg-muted/60 p-3 text-xs">
              <div className="mb-1 font-medium">Beregningen er stoppet fordi:</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {basis.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {cost && cost.missing.length > 0 && (
            <div className="rounded-md bg-muted/60 p-3 text-xs">
              <div className="mb-1 font-medium">Mangler kostgrunnlag:</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {cost.missing.slice(0, 8).map((m) => (
                  <li key={`${m.name}-${m.reason}`}>
                    {m.name}: {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ingredienser fra oppskriften</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">Ingrediens</th>
                <th className="px-4 py-2 text-right font-medium">Mengde</th>
                <th className="px-4 py-2 text-left font-medium">Enhet</th>
                <th className="px-4 py-2 text-left font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-4 py-1.5">{l._rm?.name ?? l.ingredient_name ?? "Ukjent råvare"}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-4 py-1.5">{l.unit}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">
                    {l.sub_product_id || l._rm?.produced_by_recipe_id ? "Underoppskrift" : "Råvare"}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                    Oppskriften har ingen linjer ennå.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <LinkRecipeDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        productName={productName}
        legalEntityId={legalEntityId}
        currentRecipeId={recipe.id}
        onConfirm={handleLinkConfirm}
      />

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fjerne koblingen til «{recipe.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Varen mister oppskriftens grunnlag for deklarasjon og kalkyle. Oppskriften slettes ikke, og kan kobles
              til igjen senere. Manuelt registrerte data på varen beholdes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={removeLink}>Fjern kobling</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SalesUnitSettings({
  link,
  canWrite,
  saving,
  onSave,
}: {
  link: { sales_unit_basis?: string | null; units_per_sales_unit?: number | string | null; sales_unit_weight_g?: number | string | null; units_per_batch_override?: number | string | null; sales_unit_confirmed_at?: string | null } | null;
  canWrite: boolean;
  saving: boolean;
  onSave: (next: {
    sales_unit_basis?: SalesUnitBasis | null;
    units_per_sales_unit?: number | null;
    sales_unit_weight_g?: number | null;
    units_per_batch_override?: number | null;
  }) => Promise<void>;
}) {
  const [basis, setBasis] = useState<SalesUnitBasis | "">(
    isSalesUnitBasis(link?.sales_unit_basis) ? (link!.sales_unit_basis as SalesUnitBasis) : "",
  );
  const [units, setUnits] = useState(link?.units_per_sales_unit != null ? String(link.units_per_sales_unit) : "");
  const [weight, setWeight] = useState(link?.sales_unit_weight_g != null ? String(link.sales_unit_weight_g) : "");
  const [batch, setBatch] = useState(
    link?.units_per_batch_override != null ? String(link.units_per_batch_override) : "",
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Koblingens innstillinger</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Bekreft hvordan oppskriftens utbytte svarer til varens salgsenhet. Ingenting utledes fra varenavnet.
          {link?.sales_unit_confirmed_at
            ? ` Sist bekreftet ${formatTimestamp(link.sales_unit_confirmed_at)}.`
            : " Ikke bekreftet ennå."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Grunnlag</Label>
            <Select value={basis} onValueChange={(v) => setBasis(v as SalesUnitBasis)} disabled={!canWrite}>
              <SelectTrigger aria-label="Grunnlag for salgsenhet">
                <SelectValue placeholder="Velg grunnlag" />
              </SelectTrigger>
              <SelectContent>
                {(["stk", "flerpakk", "vekt"] as SalesUnitBasis[]).map((b) => (
                  <SelectItem key={b} value={b}>
                    {SALES_UNIT_BASIS_LABEL[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {basis ? <p className="text-[11px] text-muted-foreground">{SALES_UNIT_BASIS_HELP[basis]}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="settings-units">
              Enheter per salgsenhet
            </Label>
            <Input
              id="settings-units"
              inputMode="decimal"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              disabled={!canWrite || basis === "vekt"}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="settings-weight">
              Vekt per salgsenhet (g)
            </Label>
            <Input
              id="settings-weight"
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              disabled={!canWrite}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="settings-batch">
              Emner per batch (overstyrt)
            </Label>
            <Input
              id="settings-batch"
              inputMode="decimal"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              disabled={!canWrite}
              placeholder="Følger oppskriften"
            />
          </div>
        </div>
        {canWrite && (
          <Button
            size="sm"
            disabled={saving || !basis}
            onClick={() =>
              onSave({
                sales_unit_basis: basis || null,
                units_per_sales_unit: basis === "vekt" ? null : units === "" ? (basis === "stk" ? 1 : null) : Number(units),
                sales_unit_weight_g: weight === "" ? null : Number(weight),
                units_per_batch_override: batch === "" ? null : Number(batch),
              })
            }
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Lagre innstillinger
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function linkErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501") return "Du mangler skrivetilgang til varer i dette selskapet.";
  if (error.code === "23514") return "Oppskriften kan ikke kobles — det ville gitt en sirkulær referanse.";
  if (error.code === "23505") return "Oppskriften er allerede koblet til denne varen.";
  return error.message;
}

function Stat({ label, value, origin }: { label: string; value: string; origin?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {origin ? <div className="text-[10px] text-muted-foreground">{origin}</div> : null}
    </div>
  );
}
