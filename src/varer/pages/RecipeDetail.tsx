import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { RecipeStepsEditor } from "@/varer/components/recipes/RecipeStepsEditor";
import { StepTimeline } from "@/varer/components/recipes/StepTimeline";
import { RecipePartCard, type EditorLine, type EditorPart } from "@/varer/components/recipes/RecipePartCard";
import { RecipeWarningsBanner } from "@/varer/components/recipes/RecipeWarningsBanner";
import { DraftRecoveryBanner } from "@/varer/components/recipes/DraftRecoveryBanner";
import {
  useRecipeEditor, type RecipeDetailRow, type RecipeEditorState,
} from "@/varer/hooks/useRecipeEditor";
import { useRecipeDraft } from "@/varer/hooks/useRecipeDraft";
import { useRecipeWarnings } from "@/varer/hooks/useRecipeWarnings";
import { entryModeFor } from "@/varer/lib/percentFirst";
import { scaleRecipe, type RoundingStep, type ScaleMode } from "@/varer/lib/scaling";
import { ScalePanel } from "@/varer/components/recipes/ScalePanel";
import { PrintRecipeCardDialog } from "@/varer/components/recipes/PrintRecipeCardDialog";
import { ShareRecipeDialog } from "@/varer/components/recipes/ShareRecipeDialog";
import {
  RECIPE_STATUS_OPTIONS, computeTotalsForRecipe, lineToGrams, roundBakerGrams, scaleLines, scaledSummary,
  type BakersRawMaterial,
} from "@/varer/lib/bakers";
import { computeRecipeCost } from "@/varer/lib/recipeCost";
import { decideHydration } from "@/varer/lib/recipeEditorSync";
import { useRecipeSave, RecipeSaveConflictError } from "@/varer/hooks/useRecipeSave";
import {
  buildRecipePDFData, useRecipePDF, type BuildRecipePDFInput, type RecipeCardOptions,
} from "@/varer/hooks/useRecipePDF";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { osloTodayISO } from "@/lib/osloDate";
import { useRecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { UnsavedChangesDialog } from "@/varer/components/products/detail/UnsavedChangesDialog";
import { useComputeRecipeLabel } from "@/varer/hooks/useRecipeLabel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelTab } from "@/varer/components/recipes/label/LabelTab";
import {
  BRAN_CLASSIFICATIONS,
  COARSE_CLASSIFICATIONS,
  SIFTED_CLASSIFICATIONS,
  type FlourLine,
} from "@/varer/lib/breadscale";
import { SaveAsRawMaterialDialog, type CompositeRawMaterial } from "@/varer/components/recipes/SaveAsRawMaterialDialog";
import { RecipeImageUpload } from "@/varer/components/recipes/RecipeImageUpload";
import { BASE_RECIPE_CATEGORY, costPerKg, costPerKgBlockedReason } from "@/varer/lib/halvfabrikat";
import { copyRecipe } from "@/varer/lib/copyRecipe";
import { buildRestoreInput, type RecipeVersionRow } from "@/varer/lib/recipeVersions";
import { asDepartment, RECIPE_DEPARTMENT_LABEL, RECIPE_DEPARTMENTS } from "@/varer/lib/departments";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";


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
      return data as unknown as RecipeDetailRow | null;
    },
  });

  const rmQuery = useQuery({
    queryKey: ["rm-bakers-map", legalEntityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("raw_materials")
        .select("id, name, category, grain_classification, cereal_type, water_content_pct, unit_weight_grams, base_unit, current_cost_price, produced_by_recipe_id, density_g_per_ml, is_water")
        .limit(2000);
      const map: Record<string, BakersRawMaterial> = {};
      for (const r of (data ?? []) as BakersRawMaterial[]) map[r.id] = r;
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

  const editor = useRecipeEditor();
  const { header, parts, lines, steps, imageUrl, entryModes, dirty } = editor.state;
  const [saving, setSaving] = useState(false);
  /** Delen brukeren er i ferd med å slette — bekreftes i dialog, aldri med `confirm`. */
  const [partToDelete, setPartToDelete] = useState<EditorPart | null>(null);
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




  /** Versjonen som er hydrert inn i editoren nå — brukes til å oppdage at noen andre har lagret. */
  const loadedRef = useRef<{ id: string | null; updatedAt: string | null }>({ id: null, updatedAt: null });
  const [remoteConflict, setRemoteConflict] = useState(false);

  /** `dirty` endres av hvert tastetrykk og skal ikke utløse ny vurdering av serverdataene. */
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const hydrate = useCallback(
    (row: RecipeDetailRow) => {
      editor.hydrate(row);
      setRemoteConflict(false);
      loadedRef.current = { id: row.id ?? null, updatedAt: row.updated_at ?? null };
    },
    [editor],
  );

  useEffect(() => {
    if (!recipe) return;
    const decision = decideHydration({
      loadedRecipeId: loadedRef.current.id,
      loadedUpdatedAt: loadedRef.current.updatedAt,
      incomingRecipeId: recipe.id ?? null,
      incomingUpdatedAt: recipe.updated_at ?? null,
      dirty: dirtyRef.current,
    });
    if (decision === "hydrate") hydrate(recipe);
    else if (decision === "conflict") setRemoteConflict(true);
  }, [recipe, hydrate]);

  // Koble på råvaredata når kartet er lastet
  const hydratedLines = useMemo(
    () => lines.map((l) => ({ ...l, _rm: l._rm ?? (l.raw_material_id ? rmMap[l.raw_material_id] ?? null : null) })),
    [lines, rmMap],
  );

  /** Melinjer med kornklassifisering — brukes til bytteforslaget på Brødskala'n. */
  const flourLines = useMemo<FlourLine[]>(
    () =>
      hydratedLines
        .map((l) => ({
          raw_material_id: l.raw_material_id ?? null,
          name: l._rm?.name ?? l.ingredient_name ?? "Ukjent",
          // Samme enhetsmotor som resten av editoren — kg-linjer ble tidligere
          // regnet som gram og ga altfor lav grovhet.
          grams: lineToGrams(l).grams,
          classification: l._rm?.grain_classification ?? null,
          cereal_type: l._rm?.cereal_type ?? null,
        }))
        .filter(
          (l) =>
            l.classification &&
            [...SIFTED_CLASSIFICATIONS, ...COARSE_CLASSIFICATIONS, ...BRAN_CLASSIFICATIONS].includes(
              l.classification,
            ),
        ),
    [hydratedLines],
  );

  const totals = useMemo(
    () =>
      computeTotalsForRecipe(hydratedLines, {
        dough_piece_grams: header.dough_piece_grams ?? null,
        dough_waste_pct: header.dough_waste_pct ?? null,
        units_per_batch: header.units_per_batch ?? null,
      }),
    [hydratedLines, header.dough_piece_grams, header.dough_waste_pct, header.units_per_batch],
  );

  /** Sum deigvekt i gram — samme enhetsmotor som resten av siden. */
  const doughGramsTotal = totals.totalDoughG;

  /** Råvarekost for oppskriften slik den står i editoren. */
  const cost = useMemo(
    () => computeRecipeCost(hydratedLines, { unitCount: totals.unitCount, totalDoughG: totals.totalDoughG }),
    [hydratedLines, totals.unitCount, totals.totalDoughG],
  );

  // ===== Skalering (kun visning — basen røres ikke) =====
  const baseUnits = useMemo(() => {
    const u = Number(header.units_per_batch) || 0;
    if (u > 0) return u;
    return totals.unitCount && totals.unitCount > 0 ? totals.unitCount : 1;
  }, [header.units_per_batch, totals.unitCount]);

  const [scaleMode, setScaleMode] = useState<ScaleMode>("units");
  const [scaleInput, setScaleInput] = useState("");
  const [rounding, setRounding] = useState<RoundingStep>(1);
  const [scaleWaste, setScaleWaste] = useState("");

  useEffect(() => {
    setScaleInput(String(baseUnits));
    setScaleMode("units");
  }, [baseUnits, recipe?.id]);

  const desiredUnits = Number(scaleInput) || 0;

  /** Skaleringsmotoren eier regnestykket — siden viser bare resultatet. */
  const scaleResult = useMemo(
    () =>
      scaleRecipe(hydratedLines, {
        dough_piece_grams: header.dough_piece_grams ?? null,
        dough_waste_pct: header.dough_waste_pct ?? null,
        units_per_batch: header.units_per_batch ?? null,
      }, {
        mode: scaleMode,
        target: Number(scaleInput) || 0,
        rounding,
        wastePct: Number(scaleWaste) || 0,
      }),
    [hydratedLines, header.dough_piece_grams, header.dough_waste_pct, header.units_per_batch, scaleMode, scaleInput, rounding, scaleWaste],
  );

  const factor = scaleResult.factor;
  const isScaled = Math.abs(scaleResult.factor - 1) > 0.0001;

  const scaleSummary = useMemo(
    () =>
      scaledSummary(
        hydratedLines,
        factor,
        Number(header.dough_piece_grams) || null,
        desiredUnits || baseUnits,
        null,
      ),
    [hydratedLines, factor, header.dough_piece_grams, desiredUnits, baseUnits],
  );

  /**
   * Linjene slik de vises. Ved skalering byttes gram ut med den avrundede
   * skalerte vekten, mens bakerprosenten låses til basisoppskriftens verdi.
   */
  const displayLines = useMemo<EditorLine[]>(() => {
    if (!isScaled) return hydratedLines;
    const scaled = scaleLines(hydratedLines, factor, totals.totalFlourG);
    return hydratedLines.map((l, i) => {
      const s = scaled[i];
      // Ukjent omregning: behold mengde og enhet slik de står — 0 g ville vært
      // et oppdiktet produksjonstall.
      if (!s.exact) return { ...l, quantity: s.scaledQuantity, _displayPercent: null };
      return {
        ...l,
        quantity: roundBakerGrams(s.exactGrams),
        unit: "g",
        _displayPercent: s.percent,
      };
    });

  }, [hydratedLines, isScaled, factor, totals.totalFlourG]);

  const displayTotals = isScaled ? scaleSummary.totals : totals;
  /** Skalert visning låser redigering — man skal ikke kunne lagre en skalert utgave. */
  const editable = canWrite && !isScaled;

  /**
   * Autolagret utkast i nettleseren. Uten dette forsvinner arbeidet ved en
   * tilfeldig reload — og en oppskrift er mye skriving å gjøre om igjen.
   */
  const draft = useRecipeDraft<RecipeEditorState>({
    recipeId: recipe?.id ?? null,
    value: editor.state,
    dirty,
    baseUpdatedAt: recipe?.updated_at ?? null,
  });

  /** Live-advarsler: mangler som gjør oppskriften ubrukelig i produksjon eller på etikett. */
  const warnings = useRecipeWarnings({
    lines: hydratedLines,
    status: String(header.status ?? "draft"),
  });

  /**
   * Rom- og meltemperatur er arbeidsplassens verdier, ikke oppskriftens.
   * De lagres lokalt per oppskrift slik at både panelet og PDF-en viser de
   * faktiske tallene i stedet for 21 °C hver gang.
   */
  const tempStorageKey = id ? `nbhub:recipe-temps:${id}` : null;
  const [roomTemp, setRoomTemp] = useState(21);
  const [flourTemp, setFlourTemp] = useState(21);

  useEffect(() => {
    if (!tempStorageKey) return;
    try {
      const raw = window.localStorage.getItem(tempStorageKey);
      if (!raw) {
        setRoomTemp(21);
        setFlourTemp(21);
        return;
      }
      const parsed = JSON.parse(raw) as { roomTemp?: number; flourTemp?: number };
      setRoomTemp(Number.isFinite(Number(parsed.roomTemp)) ? Number(parsed.roomTemp) : 21);
      setFlourTemp(Number.isFinite(Number(parsed.flourTemp)) ? Number(parsed.flourTemp) : 21);
    } catch {
      setRoomTemp(21);
      setFlourTemp(21);
    }
  }, [tempStorageKey]);

  const persistTemps = useCallback(
    (next: { roomTemp: number; flourTemp: number }) => {
      if (!tempStorageKey) return;
      try {
        window.localStorage.setItem(tempStorageKey, JSON.stringify(next));
      } catch {
        // Full eller avslått lagring skal ikke stoppe redigeringen.
      }
    },
    [tempStorageKey],
  );

  const prefermentTemp = useMemo(() => {
    const p = parts.find((x) => x.part_type === "preferment" && x.target_temp_celsius != null);
    return p?.target_temp_celsius ?? null;
  }, [parts]);

  // ===== PDF =====
  const { generating, printProductionSheet, printRecipeCard } = useRecipePDF();
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [productionDialogOpen, setProductionDialogOpen] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [productionDate, setProductionDate] = useState(() => osloTodayISO());
  const [activeTab, setActiveTab] = useState(
    searchParams.get("tab") === "merking" ? "merking" : "oppskrift",
  );

  const labelCalculated = useRecipeLabelCalculated(recipe?.id);
  const allergens = useMemo(() => {
    const a = labelCalculated.data?.allergens;
    if (!a) return null;
    return [...(a.contains ?? []), ...(a.may_contain ?? []).map((x) => `${x} (kan inneholde)`)];
  }, [labelCalculated.data]);

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
      roomTemp,
      flourTemp,
      scaledUnits: scaleSummary.unitCount ?? desiredUnits ?? baseUnits,
      factor,
      unitsPerBatch: Number(header.units_per_batch) || null,
      batchId: batchId || null,
      productionDate: productionDate || null,
      allergens,
      parts: parts.map((p) => ({
        id: p.id,
        name: p.name,
        part_type: p.part_type,
        preferment_kind: p.preferment_kind,
        target_temp_celsius: p.target_temp_celsius,
        ripe_time_hours: p.ripe_time_hours,
        instructions: p.instructions,
        prep_time_minutes: p.prep_time_minutes,
        rest_time_minutes: p.rest_time_minutes,
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
    [
      header, recipe, parts, hydratedLines, steps, factor, scaleSummary.unitCount, desiredUnits, baseUnits,
      roomTemp, flourTemp, batchId, productionDate, allergens,
    ],
  );

  const unsavedGuard = useUnsavedChangesGuard(dirty && canWrite);


  const patchHeader = editor.patchHeader;
  const { addPart, updatePart, duplicatePart, movePart, addLine, updateLine, removeLine, reorderLines } = editor;

  /** Sletting av en del tar med seg linjene — det bekreftes i dialog. */
  function confirmRemovePart() {
    if (!partToDelete) return;
    editor.removePart(partToDelete.id);
    setPartToDelete(null);
  }

  const { save: persistRecipe } = useRecipeSave();

  /** Versjonshistorikk fra `recipe_versions` — nyeste først. */
  const versionsQuery = useQuery({
    queryKey: ["recipe-versions", recipe?.id],
    enabled: !!recipe?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_versions")
        .select("id, recipe_id, version, changed_at, changed_by, change_summary, diff, snapshot")
        .eq("recipe_id", recipe!.id)
        .order("version", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as RecipeVersionRow[];
    },
  });
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);

  /** Gjenoppretter et tidligere snapshot ved å sende det gjennom vanlig lagring. */
  const restoreVersion = useCallback(
    async (row: RecipeVersionRow) => {
      if (!recipe) return;
      setRestoringVersion(row.version);
      try {
        const input = buildRestoreInput(row.snapshot, {
          recipeId: recipe.id,
          updatedAt: loadedRef.current.updatedAt,
          version: row.version,
        });
        const result = await persistRecipe(input);
        loadedRef.current = { id: recipe.id, updatedAt: result.updatedAt };
        setRemoteConflict(false);
        toast.success(`Gjenopprettet versjon ${row.version}`);
        await qc.invalidateQueries({ queryKey: ["recipe-detail", recipe.id] });
        await qc.invalidateQueries({ queryKey: ["recipe-versions", recipe.id] });
      } catch (err) {
        if (err instanceof RecipeSaveConflictError) {
          setRemoteConflict(true);
        } else {
          toast.error(err instanceof Error ? err.message : "Kunne ikke gjenopprette versjonen");
        }
      } finally {
        setRestoringVersion(null);
      }
    },
    [recipe, persistRecipe, qc],
  );

  const save = useCallback(async () => {
    if (!recipe) return;
    setSaving(true);
    try {
      const result = await persistRecipe({
        recipeId: recipe.id,
        updatedAt: recipe.updated_at ?? null,
        displayName: header.name || recipe.name || recipe.id,
        header: {
          name: header.name,
          category: header.category,
          department: header.department,
          status: header.status,
          description: header.description,
          notes: header.notes,
          decor_notes: header.decor_notes,
          dough_piece_grams: header.dough_piece_grams,
          dough_waste_pct: header.dough_waste_pct,
          finished_weight_grams: header.finished_weight_grams,
          measured_per_kg: header.measured_per_kg,
          units_per_batch: header.units_per_batch,
          target_dough_temp_celsius: header.target_dough_temp_celsius ?? null,
          friction_factor_celsius: header.friction_factor_celsius ?? null,
          mixing_speed1_minutes: header.mixing_speed1_minutes,
          mixing_speed2_minutes: header.mixing_speed2_minutes,
          autolyse_minutes: header.autolyse_minutes,
          room_temp_celsius: header.room_temp_celsius ?? null,
          flour_temp_celsius: header.flour_temp_celsius ?? null,
          preferment_temp_celsius: header.preferment_temp_celsius ?? null,
          keyhole_group: header.keyhole_group ?? null,
          is_template: header.is_template ?? false,
        },
        parts,
        lines,
        steps,
      });
      editor.markSaved();
      loadedRef.current = { id: recipe.id, updatedAt: result.updatedAt };
      draft.clear();
      setRemoteConflict(false);
      toast.success(`Lagret – v${result.version}`);
      qc.invalidateQueries({ queryKey: ["recipe-detail", recipe.id] });
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      // Merkedata (deklarasjon, næring, grovhet, Nøkkelhull) beregnes automatisk ved lagring
      computeLabel.mutate(recipe.id);
      // Grunnoppskrift: den koblede råvaren skal alltid ha fersk kilopris.
      void syncCompositePriceQuietly();
    } catch (err) {
      if (err instanceof RecipeSaveConflictError) {
        setRemoteConflict(true);
      } else {
        toast.error(err instanceof Error ? err.message : "Kunne ikke lagre oppskriften");
      }
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, header, parts, lines, steps, persistRecipe, qc, editor, draft]);

  /** Ctrl/Cmd + S lagrer, som i alle andre editorer. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (editable && dirty && !saving) void save();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, dirty, saving, save]);

  async function updateCompositePrice() {
    if (!composite) return;
    const price = costPerKg(hydratedLines);
    if (price == null) {
      toast.error(costPerKgBlockedReason(hydratedLines) ?? "Fant ingen kostpriser å beregne fra");
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

  /** Lagre som mal: kopien merkes med malkategorien og kan brukes som startpunkt. */
  async function handleSaveAsTemplate() {
    if (!recipe) return;
    setCopying(true);
    try {
      const newId = await copyRecipe(recipe.id);
      const { error } = await supabase
        .from("recipes")
        .update({ is_template: true } as never)
        .eq("id", newId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Malen er lagret");
      navigate(`/varer/oppskrifter/${newId}?rename=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre malen");
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
          {canWrite && (
            <Button variant="outline" onClick={handleSaveAsTemplate} disabled={copying}>
              <FileText className="mr-2 h-4 w-4" /> Lagre som mal
            </Button>
          )}

          <Button
            variant="outline"
            onClick={() => setProductionDialogOpen(true)}
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
          mode={scaleMode}
          onModeChange={(m) => {
            setScaleMode(m);
            setScaleInput(m === "units" ? String(baseUnits) : m === "batches" ? "60" : String(Math.round(totals.totalDoughG)));
          }}
          target={scaleInput}
          onTargetChange={setScaleInput}
          rounding={rounding}
          onRoundingChange={setRounding}
          waste={scaleWaste}
          onWasteChange={setScaleWaste}
          result={scaleResult}
          baseUnits={baseUnits}
          isScaled={isScaled}
          onReset={() => {
            setScaleMode("units");
            setScaleInput(String(baseUnits));
            setScaleWaste("");
          }}
          onSaveAsNew={canWrite ? handleCopy : undefined}
          savingAsNew={copying}
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

        {remoteConflict && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="flex-1">
              Oppskriften er endret av noen andre etter at du begynte å redigere. Endringene dine er beholdt.
              Lagrer du nå, overskriver du den nyere versjonen.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (recipe) hydrate(recipe);
              }}
            >
              Hent nyeste og forkast mine endringer
            </Button>
          </div>
        )}
        {draft.pending && editable && (
          <DraftRecoveryBanner
            savedAtLabel={draft.savedAtLabel}
            conflict={draft.conflict}
            onRestore={() => {
              editor.restore(draft.pending!.data);
              draft.accept();
            }}
            onDiscard={draft.discard}
          />
        )}

        <RecipeWarningsBanner warnings={warnings.warnings} />

        <RecipeStatsBar totals={displayTotals} cost={isScaled ? undefined : cost} />


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
                  editor.setImage(url);
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
          roomTemp={roomTemp}
          flourTemp={flourTemp}
          onRoomTempChange={(v) => {
            setRoomTemp(v);
            persistTemps({ roomTemp: v, flourTemp });
          }}
          onFlourTempChange={(v) => {
            setFlourTemp(v);
            persistTemps({ roomTemp, flourTemp: v });
          }}
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
              onRemove={() => setPartToDelete(p)}
              onDuplicate={() => duplicatePart(p.id)}
              onMove={(dir) => movePart(p.id, dir)}
              onAddLine={() => addLine(p.id)}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
              onReorderLines={reorderLines}
              entryMode={entryModeFor(entryModes, p.id)}
              onEntryModeChange={(mode) => editor.setEntryMode(p.id, mode)}
              warningsByLine={warnings.byLine}
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

        <StepTimeline
          steps={steps}
          header={{
            autolyse_minutes: header.autolyse_minutes ?? null,
            mixing_speed1_minutes: header.mixing_speed1_minutes ?? null,
            mixing_speed2_minutes: header.mixing_speed2_minutes ?? null,
          }}
        />

        <RecipeStepsEditor
          steps={steps}
          canWrite={editable}
          onChange={editor.setSteps}
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

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Versjonshistorikk</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {versionsQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Laster versjoner…</p>
            )}
            {!versionsQuery.isLoading && (versionsQuery.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Ingen tidligere versjoner ennå.</p>
            )}
            {(versionsQuery.data ?? []).map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">v{v.version}</span>{" "}
                  <span className="text-muted-foreground">
                    {new Date(v.changed_at).toLocaleString("nb-NO")}
                  </span>
                  {v.change_summary && (
                    <div className="text-muted-foreground">{v.change_summary}</div>
                  )}
                </div>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoringVersion !== null}
                    onClick={() => restoreVersion(v)}
                  >
                    {restoringVersion === v.version ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Gjenopprett
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={productionDialogOpen} onOpenChange={setProductionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skriv ut produksjonsark</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="production-batch-id">Batch-id</Label>
              <Input
                id="production-batch-id"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="Valgfritt"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="production-date">Produksjonsdato</Label>
              <Input
                id="production-date"
                type="date"
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductionDialogOpen(false)}>Avbryt</Button>
            <Button
              onClick={() => {
                printProductionSheet(buildRecipePDFData(buildPdfInput(false)));
                setProductionDialogOpen(false);
              }}
              disabled={generating !== null}
            >
              {generating === "production" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              Skriv ut
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <AlertDialog open={partToDelete !== null} onOpenChange={(open) => { if (!open) setPartToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slette «{partToDelete?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Delen og alle ingredienslinjene i den fjernes fra editoren. Ingenting slettes i basen før du lagrer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemovePart}>Slett del</AlertDialogAction>
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
