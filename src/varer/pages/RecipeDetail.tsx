import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { arrayMove } from "@dnd-kit/sortable";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAppContext } from "@/varer/context/AppContext";
import { AppHeaderBanner } from "@/varer/components/layout/AppHeaderBanner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calculator, FileText, Loader2, Lock, Plus, Printer, Save, Share2 } from "lucide-react";
import { logAudit } from "@/varer/lib/audit";
import { RecipeProductLinks } from "@/varer/components/products/RecipeProductLinks";
import { RecipeStatsBar } from "@/varer/components/recipes/RecipeStatsBar";
import { DoughTempPanel } from "@/varer/components/recipes/DoughTempPanel";
import { RecipeStepsEditor, type EditorStep } from "@/varer/components/recipes/RecipeStepsEditor";
import { RecipePartCard, type EditorLine, type EditorPart } from "@/varer/components/recipes/RecipePartCard";
import { ScalePanel } from "@/varer/components/recipes/ScalePanel";
import { PrintRecipeCardDialog } from "@/varer/components/recipes/PrintRecipeCardDialog";
import { ShareRecipeDialog } from "@/varer/components/recipes/ShareRecipeDialog";
import {
  RECIPE_STATUS_OPTIONS, computeTotals, roundBakerGrams, scaleFactor, scaleLines, scaledSummary,
  type BakersRawMaterial,
} from "@/varer/lib/bakers";
import {
  buildRecipePDFData, useRecipePDF, type BuildRecipePDFInput, type RecipeCardOptions,
} from "@/varer/hooks/useRecipePDF";
import { useUnsavedChangesWarning } from "@/varer/hooks/useUnsavedChangesWarning";
import { useComputeRecipeLabel } from "@/varer/hooks/useRecipeLabel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelTab } from "@/varer/components/recipes/label/LabelTab";
import { COARSE_CLASSIFICATIONS, SIFTED_CLASSIFICATIONS, type FlourLine } from "@/varer/lib/breadscale";

