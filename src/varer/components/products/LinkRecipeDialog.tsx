import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, ChefHat, AlertTriangle, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RECIPE_STATUS_LABEL, fmtG } from "@/varer/lib/bakers";
import {
  SALES_UNIT_BASIS_HELP,
  SALES_UNIT_BASIS_LABEL,
  type SalesUnitBasis,
} from "@/varer/lib/recipeLinkBasis";
import {
  buildRecipeBasis,
  type LinkedRecipe,
  type ProductRecipeLinkRow,
} from "@/varer/hooks/useProductRecipeLink";
import type { BakersRawMaterial } from "@/varer/lib/bakers";

export interface RecipeLinkSelection {
  recipeId: string;
  recipeName: string;
  salesUnitBasis: SalesUnitBasis;
  unitsPerSalesUnit: number | null;
  salesUnitWeightG: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  legalEntityId: string | null;
  /** Oppskrift som allerede er koblet — skjules i listen og merker «Bytt». */
  currentRecipeId?: string | null;
  onConfirm: (selection: RecipeLinkSelection) => Promise<void> | void;
}

const RECIPE_FIELDS = `
  id, name, status, version, category, department,
  units_per_batch, unit_weight_grams, dough_piece_grams, dough_waste_pct,
  yield_quantity, yield_unit, yield_grams, yield_loss_pct, finished_weight_grams,
  production_notes, notes, description, shelf_life_days, storage_instructions,
  bake_temp_celsius, bake_time_minutes, steam_seconds, cooling_minutes,
  bulk_proof_minutes, shape_proof_minutes, target_dough_temp_celsius,
  declaration_mode, updated_at,
  recipe_lines(id, recipe_part_id, quantity, unit, raw_material_id, sub_product_id,
    ingredient_name, is_flour_override, water_content_pct_override, waste_percent)
`;

