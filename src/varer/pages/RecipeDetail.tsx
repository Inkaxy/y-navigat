import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { AlertTriangle, ArrowLeft, Copy, FileText, Loader2, Lock, Package, Pencil, Plus, Printer, RefreshCw, Save, Share2, Wheat } from "lucide-react";
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
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/varer/components/products/detail/UnsavedChangesDialog";
import { useComputeRecipeLabel } from "@/varer/hooks/useRecipeLabel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelTab } from "@/varer/components/recipes/label/LabelTab";
import { COARSE_CLASSIFICATIONS, SIFTED_CLASSIFICATIONS, type FlourLine } from "@/varer/lib/breadscale";
import { SaveAsRawMaterialDialog, type CompositeRawMaterial } from "@/varer/components/recipes/SaveAsRawMaterialDialog";
import { RecipeImageUpload } from "@/varer/components/recipes/RecipeImageUpload";
import { BASE_RECIPE_CATEGORY, costPerKg } from "@/varer/lib/halvfabrikat";
import { copyRecipe } from "@/varer/lib/copyRecipe";
import { asDepartment, RECIPE_DEPARTMENT_LABEL, RECIPE_DEPARTMENTS } from "@/varer/lib/departments";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Redigerbare felter på oppskriftshodet — speiler `recipes`-kolonnene vi eier her. */
type HeaderState = {
  name: string;
  category: string;
  /** '' = ingen avdeling; ellers 'bakeri' | 'konditori'. */
  department: string;
  status: string;
  description: string;
  dough_piece_grams: number | string;
  dough_waste_pct: number | string;
  finished_weight_grams: number | string;
  measured_per_kg: boolean;
  units_per_batch: number | string;
  target_dough_temp_celsius: number | null;
  friction_factor_celsius: number | null;
  mixing_speed1_minutes: number | string;
  mixing_speed2_minutes: number | string;
  autolyse_minutes: number | string;
  notes: string;
  decor_notes: string;
};


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
        .select("id, name, category, grain_classification, water_content_pct, unit_weight_grams, current_cost_price, produced_by_recipe_id")
        .limit(2000);
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of (data ?? []) as any[]) map[r.id] = r;
      return map;
    },
  });
  const rmMap = rmQuery.data ?? {};

  /** Råvaren denne oppskriften eventuelt allerede er lagret som. */
  const compositeQuery = useQuery({
    queryKey: ["recipe-composite", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, sku, category, base_unit, current_cost_price")
        .eq("produced_by_recipe_id", id!)
        .maybeSingle();
      return (data ?? null) as CompositeRawMaterial | null;
    },
  });
  const composite = compositeQuery.data ?? null;

  /** Hvilke oppskrifter bruker denne grunnoppskriften som ingrediens? */
  const usedInQuery = useQuery({
    queryKey: ["recipe-used-in", composite?.id],
    enabled: !!composite?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("recipe_lines")
        .select("recipe_id, recipes(id, name)")
        .eq("raw_material_id", composite!.id);
      const seen = new Map<string, string>();
      for (const row of (data ?? []) as { recipe_id: string; recipes: { id: string; name: string | null } | null }[]) {
        if (row.recipes?.id && row.recipes.id !== id) seen.set(row.recipes.id, row.recipes.name || "Uten navn");
      }
      return Array.from(seen, ([rid, name]) => ({ id: rid, name }));
    },
  });
  const usedIn = usedInQuery.data ?? [];


  const recipe = recipeQuery.data;

  const [header, setHeader] = useState<Partial<HeaderState>>({});
  const [parts, setParts] = useState<EditorPart[]>([]);
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [steps, setSteps] = useState<EditorStep[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rawMatOpen, setRawMatOpen] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [copying, setCopying] = useState(false);
  /** Inline-redigering av tittelen øverst — samme felt som i Oppskriftsinfo. */
  const [titleEditing, setTitleEditing] = useState(false);
  /** Bekreftelse når grunnoppskrift slås AV mens en råvare er koblet. */
  const [baseOffOpen, setBaseOffOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  /** En fersk kopi åpnes rett i navneredigering (?rename=1). */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("rename") !== "1") return;
    setTitleEditing(true);
    const next = new URLSearchParams(searchParams);
    next.delete("rename");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  /** Grunnoppskrift: KATEGORIEN er sannheten. Råvare-koblingen er kun opplysning,
   *  ellers ville bryteren sprette på igjen så lenge en råvare finnes. */
  const isBaseRecipe = (header.category ?? "") === BASE_RECIPE_CATEGORY;




  useEffect(() => {
    if (!recipe) return;
    setHeader({
      name: recipe.name ?? "",
      category: recipe.category ?? "",
      department: asDepartment((recipe as { department?: string | null }).department) ?? "",
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
      decor_notes: (recipe as any).decor_notes ?? "",
    });
    setImageUrl(recipe.image_url ?? null);
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
  const [activeTab, setActiveTab] = useState(
    searchParams.get("tab") === "merking" ? "merking" : "oppskrift",
  );

  const buildPdfInput = useCallback(
    (includeCosts: boolean): BuildRecipePDFInput => ({
      name: header.name || recipe?.name || "Oppskrift",
      category: header.category || null,
      department: asDepartment(header.department),
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

  const unsavedGuard = useUnsavedChangesGuard(dirty && canWrite);


  function patchHeader(patch: Partial<HeaderState>) {
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
          department: header.department || null,
          status: header.status,
          description: header.description || null,
          notes: header.notes || null,
          decor_notes: header.decor_notes || null,
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
      // Grunnoppskrift: den koblede råvaren skal alltid ha fersk kilopris.
      void syncCompositePriceQuietly();


    } catch (err: any) {
      toast.error(err.message ?? "Kunne ikke lagre");
    } finally {
      setSaving(false);
    }
  }

  async function updateCompositePrice() {
    if (!composite) return;
    const price = costPerKg(hydratedLines);
    if (price == null) {
      toast.error("Fant ingen kostpriser å beregne fra");
      return;
    }
    setRepricing(true);
    const { error } = await supabase
      .from("raw_materials")
      .update({
        current_cost_price: price,
        price_source: "recipe",
        price_updated_at: new Date().toISOString(),
      } as never)
      .eq("id", composite.id);
    setRepricing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["recipe-composite", recipe?.id] });
    qc.invalidateQueries({ queryKey: ["raw_materials_autocomplete"] });
    toast.success(`Pris oppdatert: ${price.toFixed(2).replace(".", ",")} kr/kg`);
  }

  /** Stille prisoppdatering av den koblede grunnoppskrift-råvaren etter lagring. */
  async function syncCompositePriceQuietly() {
    if (!composite) return;
    const price = costPerKg(hydratedLines);
    if (price == null) return;
    const { error } = await supabase
      .from("raw_materials")
      .update({
        current_cost_price: price,
        price_source: "recipe",
        price_updated_at: new Date().toISOString(),
      } as never)
      .eq("id", composite.id);
    if (error) return;
    qc.invalidateQueries({ queryKey: ["recipe-composite", recipe?.id] });
    qc.invalidateQueries({ queryKey: ["raw_materials_autocomplete"] });
  }

  /** Lag kopi: ny oppskrift uten produktkoblinger, åpnet i navneredigering. */
  async function handleCopy() {
    if (!recipe) return;
    setCopying(true);
    try {
      const newId = await copyRecipe(recipe.id);
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Kopi opprettet");
      navigate(`/varer/oppskrifter/${newId}?rename=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke kopiere oppskriften");
    } finally {
      setCopying(false);
    }
  }

  /** Bryteren «Grunnoppskrift»: setter kategori og tilbyr råvare-kobling. */
  function toggleBaseRecipe(on: boolean) {
    if (on) {
      patchHeader({ category: BASE_RECIPE_CATEGORY });
      if (!composite) setRawMatOpen(true);
      return;
    }
    // Er en råvare koblet må brukeren si hva som skal skje med den.
    if (composite) {
      setBaseOffOpen(true);
      return;
    }
    if ((header.category ?? "") === BASE_RECIPE_CATEGORY) patchHeader({ category: "" });
  }

  /** Fjern kun merket — råvaren består og kan fortsatt brukes. */
  function clearBaseRecipeMark() {
    patchHeader({ category: "" });
    setBaseOffOpen(false);
  }

  /** Deaktiver den koblede råvaren. Aldri slett — den kan ligge i andre oppskrifter. */
  async function deactivateComposite() {
    if (!composite) return;
    setDeactivating(true);
    const { error } = await supabase
      .from("raw_materials")
      .update({ is_active: false } as never)
      .eq("id", composite.id);
    setDeactivating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    patchHeader({ category: "" });
    setBaseOffOpen(false);
    qc.invalidateQueries({ queryKey: ["recipe-composite", recipe?.id] });
    qc.invalidateQueries({ queryKey: ["raw_materials_autocomplete"] });
    qc.invalidateQueries({ queryKey: ["raw_materials"] });
    toast.success(`Råvaren «${composite.name}» er deaktivert`);
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
        {/* Navnet skal være åpenbart redigerbart — klikk på tittelen eller blyanten. */}
        <div className="flex flex-wrap items-center gap-2">
          {titleEditing && editable ? (
            <Input
              autoFocus
              value={header.name ?? ""}
              onChange={(e) => patchHeader({ name: e.target.value })}
              onBlur={() => setTitleEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") setTitleEditing(false);
              }}
              className="h-11 max-w-md text-xl font-semibold"
              placeholder="Navn på oppskriften"
            />
          ) : (
            <button
              type="button"
              onClick={() => editable && setTitleEditing(true)}
              className="group flex items-center gap-2 rounded-md px-1 text-left text-2xl font-semibold tracking-tight hover:bg-muted/50 disabled:cursor-default"
              disabled={!editable}
              title={editable ? "Klikk for å endre navnet" : undefined}
            >
              {header.name || "Uten navn"}
              {editable && <Pencil className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />}
            </button>
          )}
          {isBaseRecipe && (
            <Badge variant="outline" className="gap-1 border-app/50 text-app">
              <Wheat className="h-3.5 w-3.5" /> Grunnoppskrift
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/varer/oppskrifter")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Alle oppskrifter
          </Button>
          <Badge variant="outline">{RECIPE_STATUS_OPTIONS.find((s) => s.value === header.status)?.label ?? "Utkast"}</Badge>
          <div className="flex-1" />
          {canWrite && (
            <Button variant="outline" onClick={handleCopy} disabled={copying}>
              {copying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
              Lag kopi
            </Button>
          )}

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





          {canWrite && (
            <Button variant="outline" onClick={() => setRawMatOpen(true)}>
              <Package className="mr-2 h-4 w-4" /> Lagre som råvare
            </Button>
          )}
          {canWrite && (
            <Button onClick={save} disabled={saving || !dirty || isScaled}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Lagre
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
              onGoToRecipeTab={() => setActiveTab("oppskrift")}
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
            <div className="col-span-full flex flex-wrap items-start gap-4">
              <RecipeImageUpload
                recipeId={recipe.id}
                legalEntityId={legalEntityId ?? null}
                imageUrl={imageUrl}
                canWrite={canWrite}
                onChange={(url) => {
                  setImageUrl(url);
                  qc.invalidateQueries({ queryKey: ["recipes-list"] });
                }}
              />
              {composite && (
                <div className="flex items-center gap-2 rounded-md border border-app/40 bg-app/[0.06] px-3 py-2">
                  <Badge variant="outline" className="border-app/50 text-app">Halvfabrikat</Badge>
                  <span className="text-sm">
                    {composite.name}
                    <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                      {composite.current_cost_price != null
                        ? `${Number(composite.current_cost_price).toFixed(2).replace(".", ",")} kr/kg`
                        : "ingen pris"}
                    </span>
                  </span>
                  {canWrite && (
                    <Button size="sm" variant="ghost" disabled={repricing} onClick={updateCompositePrice}>
                      {repricing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                      Oppdater pris
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Grunnoppskrift — gjør oppskriften valgbar som ingredienslinje andre steder. */}
            <div className="col-span-full rounded-md border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  id="base-recipe"
                  checked={isBaseRecipe}
                  disabled={!editable}
                  onCheckedChange={toggleBaseRecipe}
                />
                <Label htmlFor="base-recipe" className="cursor-pointer text-sm font-medium">
                  Grunnoppskrift — kan brukes som linje i andre oppskrifter
                </Label>
                {composite ? (
                  <Badge variant="outline" className="border-app/50 text-app">Koblet råvare: {composite.name}</Badge>
                ) : isBaseRecipe ? (
                  <Badge variant="outline" className="border-warning/50 text-warning">Ingen råvare koblet ennå</Badge>
                ) : null}
              </div>
              {composite && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {usedIn.length === 0
                    ? "Brukes ikke i andre oppskrifter ennå."
                    : `Brukes i ${usedIn.length} oppskrift${usedIn.length === 1 ? "" : "er"}:`}
                  {usedIn.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="ml-2 underline underline-offset-2 hover:text-foreground"
                      onClick={() => navigate(`/varer/oppskrifter/${u.id}`)}
                    >
                      {u.name}
                    </button>
                  ))}
                </p>
              )}
            </div>

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
              <Label className="text-xs">Avdeling</Label>
              <select
                value={header.department ?? ""} disabled={!editable}
                onChange={(e) => patchHeader({ department: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Ingen</option>
                {RECIPE_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{RECIPE_DEPARTMENT_LABEL[d]}</option>
                ))}
              </select>
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
                    Vekt per stk etter steking — ganges med antall for deklarasjon og grovhet. Brukes ikke til kostprisen.
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
              currentRecipeId={recipe.id}
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
          <CardHeader className="pb-3"><CardTitle className="text-base">Dekor / ferdiggjøring</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={3}
              value={header.decor_notes ?? ""}
              disabled={!editable}
              placeholder="Pynt, glasur, strø, ferdiggjøring…"
              onChange={(e) => patchHeader({ decor_notes: e.target.value })}
            />
          </CardContent>
        </Card>

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

      <SaveAsRawMaterialDialog
        open={rawMatOpen}
        onOpenChange={setRawMatOpen}
        recipeId={recipe.id}
        recipeName={header.name || recipe.name || "Halvfabrikat"}
        legalEntityId={legalEntityId ?? null}
        lines={hydratedLines}
        existing={composite}
      />

      <AlertDialog open={baseOffOpen} onOpenChange={setBaseOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slå av grunnoppskrift?</AlertDialogTitle>
            <AlertDialogDescription>
              Råvaren «{composite?.name}» er koblet til denne oppskriften.
              {usedIn.length > 0 && (
                <>
                  {" "}
                  <b className="text-warning">
                    Den brukes i {usedIn.length} annen oppskrift{usedIn.length === 1 ? "" : "er"}
                  </b>{" "}
                  — deaktivering gjør at den ikke kan velges i nye linjer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel disabled={deactivating}>Avbryt</AlertDialogCancel>
            <Button variant="outline" disabled={deactivating} onClick={clearBaseRecipeMark}>
              Behold råvaren, fjern merket
            </Button>
            <AlertDialogAction
              disabled={deactivating}
              onClick={(e) => {
                e.preventDefault();
                void deactivateComposite();
              }}
            >
              {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deaktiver råvaren også
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShareRecipeDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        recipeId={recipe.id}
        recipeName={header.name || recipe.name || "Oppskrift"}
        canWrite={canWrite}
      />

      <UnsavedChangesDialog
        open={unsavedGuard.isBlocked}
        onConfirm={unsavedGuard.discard}
        onCancel={unsavedGuard.stay}
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