export default function RecipeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canWrite, legalEntityId } = useAppContext();
  const computeLabel = useComputeRecipeLabel();



  const recipeQuery = useQuery({
    queryKey: ["recipe-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("*, recipe_parts(*), recipe_lines(*), recipe_steps(*)")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const rmQuery = useQuery({
    queryKey: ["rm-bakers-map", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, category, grain_classification, water_content_pct, current_cost_price")
        .limit(2000);
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of (data ?? []) as any[]) map[r.id] = r;
      return map;
    },
  });
  const rmMap = rmQuery.data ?? {};

  const recipe = recipeQuery.data;

  const [header, setHeader] = useState<any>({});
  const [parts, setParts] = useState<EditorPart[]>([]);
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [steps, setSteps] = useState<EditorStep[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!recipe) return;
    setHeader({
      name: recipe.name ?? "",
      category: recipe.category ?? "",
      status: recipe.status ?? "draft",
      description: recipe.description ?? "",
      dough_piece_grams: (recipe as any).dough_piece_grams ?? "",
      dough_waste_pct: (recipe as any).dough_waste_pct ?? "",
      finished_weight_grams: (recipe as any).finished_weight_grams ?? "",
      measured_per_kg: (recipe as any).measured_per_kg ?? false,
      units_per_batch: recipe.units_per_batch ?? "",
      target_dough_temp_celsius: recipe.target_dough_temp_celsius,
      friction_factor_celsius: recipe.friction_factor_celsius,
      mixing_speed1_minutes: recipe.mixing_speed1_minutes ?? "",
      mixing_speed2_minutes: recipe.mixing_speed2_minutes ?? "",
      autolyse_minutes: recipe.autolyse_minutes ?? "",
      notes: recipe.notes ?? "",
    });
    setParts(
      [...(recipe.recipe_parts ?? [])]
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          sort_order: p.sort_order,
          instructions: p.instructions,
          prep_time_minutes: p.prep_time_minutes,
          rest_time_minutes: p.rest_time_minutes,
          part_type: p.part_type ?? "dough",
          preferment_kind: p.preferment_kind ?? null,
          target_temp_celsius: p.target_temp_celsius ?? null,
          ripe_time_hours: p.ripe_time_hours ?? null,
        })),
    );
    setLines(
      [...(recipe.recipe_lines ?? [])]
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((l: any) => ({ ...l, _rm: l.raw_material_id ? null : null })),
    );
    setSteps(
      [...(recipe.recipe_steps ?? [])]
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((s: any) => ({ ...s })),
    );
    setDirty(false);
  }, [recipe]);

  // Koble på råvaredata når kartet er lastet
  const hydratedLines = useMemo(
    () => lines.map((l) => ({ ...l, _rm: l._rm ?? (l.raw_material_id ? rmMap[l.raw_material_id] ?? null : null) })),
    [lines, rmMap],
  );

  /** Melinjer med kornklassifisering — brukes til bytteforslaget på Brødskala'n. */
  const flourLines = useMemo<FlourLine[]>(
    () =>
      hydratedLines
        .map((l: any) => ({
          raw_material_id: l.raw_material_id ?? null,
          name: l._rm?.name ?? l.ingredient_name ?? "Ukjent",
          grams: Number(l.quantity) || 0,
          classification: l._rm?.grain_classification ?? null,
          cereal_type: null,
        }))
        .filter(
          (l) =>
            l.classification &&
            [...SIFTED_CLASSIFICATIONS, ...COARSE_CLASSIFICATIONS].includes(l.classification),
        ),
    [hydratedLines],
  );

  const totals = useMemo(
    () => computeTotals(hydratedLines, Number(header.dough_piece_grams) || null),
    [hydratedLines, header.dough_piece_grams],
  );

  /** Sum deigvekt i gram — kun forhåndsvisning i nettleseren. */
  const doughGramsTotal = useMemo(
    () =>
      hydratedLines.reduce((sum, l: any) => {
        const q = Number(l.quantity) || 0;
        const u = String(l.unit ?? "g");
        if (u === "kg" || u === "liter") return sum + q * 1000;
        if (u === "g" || u === "ml") return sum + q;
        return sum;
      }, 0),
    [hydratedLines],
  );

  // ===== Skalering (kun visning — basen røres ikke) =====
  const baseUnits = useMemo(() => {
    const u = Number(header.units_per_batch) || 0;
    if (u > 0) return u;
    return totals.unitCount && totals.unitCount > 0 ? totals.unitCount : 1;
  }, [header.units_per_batch, totals.unitCount]);

  const [scaleInput, setScaleInput] = useState("");
  const [mixerCapacity, setMixerCapacity] = useState("");

  useEffect(() => {
    setScaleInput(String(baseUnits));
  }, [baseUnits, recipe?.id]);

  const desiredUnits = Number(scaleInput) || 0;
  const factor = scaleFactor(desiredUnits, baseUnits);
  const isScaled = Math.abs(factor - 1) > 0.0001;

  const scaleSummary = useMemo(
    () =>
      scaledSummary(
        hydratedLines,
        factor,
        Number(header.dough_piece_grams) || null,
        desiredUnits || baseUnits,
        Number(mixerCapacity) || null,
      ),
    [hydratedLines, factor, header.dough_piece_grams, desiredUnits, baseUnits, mixerCapacity],
  );

  /**
   * Linjene slik de vises. Ved skalering byttes gram ut med den avrundede
   * skalerte vekten, mens bakerprosenten låses til basisoppskriftens verdi.
   */
  const displayLines = useMemo<EditorLine[]>(() => {
    if (!isScaled) return hydratedLines;
    const scaled = scaleLines(hydratedLines, factor, totals.totalFlourG);
    return hydratedLines.map((l, i) => ({
      ...l,
      quantity: roundBakerGrams(scaled[i].exactGrams),
      unit: "g",
      _displayPercent: scaled[i].percent,
    }));
  }, [hydratedLines, isScaled, factor, totals.totalFlourG]);

  const displayTotals = isScaled ? scaleSummary.totals : totals;
  /** Skalert visning låser redigering — man skal ikke kunne lagre en skalert utgave. */
  const editable = canWrite && !isScaled;

  const prefermentTemp = useMemo(() => {
    const p = parts.find((x) => x.part_type === "preferment" && x.target_temp_celsius != null);
    return p?.target_temp_celsius ?? null;
  }, [parts]);

  // ===== PDF =====
  const { generating, printProductionSheet, printRecipeCard } = useRecipePDF();
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const buildPdfInput = useCallback(
    (includeCosts: boolean): BuildRecipePDFInput => ({
      name: header.name || recipe?.name || "Oppskrift",
      category: header.category || null,
      version: recipe?.version ?? null,
      description: header.description || null,
      imageUrl: recipe?.image_url ?? null,
      unitWeightGrams: Number(header.dough_piece_grams) || null,
      targetDoughTemp: header.target_dough_temp_celsius ?? null,
      frictionFactor: header.friction_factor_celsius ?? null,
      scaledUnits: scaleSummary.unitCount ?? desiredUnits ?? baseUnits,
      factor,
      parts: parts.map((p) => ({
        id: p.id,
        name: p.name,
        part_type: p.part_type,
        preferment_kind: p.preferment_kind,
        target_temp_celsius: p.target_temp_celsius,
        ripe_time_hours: p.ripe_time_hours,
        instructions: p.instructions,
      })),
      lines: hydratedLines,
      steps: steps.map((s) => ({
        step_type: s.step_type,
        title: s.title,
        instruction: s.instruction,
        duration_minutes: s.duration_minutes,
        temp_celsius: s.temp_celsius,
        humidity_pct: s.humidity_pct,
      })),
      includeCosts,
    }),
    [header, recipe, parts, hydratedLines, steps, factor, scaleSummary.unitCount, desiredUnits, baseUnits],
  );

  useUnsavedChangesWarning(dirty && canWrite);


  function patchHeader(patch: Record<string, any>) {
    setHeader((h: any) => ({ ...h, ...patch }));
    setDirty(true);
  }

  // ===== Deler =====
  function addPart(type = "dough") {
    setParts((ps) => [
      ...ps,
      {
        id: `new-part-${Date.now()}-${Math.random()}`,
        _new: true,
        name: type === "preferment" ? "Fordeig" : "Hoveddeig",
        sort_order: ps.length,
        instructions: null,
        prep_time_minutes: null,
        rest_time_minutes: null,
        part_type: type,
        preferment_kind: type === "preferment" ? "fordeig" : null,
        target_temp_celsius: null,
        ripe_time_hours: null,
      },
    ]);
    setDirty(true);
  }
  function updatePart(pid: string, patch: Partial<EditorPart>) {
    setParts((ps) => ps.map((p) => (p.id === pid ? { ...p, ...patch } : p)));
    setDirty(true);
  }
  function removePart(pid: string) {
    if (!confirm("Slett denne delen og alle linjene i den?")) return;
    setParts((ps) => ps.filter((p) => p.id !== pid).map((p, i) => ({ ...p, sort_order: i })));
    setLines((ls) => ls.filter((l) => l.recipe_part_id !== pid));
    setDirty(true);
  }
  function duplicatePart(pid: string) {
    const p = parts.find((x) => x.id === pid);
    if (!p) return;
    const newId = `new-part-${Date.now()}`;
    const idx = parts.findIndex((x) => x.id === pid);
    const dupLines = lines
      .filter((l) => l.recipe_part_id === pid)
      .map((l) => ({ ...l, id: `new-line-${Date.now()}-${Math.random()}`, _new: true, recipe_part_id: newId }));
    setParts([
      ...parts.slice(0, idx + 1),
      { ...p, id: newId, _new: true, name: `${p.name} (kopi)`, sort_order: idx + 1 },
      ...parts.slice(idx + 1),
    ].map((x, i) => ({ ...x, sort_order: i })));
    setLines([...lines, ...dupLines]);
    setDirty(true);
  }
  function movePart(pid: string, dir: -1 | 1) {
    const idx = parts.findIndex((p) => p.id === pid);
    const next = idx + dir;
    if (next < 0 || next >= parts.length) return;
    setParts(arrayMove(parts, idx, next).map((p, i) => ({ ...p, sort_order: i })));
    setDirty(true);
  }

  // ===== Linjer =====
  function addLine(partId: string) {
    const count = lines.filter((l) => l.recipe_part_id === partId).length;
    setLines((ls) => [
      ...ls,
      {
        id: `new-line-${Date.now()}-${Math.random()}`,
        _new: true,
        recipe_part_id: partId,
        raw_material_id: null,
        sub_product_id: null,
        ingredient_name: null,
        quantity: "",
        unit: "g",
        waste_percent: 0,
        sort_order: count,
        entry_mode: "grams",
        bakers_percent: null,
        is_flour_override: null,
        water_content_pct_override: null,
        include_in_declaration: true,
        is_quid_relevant: false,
        custom_declaration_text: null,
      } as EditorLine,
    ]);
    setDirty(true);
  }
  function updateLine(lid: string, patch: Partial<EditorLine>) {
    setLines((ls) => ls.map((l) => (l.id === lid ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function removeLine(lid: string) {
    setLines((ls) => ls.filter((l) => l.id !== lid));
    setDirty(true);
  }
  function reorderLines(partId: string, activeId: string, overId: string) {
    const partLines = lines.filter((l) => l.recipe_part_id === partId);
    const others = lines.filter((l) => l.recipe_part_id !== partId);
    const oldIdx = partLines.findIndex((l) => l.id === activeId);
    const newIdx = partLines.findIndex((l) => l.id === overId);
    setLines([...others, ...arrayMove(partLines, oldIdx, newIdx).map((l, i) => ({ ...l, sort_order: i }))]);
    setDirty(true);
  }

  async function save() {
    if (!recipe) return;
    setSaving(true);
    try {
      const { error: e1 } = await supabase
        .from("recipes")
        .update({
          name: header.name || null,
          category: header.category || null,
          status: header.status,
          description: header.description || null,
          notes: header.notes || null,
          dough_piece_grams: header.dough_piece_grams === "" ? null : Number(header.dough_piece_grams),
          dough_waste_pct: header.dough_waste_pct === "" ? null : Number(header.dough_waste_pct),
          finished_weight_grams: header.finished_weight_grams === "" ? null : Number(header.finished_weight_grams),
          measured_per_kg: !!header.measured_per_kg,
          units_per_batch: header.units_per_batch === "" ? null : Number(header.units_per_batch),
          target_dough_temp_celsius: header.target_dough_temp_celsius,
          friction_factor_celsius: header.friction_factor_celsius,
          mixing_speed1_minutes: header.mixing_speed1_minutes === "" ? null : Number(header.mixing_speed1_minutes),
          mixing_speed2_minutes: header.mixing_speed2_minutes === "" ? null : Number(header.mixing_speed2_minutes),
          autolyse_minutes: header.autolyse_minutes === "" ? null : Number(header.autolyse_minutes),
        } as never)
        .eq("id", recipe.id);
      if (e1) throw e1;

      // Deler: slett fjernede, insert nye, oppdater eksisterende
      const keptIds = parts.filter((p) => !p._new).map((p) => p.id);
      const originalIds = (recipe.recipe_parts ?? []).map((p: any) => p.id);
      const toDelete = originalIds.filter((pid: string) => !keptIds.includes(pid));
      if (toDelete.length) await supabase.from("recipe_parts").delete().in("id", toDelete);

      const partIdMap: Record<string, string> = {};
      for (const p of parts) {
        const payload = {
          name: p.name,
          sort_order: p.sort_order,
          instructions: p.instructions,
          prep_time_minutes: p.prep_time_minutes,
          rest_time_minutes: p.rest_time_minutes,
          part_type: p.part_type,
          preferment_kind: p.part_type === "preferment" ? p.preferment_kind : null,
          target_temp_celsius: p.target_temp_celsius,
          ripe_time_hours: p.ripe_time_hours,
        };
        if (p._new) {
          const { data, error } = await supabase
            .from("recipe_parts")
            .insert({ recipe_id: recipe.id, ...payload } as never)
            .select("id")
            .single();
          if (error) throw error;
          partIdMap[p.id] = data.id;
        } else {
          const { error } = await supabase.from("recipe_parts").update(payload as never).eq("id", p.id);
          if (error) throw error;
        }
      }

      const lineRows = lines
        .map((l) => {
          const partId = partIdMap[l.recipe_part_id] ?? l.recipe_part_id;
          const qty = Number(l.quantity) || 0;
          if (qty <= 0 && !l.raw_material_id && !(l as any).sub_product_id && !l.ingredient_name) return null;
          return {
            recipe_id: recipe.id,
            recipe_part_id: partId,
            raw_material_id: l.raw_material_id,
            sub_product_id: (l as any).sub_product_id ?? null,
            ingredient_name: l.raw_material_id ? null : (l.ingredient_name || null),
            quantity: qty,
            unit: l.unit,
            waste_percent: Number(l.waste_percent) || 0,
            sort_order: l.sort_order,
            notes: l.notes ?? null,
            entry_mode: l.entry_mode ?? "grams",
            bakers_percent: l.bakers_percent == null || l.bakers_percent === "" ? null : Number(l.bakers_percent),
            is_flour_override: l.is_flour_override ?? null,
            water_content_pct_override:
              l.water_content_pct_override == null || l.water_content_pct_override === ""
                ? null
                : Number(l.water_content_pct_override),
            include_in_declaration: l.include_in_declaration !== false,
            is_quid_relevant: !!l.is_quid_relevant,
            custom_declaration_text: l.custom_declaration_text || null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const { error: e2 } = await (supabase as any).rpc("replace_child_rows", {
        p_table: "recipe_lines",
        p_parent_column: "recipe_id",
        p_parent_id: recipe.id,
        p_rows: lineRows,
      });
      if (e2) throw e2;

      const stepRows = steps.map((s, i) => ({
        recipe_id: recipe.id,
        sort_order: i,
        step_type: s.step_type,
        title: s.title || null,
        instruction: s.instruction || null,
        duration_minutes: s.duration_minutes,
        temp_celsius: s.temp_celsius,
        humidity_pct: s.humidity_pct,
      }));
      const { error: e3 } = await (supabase as any).rpc("replace_child_rows", {
        p_table: "recipe_steps",
        p_parent_column: "recipe_id",
        p_parent_id: recipe.id,
        p_rows: stepRows,
      });
      if (e3) throw e3;

      await logAudit({
        action: "update",
        entity_type: "recipe",
        entity_id: recipe.id,
        entity_display_reference: header.name || recipe.name || recipe.id,
        changes: { parts: parts.length, lines: lines.length, steps: steps.length },
      });
      setDirty(false);
      toast.success("Oppskrift lagret");
      qc.invalidateQueries({ queryKey: ["recipe-detail", recipe.id] });
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      recipeQuery.refetch();
      // Merkedata (deklarasjon, næring, grovhet, Nøkkelhull) beregnes automatisk ved lagring
      computeLabel.mutate(recipe.id);

    } catch (err: any) {
      toast.error(err.message ?? "Kunne ikke lagre");
    } finally {
      setSaving(false);
    }
  }

  if (recipeQuery.isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!recipe) {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted-foreground">
        Fant ikke oppskriften.{" "}
        <button className="underline" onClick={() => navigate("/varer/oppskrifter")}>Tilbake til listen</button>
      </div>
    );
  }

  return (
    <>
      <AppHeaderBanner
        title={header.name || "Oppskrift"}
        subtitle={`v${recipe.version ?? 1}${header.category ? ` · ${header.category}` : ""}`}
      />
      <div className="space-y-4 px-6 py-6 pb-24">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/varer/oppskrifter")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Alle oppskrifter
          </Button>
          <Badge variant="outline">{RECIPE_STATUS_OPTIONS.find((s) => s.value === header.status)?.label ?? "Utkast"}</Badge>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => printProductionSheet(buildRecipePDFData(buildPdfInput(false)))}
            disabled={generating !== null}
          >
            {generating === "production" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
            Skriv ut produksjonsark
          </Button>
          <Button variant="outline" onClick={() => setCardDialogOpen(true)} disabled={generating !== null}>
            <FileText className="mr-2 h-4 w-4" /> Oppskriftskort
          </Button>
          <Button variant="outline" onClick={() => setShareOpen(true)}>
            <Share2 className="mr-2 h-4 w-4" /> Del
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              recipe &&
              computeLabel.mutate(recipe.id, {
                onSuccess: () => toast.success("Merkedata beregnet på nytt"),
              })
            }
            disabled={computeLabel.isPending}
          >
            {computeLabel.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
            Beregn på nytt
          </Button>



          {canWrite && (
            <Button onClick={save} disabled={saving || !dirty || isScaled}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Lagre
            </Button>
          )}
        </div>

        <Tabs defaultValue="oppskrift" className="space-y-4">
          <TabsList>
            <TabsTrigger value="oppskrift">Oppskrift</TabsTrigger>
            <TabsTrigger value="merking">Merking</TabsTrigger>
          </TabsList>

          <TabsContent value="merking" className="space-y-4">
            <LabelTab
              recipeId={recipe.id}
              recipeName={header.name || recipe.name || "Oppskrift"}
              recipe={recipe}
              flourLines={flourLines}
              legalEntityId={legalEntityId ?? undefined}
              canWrite={canWrite}
            />
          </TabsContent>

          <TabsContent value="oppskrift" className="space-y-4">
        <ScalePanel
          value={scaleInput}
          onChange={setScaleInput}
          baseUnits={baseUnits}
          mixerCapacity={mixerCapacity}
          onMixerCapacityChange={setMixerCapacity}
          summary={scaleSummary}
          isScaled={isScaled}
          onReset={() => setScaleInput(String(baseUnits))}
        />

        {isScaled && (
          <div className="flex items-center gap-2 rounded-md border border-app/40 bg-app/[0.06] px-3 py-2 text-sm">
            <Lock className="h-4 w-4 shrink-0 text-app" />
            <span>
              Du ser en <b>skalert utgave</b> ({scaleSummary.factor.toFixed(2).replace(".", ",")} ×). Bakerprosent,
              hydrering og saltprosent er uendret — bare gramvektene flytter seg. Oppskriften i basen er urørt, og
              redigering er låst til du tilbakestiller.
            </span>
          </div>
        )}

        <RecipeStatsBar totals={displayTotals} />


        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Oppskriftsinfo</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Label className="text-xs">Navn</Label>
              <Input value={header.name ?? ""} disabled={!editable} onChange={(e) => patchHeader({ name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Kategori</Label>
              <Input value={header.category ?? ""} disabled={!editable} placeholder="f.eks. Surdeigsbrød"
                onChange={(e) => patchHeader({ category: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <select
                value={header.status ?? "draft"} disabled={!editable}
                onChange={(e) => patchHeader({ status: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {RECIPE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="col-span-full mt-1 border-t pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Vekt og utbytte
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Deigemnevekt (g)</Label>
                  <Input type="number" value={header.dough_piece_grams ?? ""} disabled={!editable}
                    onChange={(e) => patchHeader({ dough_piece_grams: e.target.value })} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Vekten på deigemnet før steking. Denne styrer kalkylen.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Deigsvinn (%)</Label>
                  <Input type="number" value={header.dough_waste_pct ?? ""} disabled={!editable}
                    onChange={(e) => patchHeader({ dough_waste_pct: e.target.value })} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rester, avskjær, feilvekt og vraket bakst.
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Ferdigvekt (g)</Label>
                  <Input type="number" value={header.finished_weight_grams ?? ""} disabled={!editable}
                    onChange={(e) => patchHeader({ finished_weight_grams: e.target.value })} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Vekten etter steking. Brukes til deklarasjon og grovhet, ikke til kostprisen.
                  </p>
                </div>
              </div>
              <YieldPreview
                doughGrams={doughGramsTotal}
                doughPieceGrams={Number(header.dough_piece_grams) || null}
                doughWastePct={Number(header.dough_waste_pct) || 0}
                finishedWeightGrams={Number(header.finished_weight_grams) || null}
              />
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-input"
                  checked={!!header.measured_per_kg}
                  disabled={!editable}
                  onChange={(e) => patchHeader({ measured_per_kg: e.target.checked })}
                />
                <span>
                  Oppskriften er målt per kg
                  <span className="block text-xs font-normal text-muted-foreground">
                    For halvfabrikat som deig, krem og fyll. Sett deigemnevekt til 1000 g.
                  </span>
                </span>
              </label>
            </div>
            <div>
              <Label className="text-xs">Antall per batch</Label>
              <Input type="number" value={header.units_per_batch ?? ""} disabled={!editable}
                onChange={(e) => patchHeader({ units_per_batch: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Autolyse (min)</Label>
              <Input type="number" value={header.autolyse_minutes ?? ""} disabled={!editable}
                onChange={(e) => patchHeader({ autolyse_minutes: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Elting 1. gir (min)</Label>
                <Input type="number" value={header.mixing_speed1_minutes ?? ""} disabled={!editable}
                  onChange={(e) => patchHeader({ mixing_speed1_minutes: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">2. gir (min)</Label>
                <Input type="number" value={header.mixing_speed2_minutes ?? ""} disabled={!editable}
                  onChange={(e) => patchHeader({ mixing_speed2_minutes: e.target.value })} />
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Label className="text-xs">Beskrivelse</Label>
              <Textarea rows={2} value={header.description ?? ""} disabled={!editable}
                onChange={(e) => patchHeader({ description: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        <DoughTempPanel
          targetDoughTemp={header.target_dough_temp_celsius ?? null}
          frictionFactor={header.friction_factor_celsius ?? null}
          prefermentTemp={prefermentTemp}
          canWrite={canWrite}
          onChange={patchHeader}
        />

        <div className="space-y-3">
          {parts.map((p, i) => (
            <RecipePartCard
              key={p.id}
              part={p}
              lines={displayLines.filter((l) => l.recipe_part_id === p.id)}
              canWrite={editable}
              totalFlourG={isScaled ? displayTotals.totalFlourG : totals.totalFlourG}
              rmMap={rmMap}
              isFirst={i === 0}
              isLast={i === parts.length - 1}
              onUpdate={(patch) => updatePart(p.id, patch)}
              onRemove={() => removePart(p.id)}
              onDuplicate={() => duplicatePart(p.id)}
              onMove={(dir) => movePart(p.id, dir)}
              onAddLine={() => addLine(p.id)}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
              onReorderLines={reorderLines}
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

        <RecipeStepsEditor
          steps={steps}
          canWrite={editable}
          onChange={(s) => { setSteps(s); setDirty(true); }}
        />


        <RecipeProductLinks recipeId={recipe.id} currentProductId={recipe.product_id ?? undefined} canWrite={canWrite} />

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Notater</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={3} value={header.notes ?? ""} disabled={!editable}
              onChange={(e) => patchHeader({ notes: e.target.value })} />
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>
      </div>

      <PrintRecipeCardDialog
        open={cardDialogOpen}
        onOpenChange={setCardDialogOpen}
        hasImage={!!recipe.image_url}
        generating={generating === "card"}
        onPrint={(opts: RecipeCardOptions) => {
          printRecipeCard(buildRecipePDFData(buildPdfInput(opts.includeCosts)), opts);
          setCardDialogOpen(false);
        }}
      />

      <ShareRecipeDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        recipeId={recipe.id}
        recipeName={header.name || recipe.name || "Oppskrift"}
        canWrite={canWrite}
      />
    </>


  );
}

/** Forhåndsvisning av utbytte og steketap. Kun visning — kalkylen kommer fra product_cost. */
function YieldPreview({
  doughGrams,
  doughPieceGrams,
  doughWastePct,
  finishedWeightGrams,
}: {
  doughGrams: number;
  doughPieceGrams: number | null;
  doughWastePct: number;
  finishedWeightGrams: number | null;
}) {
  const nb = (n: number, d = 1) =>
    n.toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d });

  if (!doughPieceGrams || doughPieceGrams <= 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        Sett deigemnevekt for å beregne antall enheter
      </p>
    );
  }

  const units = (doughGrams * (1 - (doughWastePct || 0) / 100)) / doughPieceGrams;

  let bake: { pct: number; tone: "grey" | "warn" | "bad" } | null = null;
  if (finishedWeightGrams && finishedWeightGrams > 0) {
    const pct = (1 - finishedWeightGrams / doughPieceGrams) * 100;
    bake = {
      pct,
      tone: finishedWeightGrams > doughPieceGrams ? "bad" : pct < 3 || pct > 25 ? "warn" : "grey",
    };
  }

  return (
    <div className="mt-3 space-y-1">
      <p className="text-sm text-muted-foreground">
        {nb(doughGrams, 0)} g deig · {nb(doughWastePct || 0, 0)} % svinn · {nb(doughPieceGrams, 0)} g per emne →{" "}
        <span className="font-semibold text-foreground">{nb(units, 1)} enheter</span>
      </p>
      {bake && bake.tone === "grey" && (
        <p className="text-sm text-muted-foreground">
          Steketap <span className="font-semibold text-foreground">{nb(bake.pct, 1)} %</span>
        </p>
      )}
      {bake && bake.tone === "warn" && (
        <p className="flex items-center gap-1.5 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Steketap <span className="font-semibold">{nb(bake.pct, 1)} %</span> — Sjekk vektene, dette ser ikke ut som et vanlig steketap
        </p>
      )}
      {bake && bake.tone === "bad" && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Ferdigvekt kan ikke være høyere enn deigemnevekt
        </p>
      )}
    </div>
  );
}
