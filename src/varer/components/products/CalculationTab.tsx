import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, Loader2, TrendingUp, TrendingDown, Minus, Save, Package2, Clock, Calculator } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  calculateRecipeMetrics,
  fmtKr,
  fmtPct,
  type IngredientLineInput,
} from "@/varer/lib/recipeCalc";
import { RawMaterialAutocomplete, type RawMaterialOption } from "./RawMaterialAutocomplete";

interface Props {
  productId: string;
  productName: string;
  canWrite: boolean;
}

const DEFAULT_LABOR_TYPES = ["Produksjon", "Dekorasjon", "Håndtering", "Transport"];

interface LaborLine {
  id: string;
  _new?: boolean;
  labor_type: string;
  hours: number | string;
  hourly_rate: number | string | null;
  sort_order: number;
}

interface PackagingLine {
  id: string;
  _new?: boolean;
  raw_material_id: string | null;
  name: string | null;
  quantity: number | string;
  unit_price_override: number | string | null;
  _rm?: { name: string; current_cost_price: number | null } | null;
  sort_order: number;
}

export function CalculationTab({ productId, productName, canWrite }: Props) {
  const qc = useQueryClient();

  const dataQuery = useQuery({
    queryKey: ["recipe-calc", productId],
    queryFn: async () => {
      const { data: recipe } = await supabase
        .from("recipes")
        .select("*")
        .eq("product_id", productId)
        .is("valid_to", null)
        .maybeSingle();
      if (!recipe) return { recipe: null };

      const [lines, labor, packaging, link] = await Promise.all([
        supabase
          .from("recipe_lines")
          .select("*, raw_materials(id, name, current_cost_price)")
          .eq("recipe_id", recipe.id)
          .order("sort_order"),
        supabase.from("recipe_labor_lines").select("*").eq("recipe_id", recipe.id).order("sort_order"),
        supabase
          .from("recipe_packaging_lines")
          .select("*, raw_materials(id, name, current_cost_price)")
          .eq("recipe_id", recipe.id)
          .order("sort_order"),
        supabase
          .from("product_recipe_links")
          .select("*")
          .eq("recipe_id", recipe.id)
          .eq("product_id", productId)
          .maybeSingle(),
      ]);
      return {
        recipe,
        lines: lines.data ?? [],
        labor: labor.data ?? [],
        packaging: packaging.data ?? [],
        link: link.data,
      };
    },
  });

  const data = dataQuery.data;
  const recipe = data?.recipe;

  // Local editable state — kalkyle-spesifikk (ingredienser styres i Oppskrift-fanen)
  const [unitsPerBatch, setUnitsPerBatch] = useState<string>("");
  const [hourlyRate, setHourlyRate] = useState<string>("");
  const [targetDb, setTargetDb] = useState<string>("");
  const [yieldWeightG, setYieldWeightG] = useState<string>("");
  const [priceNetto, setPriceNetto] = useState<string>("");
  const [priceEngros, setPriceEngros] = useState<string>("");
  const [priceEngrosPkg, setPriceEngrosPkg] = useState<string>("");
  const [priceEgne, setPriceEgne] = useState<string>("");
  const [labor, setLabor] = useState<LaborLine[]>([]);
  const [packaging, setPackaging] = useState<PackagingLine[]>([]);
  const [whatIfRaw, setWhatIfRaw] = useState(0);
  const [whatIfLabor, setWhatIfLabor] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recipe) return;
    setUnitsPerBatch(String(recipe.units_per_batch ?? recipe.yield_quantity ?? 1));
    setHourlyRate(String(recipe.hourly_rate ?? 400));
    setTargetDb(String(recipe.target_db_pct ?? 40));
    setYieldWeightG(recipe.yield_grams != null ? String(recipe.yield_grams) : "");
    setPriceNetto(recipe.price_netto != null ? String(recipe.price_netto) : "");
    setPriceEngros(recipe.price_engros != null ? String(recipe.price_engros) : "");
    setPriceEngrosPkg(recipe.price_engros_with_packaging != null ? String(recipe.price_engros_with_packaging) : "");
    setPriceEgne(recipe.price_egne_utsalg != null ? String(recipe.price_egne_utsalg) : "");
    // Init labor: hvis tomt, prefyll de fire standardradene
    if ((data?.labor.length ?? 0) === 0) {
      setLabor(
        DEFAULT_LABOR_TYPES.map((t, i) => ({
          id: `new-${i}`,
          _new: true,
          labor_type: t,
          hours: 0,
          hourly_rate: null,
          sort_order: i,
        })),
      );
    } else {
      setLabor(data!.labor.map((l: any) => ({ ...l })));
    }
    setPackaging(
      (data?.packaging ?? []).map((p: any) => ({
        ...p,
        _rm: p.raw_materials,
      })),
    );
  }, [recipe?.id]); // eslint-disable-line

  const ingredients: IngredientLineInput[] = useMemo(() => {
    if (!data?.lines) return [];
    const factor = 1 + whatIfRaw / 100;
    return data.lines.map((l: any) => ({
      raw_material_id: l.raw_material_id,
      quantity: Number(l.quantity) || 0,
      unit: l.unit,
      unit_cost_per_kg: (l.raw_materials?.current_cost_price ?? 0) * factor,
      waste_percent: l.waste_percent,
    }));
  }, [data?.lines, whatIfRaw]);

  const metrics = useMemo(() => {
    return calculateRecipeMetrics({
      ingredients,
      labor: labor.map((l) => ({
        hours: (Number(l.hours) || 0) * (1 + whatIfLabor / 100),
        hourly_rate: l.hourly_rate != null && l.hourly_rate !== "" ? Number(l.hourly_rate) : Number(hourlyRate) || 400,
      })),
      packaging: packaging.map((p) => ({
        quantity: Number(p.quantity) || 0,
        unit_price:
          p.unit_price_override != null && p.unit_price_override !== ""
            ? Number(p.unit_price_override)
            : Number(p._rm?.current_cost_price ?? 0),
      })),
      units_per_batch: Number(unitsPerBatch) || 1,
      hourly_rate_default: Number(hourlyRate) || 400,
      yield_weight_g: yieldWeightG ? Number(yieldWeightG) : null,
      prices: {
        netto: priceNetto ? Number(priceNetto) : null,
        engros: priceEngros ? Number(priceEngros) : null,
        engros_pkg: priceEngrosPkg ? Number(priceEngrosPkg) : null,
        egne_utsalg: priceEgne ? Number(priceEgne) : null,
      },
      vat_rate: 0.15,
      target_db_pct: Number(targetDb) || 40,
    });
  }, [ingredients, labor, packaging, unitsPerBatch, hourlyRate, yieldWeightG, priceNetto, priceEngros, priceEngrosPkg, priceEgne, targetDb, whatIfLabor]);

  if (dataQuery.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!recipe) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">Opprett en oppskrift først, så kan du legge inn arbeid, emballasje og priser her.</p>
        </CardContent>
      </Card>
    );
  }

  function addLabor() {
    setLabor([...labor, { id: `new-${Date.now()}`, _new: true, labor_type: "Annet", hours: 0, hourly_rate: null, sort_order: labor.length }]);
  }
  function updateLabor(id: string, patch: Partial<LaborLine>) {
    setLabor(labor.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function removeLabor(id: string) {
    setLabor(labor.filter((l) => l.id !== id));
  }

  function addPackaging() {
    setPackaging([
      ...packaging,
      {
        id: `new-${Date.now()}`,
        _new: true,
        raw_material_id: null,
        name: "",
        quantity: 1,
        unit_price_override: null,
        _rm: null,
        sort_order: packaging.length,
      },
    ]);
  }
  function updatePackaging(id: string, patch: Partial<PackagingLine>) {
    setPackaging(packaging.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePackaging(id: string) {
    setPackaging(packaging.filter((p) => p.id !== id));
  }

  async function save() {
    if (!recipe) return;
    setSaving(true);
    try {
      const { error: e1 } = await supabase
        .from("recipes")
        .update({
          units_per_batch: Number(unitsPerBatch) || null,
          hourly_rate: Number(hourlyRate) || 400,
          target_db_pct: Number(targetDb) || 40,
          yield_grams: yieldWeightG ? Number(yieldWeightG) : null,
          price_netto: priceNetto ? Number(priceNetto) : null,
          price_engros: priceEngros ? Number(priceEngros) : null,
          price_engros_with_packaging: priceEngrosPkg ? Number(priceEngrosPkg) : null,
          price_egne_utsalg: priceEgne ? Number(priceEgne) : null,
        })
        .eq("id", recipe.id);
      if (e1) throw e1;

      // labor: full replace strategi (atomisk via RPC)
      const laborPayload = labor
        .filter((l) => Number(l.hours) > 0 || l.labor_type)
        .map((l, i) => ({
          recipe_id: recipe.id,
          labor_type: l.labor_type,
          hours: Number(l.hours) || 0,
          hourly_rate: l.hourly_rate !== null && l.hourly_rate !== "" ? Number(l.hourly_rate) : null,
          sort_order: i,
        }));
      const { error: laborErr } = await (supabase as any).rpc("replace_child_rows", {
        p_table: "recipe_labor_lines",
        p_parent_column: "recipe_id",
        p_parent_id: recipe.id,
        p_rows: laborPayload,
      });
      if (laborErr) throw laborErr;

      // packaging: full replace (atomisk via RPC)
      const packagingPayload = packaging.map((p, i) => ({
        recipe_id: recipe.id,
        raw_material_id: p.raw_material_id,
        name: p.name || null,
        quantity: Number(p.quantity) || 0,
        unit_price_override:
          p.unit_price_override !== null && p.unit_price_override !== "" ? Number(p.unit_price_override) : null,
        sort_order: i,
      }));
      const { error: packagingErr } = await (supabase as any).rpc("replace_child_rows", {
        p_table: "recipe_packaging_lines",
        p_parent_column: "recipe_id",
        p_parent_id: recipe.id,
        p_rows: packagingPayload,
      });
      if (packagingErr) throw packagingErr;

      toast.success("Kalkyle lagret");
      qc.invalidateQueries({ queryKey: ["recipe-calc", productId] });
    } catch (err: any) {
      toast.error(err.message ?? "Kunne ikke lagre");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* HEADER + SAVE */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>Kalkyle</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{productName} · {recipe.units_per_batch ?? "—"} enheter pr batch</p>
        </div>
        {canWrite && (
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Lagre kalkyle
          </Button>
        )}
      </div>

      {/* KPI-CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Råvarekost / batch" value={`kr ${fmtKr(metrics.total_raw_cost)}`} sub={`${data!.lines.length} ingredienser`} />
        <KpiCard label="Arbeidskost / batch" value={`kr ${fmtKr(metrics.total_labor_cost)}`} sub={`${labor.reduce((s, l) => s + (Number(l.hours) || 0), 0).toFixed(1)} timer`} />
        <KpiCard label="Emballasje / batch" value={`kr ${fmtKr(metrics.total_packaging_cost)}`} sub={`${packaging.length} linjer`} />
        <KpiCard
          label="Kostnad pr stk"
          value={`kr ${fmtKr(metrics.cost_per_unit + metrics.packaging_per_unit)}`}
          sub={`vekt ${fmtKr(metrics.weight_per_unit_g, 0)} g`}
          highlight
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ARBEID */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" /> Arbeidskostnader
            </CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Timepris</Label>
              <Input
                type="number"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                disabled={!canWrite}
                className="h-7 w-20 text-right text-xs"
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left font-normal py-1.5">Type</th>
                  <th className="text-right font-normal w-16">Timer</th>
                  <th className="text-right font-normal w-20">Sats</th>
                  <th className="text-right font-normal w-24">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {labor.map((l) => {
                  const rate = l.hourly_rate != null && l.hourly_rate !== "" ? Number(l.hourly_rate) : Number(hourlyRate) || 400;
                  const total = (Number(l.hours) || 0) * rate;
                  return (
                    <tr key={l.id} className="border-b border-border/40 group">
                      <td className="py-1">
                        <Input value={l.labor_type} onChange={(e) => updateLabor(l.id, { labor_type: e.target.value })} disabled={!canWrite} className="h-7 border-0 px-1 focus-visible:ring-1" />
                      </td>
                      <td className="py-1">
                        <Input type="number" step="0.25" value={l.hours} onChange={(e) => updateLabor(l.id, { hours: e.target.value })} disabled={!canWrite} className="h-7 text-right border-0 px-1 focus-visible:ring-1" />
                      </td>
                      <td className="py-1">
                        <Input type="number" value={l.hourly_rate ?? ""} onChange={(e) => updateLabor(l.id, { hourly_rate: e.target.value || null })} disabled={!canWrite} placeholder="—" className="h-7 text-right border-0 px-1 focus-visible:ring-1 placeholder:text-muted-foreground/40" />
                      </td>
                      <td className="text-right tabular-nums py-1 px-2">{fmtKr(total)}</td>
                      <td>
                        {canWrite && (
                          <button onClick={() => removeLabor(l.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-medium border-t-2 border-border">
                  <td colSpan={3} className="py-2">Totalt</td>
                  <td className="text-right tabular-nums py-2 px-2">kr {fmtKr(metrics.total_labor_cost)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={addLabor} className="mt-2 h-7 text-xs text-muted-foreground">
                <Plus className="mr-1 h-3 w-3" /> Legg til arbeidstype
              </Button>
            )}
          </CardContent>
        </Card>

        {/* EMBALLASJE */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package2 className="h-4 w-4 text-muted-foreground" /> Emballasje
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left font-normal py-1.5">Råvare/navn</th>
                  <th className="text-right font-normal w-16">Antall</th>
                  <th className="text-right font-normal w-20">Pris</th>
                  <th className="text-right font-normal w-24">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {packaging.map((p) => {
                  const price = p.unit_price_override != null && p.unit_price_override !== "" ? Number(p.unit_price_override) : Number(p._rm?.current_cost_price ?? 0);
                  const total = (Number(p.quantity) || 0) * price;
                  return (
                    <tr key={p.id} className="border-b border-border/40 group">
                      <td className="py-1">
                        <RawMaterialAutocomplete
                          value={p.raw_material_id ?? null}
                          onChange={(_id, rm) =>
                            updatePackaging(p.id, {
                              raw_material_id: rm?.id ?? null,
                              name: rm?.name ?? p.name,
                              _rm: rm ? { name: rm.name, current_cost_price: rm.current_cost_price } : null,
                            })
                          }
                          disabled={!canWrite}
                          placeholder={p.name || "Søk emballasje…"}
                        />
                      </td>
                      <td className="py-1">
                        <Input type="number" value={p.quantity} onChange={(e) => updatePackaging(p.id, { quantity: e.target.value })} disabled={!canWrite} className="h-7 text-right border-0 px-1 focus-visible:ring-1" />
                      </td>
                      <td className="py-1">
                        <Input type="number" step="0.01" value={p.unit_price_override ?? ""} onChange={(e) => updatePackaging(p.id, { unit_price_override: e.target.value || null })} disabled={!canWrite} placeholder={fmtKr(p._rm?.current_cost_price ?? 0)} className="h-7 text-right border-0 px-1 focus-visible:ring-1 placeholder:text-muted-foreground/40" />
                      </td>
                      <td className="text-right tabular-nums py-1 px-2">{fmtKr(total)}</td>
                      <td>
                        {canWrite && (
                          <button onClick={() => removePackaging(p.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-medium border-t-2 border-border">
                  <td colSpan={3} className="py-2">Totalt</td>
                  <td className="text-right tabular-nums py-2 px-2">kr {fmtKr(metrics.total_packaging_cost)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
            {canWrite && (
              <Button variant="ghost" size="sm" onClick={addPackaging} className="mt-2 h-7 text-xs text-muted-foreground">
                <Plus className="mr-1 h-3 w-3" /> Legg til emballasje
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* BATCH-OPPSETT */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" /> Batch og mål
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Antall enheter pr batch</Label>
              <Input type="number" value={unitsPerBatch} onChange={(e) => setUnitsPerBatch(e.target.value)} disabled={!canWrite} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Vekt pr enhet (g)</Label>
              <Input type="number" value={yieldWeightG} onChange={(e) => setYieldWeightG(e.target.value)} disabled={!canWrite} placeholder={`auto: ${fmtKr(metrics.weight_per_unit_g, 0)}`} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Mål dekningsgrad %</Label>
              <Input type="number" value={targetDb} onChange={(e) => setTargetDb(e.target.value)} disabled={!canWrite} />
            </div>
            <div className="text-xs text-muted-foreground self-end pb-2">
              Total vekt: <span className="font-medium text-foreground">{fmtKr(metrics.total_weight_g, 0)} g</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SALGSPRISER */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Salgspriser og marginer</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <PriceRow
            label="Salgspris NETTO"
            sub="Standard"
            value={priceNetto}
            onChange={setPriceNetto}
            metrics={metrics.prices.netto}
            target={Number(targetDb) || 40}
            canWrite={canWrite}
          />
          <PriceRow
            label="Pris Engros"
            sub="Til engroskunder"
            value={priceEngros}
            onChange={setPriceEngros}
            metrics={metrics.prices.engros}
            target={Number(targetDb) || 40}
            canWrite={canWrite}
          />
          <PriceRow
            label="Salgspris med emballasje ENGROS"
            sub="Inkl. pose/eske"
            value={priceEngrosPkg}
            onChange={setPriceEngrosPkg}
            metrics={metrics.prices.engros_pkg}
            target={Number(targetDb) || 40}
            canWrite={canWrite}
          />
          <PriceRow
            label="Salgspris med emballasje EGNE UTSALG"
            sub="Eget utsalg"
            value={priceEgne}
            onChange={setPriceEgne}
            metrics={metrics.prices.egne_utsalg}
            target={Number(targetDb) || 40}
            canWrite={canWrite}
          />
        </CardContent>
      </Card>

      {/* WHAT-IF */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" /> Hva hvis…
          </CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4 pt-2">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <Label>Råvarepriser endres</Label>
              <span className={cn("font-medium tabular-nums", whatIfRaw > 0 && "text-destructive", whatIfRaw < 0 && "text-success")}>
                {whatIfRaw > 0 ? "+" : ""}{whatIfRaw} %
              </span>
            </div>
            <Slider value={[whatIfRaw]} onValueChange={(v) => setWhatIfRaw(v[0])} min={-30} max={30} step={1} />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <Label>Arbeidstid endres</Label>
              <span className={cn("font-medium tabular-nums", whatIfLabor > 0 && "text-destructive", whatIfLabor < 0 && "text-success")}>
                {whatIfLabor > 0 ? "+" : ""}{whatIfLabor} %
              </span>
            </div>
            <Slider value={[whatIfLabor]} onValueChange={(v) => setWhatIfLabor(v[0])} min={-50} max={50} step={5} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <Card className={cn(highlight && "border-app/40 bg-app/5")}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tracking-tight tabular-nums mt-1" style={{ letterSpacing: "-0.02em" }}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function PriceRow({
  label, sub, value, onChange, metrics, target, canWrite,
}: {
  label: string;
  sub: string;
  value: string;
  onChange: (v: string) => void;
  metrics: { price: number; db: number; dg_pct: number; brutto_pct: number; price_inc_vat: number; status: "ok" | "warn" | "bad" };
  target: number;
  canWrite: boolean;
}) {
  const Icon = metrics.status === "ok" ? TrendingUp : metrics.status === "warn" ? Minus : TrendingDown;
  return (
    <div className="grid grid-cols-12 gap-3 items-center py-2.5 border-b border-border/40 last:border-0">
      <div className="col-span-4">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
      <div className="col-span-2">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kr</span>
          <Input type="number" step="0.5" value={value} onChange={(e) => onChange(e.target.value)} disabled={!canWrite} className="text-right tabular-nums pl-8" />
        </div>
        <div className="text-[10px] text-muted-foreground text-right mt-0.5">m/mva: kr {fmtKr(metrics.price_inc_vat)}</div>
      </div>
      <div className="col-span-2 text-right">
        <div className="text-xs text-muted-foreground">DB</div>
        <div className="text-sm font-medium tabular-nums">kr {fmtKr(metrics.db)}</div>
      </div>
      <div className="col-span-2 text-right">
        <div className="text-xs text-muted-foreground">Brutto</div>
        <div className="text-sm font-medium tabular-nums">{fmtPct(metrics.brutto_pct)}</div>
      </div>
      <div className="col-span-2">
        <Badge
          variant="outline"
          className={cn(
            "w-full justify-center font-medium tabular-nums",
            metrics.status === "ok" && "bg-success/10 text-success border-success/30",
            metrics.status === "warn" && "bg-warning/10 text-warning border-warning/30",
            metrics.status === "bad" && "bg-destructive/10 text-destructive border-destructive/30",
          )}
        >
          <Icon className="mr-1 h-3 w-3" />
          DG {fmtPct(metrics.dg_pct)}
        </Badge>
        <div className="text-[10px] text-muted-foreground text-center mt-0.5">mål {target} %</div>
      </div>
    </div>
  );
}