function nok(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

export function LinkRecipeDialog({
  open,
  onOpenChange,
  productName,
  legalEntityId,
  currentRecipeId,
  onConfirm,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [basis, setBasis] = useState<SalesUnitBasis | "">("");
  const [unitsPerSalesUnit, setUnitsPerSalesUnit] = useState("");
  const [salesUnitWeight, setSalesUnitWeight] = useState("");
  const [saving, setSaving] = useState(false);

  const listQuery = useQuery({
    queryKey: ["recipes-for-linking", legalEntityId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, status, version, category, department, yield_quantity, yield_unit, units_per_batch, dough_piece_grams, updated_at")
        .is("valid_to", null)
        .order("name")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const detailQuery = useQuery({
    queryKey: ["recipe-link-preview", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const [{ data: recipe, error }, { data: rms }] = await Promise.all([
        supabase.from("recipes").select(RECIPE_FIELDS).eq("id", selectedId!).maybeSingle(),
        supabase
          .from("raw_materials")
          .select(
            "id, name, category, grain_classification, cereal_type, water_content_pct, unit_weight_grams, current_cost_price, density_g_per_ml, is_water, base_unit, is_composite, produced_by_recipe_id",
          )
          .limit(3000),
      ]);
      if (error) throw error;
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of (rms ?? []) as unknown as BakersRawMaterial[]) map[r.id] = r;
      return { recipe: (recipe ?? null) as unknown as LinkedRecipe | null, rmMap: map };
    },
  });

  const term = search.trim().toLocaleLowerCase("nb-NO");
  const rows = useMemo(() => {
    const all = (listQuery.data ?? []).filter((r) => r.id !== currentRecipeId);
    if (!term) return all.slice(0, 100);
    return all
      .filter((r) =>
        `${r.name ?? ""} ${r.category ?? ""} ${r.department ?? ""}`
          .toLocaleLowerCase("nb-NO")
          .includes(term),
      )
      .slice(0, 100);
  }, [listQuery.data, term, currentRecipeId]);

  const draftLink: ProductRecipeLinkRow | null = selectedId
    ? {
        id: null,
        recipe_id: selectedId,
        sales_unit_basis: basis || null,
        units_per_sales_unit: unitsPerSalesUnit === "" ? null : Number(unitsPerSalesUnit),
        sales_unit_weight_g: salesUnitWeight === "" ? null : Number(salesUnitWeight),
      }
    : null;

  const preview = buildRecipeBasis(
    draftLink,
    detailQuery.data?.recipe ?? null,
    detailQuery.data?.rmMap ?? {},
  );

  const canConfirm =
    !!selectedId &&
    !!basis &&
    (basis !== "flerpakk" || Number(unitsPerSalesUnit) > 0) &&
    (basis !== "vekt" || Number(salesUnitWeight) > 0) &&
    !saving;

  function reset() {
    setSearch("");
    setSelectedId(null);
    setBasis("");
    setUnitsPerSalesUnit("");
    setSalesUnitWeight("");
  }

  async function confirm() {
    if (!selectedId || !basis) return;
    setSaving(true);
    try {
      await onConfirm({
        recipeId: selectedId,
        recipeName: detailQuery.data?.recipe?.name ?? "oppskrift",
        salesUnitBasis: basis,
        unitsPerSalesUnit: basis === "flerpakk" ? Number(unitsPerSalesUnit) : basis === "stk" ? 1 : null,
        salesUnitWeightG: salesUnitWeight === "" ? null : Number(salesUnitWeight),
      });
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{currentRecipeId ? "Bytt oppskrift" : "Koble eksisterende oppskrift"}</DialogTitle>
          <DialogDescription>
            Velg en oppskrift som allerede finnes. Koblingen peker på originalen — oppskriften kopieres ikke,
            og kan brukes av flere varer med ulik størrelse eller pakning.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Søk oppskrift…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Søk oppskrift"
              />
            </div>
            <ScrollArea className="h-64 rounded-md border md:h-[22rem]">
              {listQuery.isLoading ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : rows.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Ingen oppskrifter matcher søket.</div>
              ) : (
                <ul className="divide-y">
                  {rows.map((r) => {
                    const active = r.id === selectedId;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.id)}
                          className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-accent ${active ? "bg-accent" : ""}`}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            {active && <Check className="h-3.5 w-3.5 text-app" />}
                            {r.name ?? "Uten navn"}
                            <span className="text-xs font-normal text-muted-foreground">v{r.version ?? 1}</span>
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              {RECIPE_STATUS_LABEL[r.status ?? "draft"] ?? r.status}
                            </Badge>
                            {r.category ? <span>{r.category}</span> : null}
                            <span>
                              Utbytte:{" "}
                              {r.yield_quantity != null
                                ? `${r.yield_quantity} ${r.yield_unit ?? ""}`.trim()
                                : r.units_per_batch != null
                                  ? `${r.units_per_batch} stk`
                                  : "mangler"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </div>

          <div className="space-y-3">
            {!selectedId ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                <ChefHat className="h-6 w-6 opacity-50" />
                Velg en oppskrift for å se hva koblingen tilfører «{productName}».
              </div>
            ) : detailQuery.isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="rounded-md border p-3">
                  <div className="text-sm font-medium">{preview.recipe?.name ?? "Oppskrift"}</div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <Row label="Ingredienser" value={`${preview.lines.length}`} />
                    <Row label="Deigvekt" value={preview.totalDoughG ? `${fmtG(preview.totalDoughG)} g` : "mangler"} />
                    <Row
                      label="Ferdigvekt"
                      value={preview.finalWeightG ? `${fmtG(preview.finalWeightG)} g` : "mangler"}
                    />
                    <Row label="Antall emner" value={preview.unitCount != null ? `${preview.unitCount} stk` : "mangler"} />
                    <Row
                      label="Råvarekostnad"
                      value={preview.cost && !preview.cost.incomplete ? nok(preview.cost.totalCost) : "ufullstendig"}
                    />
                    <Row
                      label="Stykkvekt"
                      value={preview.basis.weightPerUnitG ? `${fmtG(preview.basis.weightPerUnitG)} g` : "mangler"}
                    />
                  </dl>
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Slik svarer utbyttet til salgsenheten</div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Grunnlag</Label>
                    <Select value={basis} onValueChange={(v) => setBasis(v as SalesUnitBasis)}>
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
                    {basis ? (
                      <p className="text-[11px] text-muted-foreground">{SALES_UNIT_BASIS_HELP[basis]}</p>
                    ) : null}
                  </div>

                  {basis === "flerpakk" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor="units-per-sales-unit">
                        Antall enheter per salgsenhet
                      </Label>
                      <Input
                        id="units-per-sales-unit"
                        inputMode="decimal"
                        value={unitsPerSalesUnit}
                        onChange={(e) => setUnitsPerSalesUnit(e.target.value)}
                        placeholder="f.eks. 8"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Må bekreftes manuelt. Antallet utledes aldri fra varenavnet.
                      </p>
                    </div>
                  )}

                  {(basis === "vekt" || basis === "flerpakk" || basis === "stk") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs" htmlFor="sales-unit-weight">
                        Vekt per salgsenhet (g){basis === "vekt" ? "" : " — valgfritt"}
                      </Label>
                      <Input
                        id="sales-unit-weight"
                        inputMode="decimal"
                        value={salesUnitWeight}
                        onChange={(e) => setSalesUnitWeight(e.target.value)}
                        placeholder={
                          preview.basis.weightPerSalesUnitG
                            ? `Beregnet: ${fmtG(preview.basis.weightPerSalesUnitG)}`
                            : "f.eks. 720"
                        }
                      />
                    </div>
                  )}
                </div>

                <div className="rounded-md border p-3 text-xs">
                  <div className="mb-1.5 text-sm font-medium">Dette tilfører koblingen</div>
                  <ul className="space-y-1">
                    <li>Ingredienser, mengder, enheter og underoppskrifter til deklarasjon og kalkyle</li>
                    <li>
                      Utbytte og vekt:{" "}
                      {preview.basis.weightPerSalesUnitG
                        ? `${fmtG(preview.basis.weightPerSalesUnitG)} g per salgsenhet`
                        : "ikke beregnet ennå"}
                    </li>
                    <li>
                      Råvarekostnad:{" "}
                      {preview.basis.costPerSalesUnit != null
                        ? `${nok(preview.basis.costPerSalesUnit)} per salgsenhet`
                        : "ikke beregnet ennå"}
                    </li>
                    <li>Produksjonsbeskrivelse og produksjonsparametere der de finnes</li>
                  </ul>
                  {preview.basis.missing.length > 0 && (
                    <div className="mt-2 flex gap-2 rounded-md bg-muted/60 p-2 text-[11px]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <ul className="space-y-0.5">
                        {preview.basis.missing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Salgspris, varenummer og navn endres ikke av koblingen.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button onClick={confirm} disabled={!canConfirm}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {currentRecipeId ? "Bytt oppskrift" : "Koble oppskrift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
