import { useKeepCostFresh } from "@/varer/hooks/useKeepCostFresh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listReturnHref, RETURN_PARAM } from "@/varer/lib/listReturn";
import { RecipeSectionNav, StickySaveBar, useAnchorRef } from "@/varer/components/recipes/editor/RecipeSections";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAppContext } from "@/varer/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { saveAsHalvfabrikat } from "@/varer/lib/saveAsHalvfabrikat";
import { AlertTriangle, ArrowLeft, Copy, FileText, Loader2, Lock, MoreHorizontal, Package, Pencil, Printer, Layers, Save, Share2, Wheat } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logAudit } from "@/varer/lib/audit";
import { RecipeStatsBar } from "@/varer/components/recipes/RecipeStatsBar";
import { type EditorLine, type EditorPart } from "@/varer/components/recipes/RecipePartCard";
import { DraftRecoveryBanner } from "@/varer/components/recipes/DraftRecoveryBanner";
import {
  useRecipeEditor, type RecipeDetailRow, type RecipeEditorState,
} from "@/varer/hooks/useRecipeEditor";
import { useRecipeDraft } from "@/varer/hooks/useRecipeDraft";
import { useRecipeWarnings } from "@/varer/hooks/useRecipeWarnings";
import { scaleRecipe, type RoundingStep, type ScaleMode } from "@/varer/lib/scaling";
import { ScalePanel } from "@/varer/components/recipes/ScalePanel";
import { PrintRecipeCardDialog } from "@/varer/components/recipes/PrintRecipeCardDialog";
import { ShareRecipeDialog } from "@/varer/components/recipes/ShareRecipeDialog";
import {
  RECIPE_STATUS_OPTIONS, computePartSummary, computeTotalsForRecipe, lineToGrams, roundBakerGrams, scaleLines, scaledSummary,
} from "@/varer/lib/bakers";
import { computeRecipeCost } from "@/varer/lib/recipeCost";
import { BAKERS_RM_KEY, fetchBakersRawMaterials } from "@/varer/lib/bakersRawMaterials";
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
import { LabelTab } from "@/varer/components/recipes/label/LabelTab";
import { resolveFinalWeight } from "@/varer/lib/units-recipe";
import type { RecipeBasisInput } from "@/varer/lib/recipeLinkBasis";
import {
  BRAN_CLASSIFICATIONS,
  COARSE_CLASSIFICATIONS,
  SIFTED_CLASSIFICATIONS,
  type FlourLine,
} from "@/varer/lib/breadscale";
import { SaveAsRawMaterialDialog, type CompositeRawMaterial } from "@/varer/components/recipes/SaveAsRawMaterialDialog";
import { BASE_RECIPE_CATEGORY, costPerKg, costPerKgBlockedReason } from "@/varer/lib/halvfabrikat";
import { copyRecipe } from "@/varer/lib/copyRecipe";
import { useProductMargins } from "@/varer/hooks/useProductCalc";
import { makeSku } from "@/varer/lib/halvfabrikat";
import { buildRestoreInput, type RecipeVersionRow } from "@/varer/lib/recipeVersions";
import { asDepartment } from "@/varer/lib/departments";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRecipeProductLinks } from "@/varer/hooks/useRecipeProductLinks";
import { orderLinks, useRecipeOverview } from "@/varer/hooks/useRecipeOverview";
import { useRecipeTab } from "@/varer/hooks/useRecipeTab";
import { useRecipeTabFocus } from "@/varer/hooks/useRecipeTabFocus";
import { useMatchMedia } from "@/varer/hooks/useIsDesktop";
import { salesUnitWeight } from "@/varer/lib/salesUnitPrice";
import { recipeTabForAnchor } from "@/varer/lib/recipeTabs";
import { RecipeTabBar } from "@/varer/components/recipes/detail/RecipeTabBar";
import { RecipeRemainingPanel } from "@/varer/components/recipes/detail/RecipeRemainingPanel";
import { RecipeKeyFigures } from "@/varer/components/recipes/detail/RecipeKeyFigures";
import { RecipeIngredientsSection } from "@/varer/components/recipes/detail/RecipeIngredientsSection";
import { RecipeInfoSection } from "@/varer/components/recipes/detail/RecipeInfoSection";
import { RecipeProcessTab } from "@/varer/components/recipes/detail/RecipeProcessTab";
import { RecipeProductsTab } from "@/varer/components/recipes/detail/RecipeProductsTab";
import { RecipeHistoryTab } from "@/varer/components/recipes/detail/RecipeHistoryTab";


export default function RecipeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useKeepCostFresh();
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
    queryKey: BAKERS_RM_KEY(legalEntityId),
    enabled: !!legalEntityId,
    queryFn: () => fetchBakersRawMaterials(legalEntityId),
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

  /** Koblede varer — samme spørring og skriveveier som før (`addLink`/`removeLink` + `afterLinkChange`). */
  const productLinks = useRecipeProductLinks(id ?? "", legalEntityId);
  /** Primærvaren (eller første kobling) — gir dekningsgraden til varselet om lav margin. */
  const primaryLink = useMemo(() => orderLinks(productLinks.linksQuery.data ?? [])[0] ?? null, [productLinks.linksQuery.data]);
  const marginsQuery = useProductMargins(primaryLink?.product_id ?? null);
  const marginPct = marginsQuery.data?.levels?.find((l) => l.price_level === "utsalg")?.dg2_pct ?? null;
  const marginTargetPct = marginsQuery.data?.levels?.find((l) => l.price_level === "utsalg")?.target_dg2_pct ?? null;


  const recipe = recipeQuery.data;

  const editor = useRecipeEditor();
  const { header, parts, lines, steps, imageUrl, entryModes, dirty } = editor.state;
  const [saving, setSaving] = useState(false);
  /** Delen brukeren er i ferd med å slette — bekreftes i dialog, aldri med `confirm`. */
  const [partToDelete, setPartToDelete] = useState<EditorPart | null>(null);
  const [rawMatOpen, setRawMatOpen] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [savingHalvfabrikat, setSavingHalvfabrikat] = useState(false);
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
  /** Tilbake til samme listevalg; kun oppskriftslisten er et gyldig mål. */
  const backHref = listReturnHref("recipes", searchParams.get(RETURN_PARAM));
  const [scaleOpen, setScaleOpen] = useState(false);
  const saveAnchorRef = useAnchorRef<HTMLDivElement>();




  /** Versjonen som er hydrert inn i editoren nå — brukes til å oppdage at noen andre har lagret. */
  const loadedRef = useRef<{ id: string | null; updatedAt: string | null }>({ id: null, updatedAt: null });
  const [remoteConflict, setRemoteConflict] = useState(false);

  /** `dirty` endres av hvert tastetrykk og skal ikke utløse ny vurdering av serverdataene. */
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Merk: `editor` er et nytt objekt ved hver render. Vi avhenger derfor bare av
  // den stabile `editor.hydrate`, ellers kjører hydreringen i evig løkke.
  const editorHydrate = editor.hydrate;
  const hydrate = useCallback(
    (row: RecipeDetailRow) => {
      editorHydrate(row);
      setRemoteConflict(false);
      loadedRef.current = { id: row.id ?? null, updatedAt: row.updated_at ?? null };
    },
    [editorHydrate],
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

  /** Utbytte til forslag om nettovekt per vare i Merking (samme motor som varekortet). */
  const labelBasisInput = useMemo<RecipeBasisInput | null>(() => {
    if (!recipe) return null;
    const final = resolveFinalWeight(recipe, totals.totalDoughG);
    return {
      unitCount: totals.unitCount,
      totalDoughG: totals.totalDoughG,
      // Bare dokumentert ferdigvekt; ellers foreslås deigvekt per emne.
      finalWeightG: final.source ? final.grams : null,
      pieceWeightG: Number(header.dough_piece_grams) || recipe.unit_weight_grams || null,
    };
  }, [recipe, totals.unitCount, totals.totalDoughG, header.dough_piece_grams]);

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
    marginPct,
    marginTargetPct,
  });

  /** «Gjenstår», fanemerker og lønnsomhet per koblet vare. */
  const overview = useRecipeOverview({
    recipeId: recipe?.id,
    recipeName: header.name || recipe?.name || "Oppskrift",
    recipe,
    legalEntityId,
    warnings,
    cost,
    totals: isScaled ? scaleSummary.totals : totals,
    links: productLinks.linksQuery,
  });
  const primaryRow = overview.profitRows[0] ?? null;
  const primaryInfo = {
    name: primaryRow?.link.products?.display_name ?? "Primærvaren",
    state: primaryRow ? primaryRow.state : productLinks.linksQuery.isLoading ? ("loading" as const) : productLinks.linksQuery.isError ? ("error" as const) : ("none" as const),
    margins: primaryRow?.margins,
    weight: salesUnitWeight(primaryRow?.link ?? null, primaryRow?.link.products ?? null),
  };

  /**
   * Rom- og meltemperatur er arbeidsplassens verdier, ikke oppskriftens.
   * De lagres lokalt per oppskrift slik at både panelet og PDF-en viser de
   * faktiske tallene i stedet for 21 °C hver gang.
   */
  const tempStorageKey = legalEntityId ? `nbhub:recipe-temps:${legalEntityId}` : null;
  const [roomTemp, setRoomTemp] = useState(21);
  const [flourTemp, setFlourTemp] = useState(21);

  useEffect(() => {
    // Oppskriften har allerede lagrede temperaturer — de er sannheten, ikke localStorage.
    if (header.room_temp_celsius != null || header.flour_temp_celsius != null) {
      setRoomTemp(header.room_temp_celsius != null ? Number(header.room_temp_celsius) : 21);
      setFlourTemp(header.flour_temp_celsius != null ? Number(header.flour_temp_celsius) : 21);
      return;
    }
    // Ny/ubrukt oppskrift: localStorage er bare et forslag, lagret per selskap.
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
  }, [tempStorageKey, header.room_temp_celsius, header.flour_temp_celsius]);

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

  const prefermentTemp = header.preferment_temp_celsius != null ? Number(header.preferment_temp_celsius) : null;

  /** Fordeigens vekt — summen av linjene i delene med `part_type = 'preferment'`. */
  const prefermentGrams = useMemo(() => {
    const prefPartIds = new Set(parts.filter((p) => p.part_type === "preferment").map((p) => p.id));
    const prefLines = hydratedLines.filter((l) => prefPartIds.has(l.recipe_part_id));
    return computePartSummary(prefLines, totals.totalFlourG).totalG;
  }, [parts, hydratedLines, totals.totalFlourG]);

  /** Andel av total melvekt som ligger i fordeig(er) — vises i statuslinjen. */
  const prefermentedFlourPct = useMemo(() => {
    const prefPartIds = new Set(parts.filter((p) => p.part_type === "preferment").map((p) => p.id));
    if (prefPartIds.size === 0) return null;
    const prefLines = hydratedLines.filter((l) => prefPartIds.has(l.recipe_part_id));
    return computePartSummary(prefLines, totals.totalFlourG).prefermentedFlourPct;
  }, [parts, hydratedLines, totals.totalFlourG]);

  // ===== PDF =====
  const { generating, printProductionSheet, printRecipeCard } = useRecipePDF();
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [productionDialogOpen, setProductionDialogOpen] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [productionDate, setProductionDate] = useState(() => osloTodayISO());
  const [activeTab, setActiveTab] = useRecipeTab();
  const tabFocus = useRecipeTabFocus(activeTab, setActiveTab);
  const wide = useMatchMedia("(min-width: 1280px)");

  // Gamle lenker med `#seksjon-*` åpner riktig fane.
  const goToAnchor = tabFocus.goToAnchor;
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && recipeTabForAnchor(hash)) goToAnchor(hash);
  }, [goToAnchor]);

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
      scaleResult: isScaled ? { mode: scaleResult.mode, batchCount: scaleResult.batchCount, perBatch: scaleResult.perBatch } : null,
    }),
    [
      header, recipe, parts, hydratedLines, steps, factor, scaleSummary.unitCount, desiredUnits, baseUnits,
      roomTemp, flourTemp, batchId, productionDate, allergens, isScaled, scaleResult,
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

  /** Stille prisoppdatering av den koblede grunnoppskrift-råvaren etter lagring. */
  const syncCompositePriceQuietly = useCallback(async () => {
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
    qc.invalidateQueries({ queryKey: ["rm-bakers-map"] });
    qc.invalidateQueries({ queryKey: ["raw_materials"] });
  }, [composite, hydratedLines, qc, recipe?.id]);

  const save = useCallback(async () => {
    if (!recipe) return;
    setSaving(true);
    try {
      const result = await persistRecipe({
        recipeId: recipe.id,
        // Vår EGEN siste lagring er sannheten for den optimistiske låsen. Bruker vi
        // `recipe.updated_at` før refetchen har landet, meldes vår egen lagring som
        // «endret av noen andre».
        updatedAt: loadedRef.current.updatedAt ?? recipe.updated_at ?? null,
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
      qc.invalidateQueries({ queryKey: ["product-cost"] });
      qc.invalidateQueries({ queryKey: ["product-margins"] });
      qc.invalidateQueries({ queryKey: ["profitability-sheet"] });
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
  }, [recipe, header, parts, lines, steps, persistRecipe, qc, editor, draft, computeLabel, syncCompositePriceQuietly]);

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
    qc.invalidateQueries({ queryKey: ["rm-bakers-map"] });
    qc.invalidateQueries({ queryKey: ["raw_materials"] });
    toast.success(`Pris oppdatert: ${price.toFixed(2).replace(".", ",")} kr/kg`);
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

  /**
   * «Bruk som ny oppskrift»: kopien lagres med de SKALERTE mengdene
   * (perBatch × antall satser), i gram der linjen kunne regnes om.
   */
  async function handleSaveScaledAsNew() {
    if (!recipe) return;
    if (!isScaled) {
      await handleCopy();
      return;
    }
    setCopying(true);
    try {
      const lineOverrides: Record<string, { quantity: number; unit: string }> = {};
      for (const l of scaleResult.perBatch) {
        lineOverrides[l.lineId] = l.grams != null
          ? { quantity: l.grams * scaleResult.batchCount, unit: "g" }
          : { quantity: l.quantity * scaleResult.batchCount, unit: l.unit };
      }
      const recipePatch: Record<string, unknown> = {};
      if (scaleResult.unitCount != null && scaleResult.unitCount > 0) {
        recipePatch.units_per_batch = Math.round(scaleResult.unitCount);
      }
      const piece = Number(header.dough_piece_grams) || 0;
      if (piece > 0) recipePatch.dough_piece_grams = piece;

      const newId = await copyRecipe(recipe.id, {
        lineOverrides,
        recipePatch,
        nameSuffix: "(skalert)",
      });
      qc.invalidateQueries({ queryKey: ["recipes-list"] });
      toast.success("Skalert oppskrift lagret");
      navigate(`/varer/oppskrifter/${newId}?rename=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre den skalerte oppskriften");
    } finally {
      setCopying(false);
    }
  }

  /** Lagre som halvfabrikat: eget produkt som andre oppskrifter kan bruke. */
  async function handleSaveAsHalvfabrikat() {
    if (!recipe || !legalEntityId) return;
    setSavingHalvfabrikat(true);
    try {
      const productId = await saveAsHalvfabrikat({
        recipeId: recipe.id,
        recipeName: header.name || recipe.name || "Halvfabrikat",
        legalEntityId,
      });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["recipe-linked-products", recipe.id] });
      qc.invalidateQueries({ queryKey: ["halvfabrikat_autocomplete"] });
      toast.success("Halvfabrikatet er lagret");
      navigate(`/varer/vareliste/${productId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre halvfabrikatet");
    } finally {
      setSavingHalvfabrikat(false);
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
        <Link className="underline" to={backHref}>Tilbake til alle oppskrifter</Link>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 px-6 py-5 pb-24">
        {/* Én kompakt oppskriftsheader: navn, versjon, oppskriftsstatus og handlinger. */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-subtle pb-3">
          <Button variant="ghost" size="icon" aria-label="Tilbake til alle oppskrifter" asChild>
            <Link to={backHref} state={{ focusId: recipe.id }}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          {titleEditing && editable ? (
            <Input
              autoFocus
              aria-label="Navn på oppskriften"
              value={header.name ?? ""}
              onChange={(e) => patchHeader({ name: e.target.value })}
              onBlur={() => setTitleEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") setTitleEditing(false);
              }}
              className="h-10 max-w-md text-lg font-semibold"
              placeholder="Navn på oppskriften"
            />
          ) : (
            <h1 className="min-w-0">
              <button
                type="button"
                onClick={() => editable && setTitleEditing(true)}
                className="group flex items-center gap-2 rounded-md px-1 text-left text-xl font-semibold tracking-tight hover:bg-muted/50 disabled:cursor-default"
                disabled={!editable}
                title={editable ? "Klikk for å endre navnet" : undefined}
              >
                <span className="truncate">{header.name || "Uten navn"}</span>
                {editable && <Pencil className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" />}
              </button>
            </h1>
          )}
          <span className="text-sm text-muted-foreground tabular-nums">
            v{recipe.version ?? 1}{header.category ? ` · ${header.category}` : ""}
          </span>
          <Badge variant="outline" title="Oppskriftsstatus (ikke merkestatus)">
            {RECIPE_STATUS_OPTIONS.find((s) => s.value === header.status)?.label ?? "Utkast"}
          </Badge>
          {isBaseRecipe && (
            <Badge variant="outline" className="gap-1 border-app/50 text-app">
              <Wheat className="h-3.5 w-3.5" /> Grunnoppskrift
            </Badge>
          )}
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={generating !== null || copying || savingHalvfabrikat}>
                {generating !== null || copying || savingHalvfabrikat ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="mr-2 h-4 w-4" />
                )}
                Flere handlinger
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => setProductionDialogOpen(true)}>
                <Printer className="mr-2 h-4 w-4" /> Skriv ut produksjonsark
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCardDialogOpen(true)}>
                <FileText className="mr-2 h-4 w-4" /> Oppskriftskort
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 className="mr-2 h-4 w-4" /> Del
              </DropdownMenuItem>
              {canWrite && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleCopy()}>
                    <Copy className="mr-2 h-4 w-4" /> Lag kopi
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleSaveAsTemplate()}>
                    <FileText className="mr-2 h-4 w-4" /> Lagre som mal
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRawMatOpen(true)}>
                    <Package className="mr-2 h-4 w-4" /> Lagre som råvare
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleSaveAsHalvfabrikat()}>
                    <Layers className="mr-2 h-4 w-4" /> Lagre som halvfabrikat
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {canWrite && (
            <div ref={saveAnchorRef}>
            <Button onClick={save} disabled={saving || !dirty || isScaled}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Lagre oppskrift
            </Button>
            </div>
          )}
        </header>


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


        <RecipeTabBar active={activeTab} onChange={setActiveTab} indicators={overview.indicators} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <aside aria-label="Nøkkeltall og gjenstår" className="space-y-4 xl:sticky xl:top-4 xl:col-start-2 xl:row-start-1 xl:self-start">
            <RecipeKeyFigures totals={displayTotals} cost={cost} isScaled={isScaled} primary={primaryInfo} />
            <RecipeRemainingPanel
              summary={overview.summary}
              sources={overview.sources}
              collapsible={!wide}
              onSelect={(item) => tabFocus.goTo(item.tab, item.target)}
            />
          </aside>

          <div
            role="tabpanel"
            id={`oppskrift-panel-${activeTab}`}
            aria-labelledby={`oppskrift-fane-${activeTab}`}
            className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1"
          >
            {activeTab === "oppskrift" && (
              <>
                <RecipeStatsBar totals={displayTotals} prefermentedFlourPct={prefermentedFlourPct} hideNotices />
                <RecipeSectionNav onGoTo={goToAnchor} />
        <details
          className="rounded-md border border-border bg-card"
          open={scaleOpen || isScaled}
          onToggle={(e) => setScaleOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium">
            Skalering {isScaled ? "— skalert utgave vises" : "— viser basisoppskriften"}
          </summary>
          <div className="border-t border-border p-2">
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
          onSaveAsNew={canWrite ? handleSaveScaledAsNew : undefined}
          savingAsNew={copying}
        />

          </div>
        </details>

                <RecipeIngredientsSection
                  editor={editor}
                  parts={parts}
                  displayLines={displayLines}
                  editable={editable}
                  totalFlourG={isScaled ? displayTotals.totalFlourG : totals.totalFlourG}
                  rmMap={rmMap}
                  recipeId={recipe.id}
                  warningsByLine={warnings.byLine}
                  onRemovePart={setPartToDelete}
                />
                <RecipeInfoSection
                  header={header}
                  patchHeader={patchHeader}
                  editable={editable}
                  canWrite={canWrite}
                  composite={composite}
                  repricing={repricing}
                  onUpdateCompositePrice={() => void updateCompositePrice()}
                  isBaseRecipe={isBaseRecipe}
                  onToggleBaseRecipe={toggleBaseRecipe}
                  usedIn={usedIn}
                  onOpenRecipe={(rid) => navigate(`/varer/oppskrifter/${rid}`)}
                  doughGramsTotal={doughGramsTotal}
                />
              </>
            )}

            {activeTab === "fremgangsmate" && (
              <RecipeProcessTab
                recipeId={recipe.id}
                legalEntityId={legalEntityId ?? null}
                header={header}
                patchHeader={patchHeader}
                steps={steps}
                onStepsChange={editor.setSteps}
                editable={editable}
                canWrite={canWrite}
                temps={{
                  roomTemp,
                  flourTemp,
                  onRoomTempChange: (v) => {
                    setRoomTemp(v);
                    persistTemps({ roomTemp: v, flourTemp });
                    patchHeader({ room_temp_celsius: v });
                  },
                  onFlourTempChange: (v) => {
                    setFlourTemp(v);
                    persistTemps({ roomTemp, flourTemp: v });
                    patchHeader({ flour_temp_celsius: v });
                  },
                }}
                prefermentTemp={prefermentTemp}
                prefermentGrams={prefermentGrams}
                totalDoughG={totals.totalDoughG}
                imageUrl={imageUrl}
                onImageChange={(url) => {
                  editor.setImage(url);
                  qc.invalidateQueries({ queryKey: ["recipes-list"] });
                }}
              />
            )}

            {activeTab === "varer" && (
              <RecipeProductsTab
                links={{
                  rows: overview.orderedLinks,
                  isLoading: productLinks.linksQuery.isLoading,
                  isError: productLinks.linksQuery.isError,
                  error: productLinks.linksQuery.error,
                  retry: () => void productLinks.linksQuery.refetch(),
                }}
                rows={overview.profitRows}
                primary={primaryInfo}
                cost={cost}
                currentProductId={recipe.product_id ?? null}
                canWrite={canWrite}
                picker={{
                  products: productLinks.productsQuery.data ?? [],
                  isLoading: productLinks.productsQuery.isLoading,
                  isError: productLinks.productsQuery.isError,
                }}
                onAdd={productLinks.addLink}
                onRemove={(linkId) => void productLinks.removeLink(linkId, false)}
                busy={productLinks.busy}
              />
            )}

            {activeTab === "merking" && (
              <LabelTab
                recipeId={recipe.id}
                recipeName={header.name || recipe.name || "Oppskrift"}
                recipe={recipe}
                flourLines={flourLines}
                legalEntityId={legalEntityId ?? undefined}
                onGoToRecipeTab={() => setActiveTab("oppskrift")}
                canWrite={canWrite}
                fixRequest={tabFocus.labelFix}
                basisInput={labelBasisInput}
              />
            )}

            {activeTab === "historikk" && (
              <RecipeHistoryTab
                recipeId={recipe.id}
                versions={{
                  data: versionsQuery.data,
                  isLoading: versionsQuery.isLoading,
                  isError: versionsQuery.isError,
                  error: versionsQuery.error,
                  refetch: () => void versionsQuery.refetch(),
                }}
                canWrite={canWrite}
                restoringVersion={restoringVersion}
                onRestore={(v) => void restoreVersion(v)}
                onShare={() => setShareOpen(true)}
              />
            )}
          </div>
        </div>
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

      <StickySaveBar
        anchorRef={saveAnchorRef}
        visible={canWrite && dirty && activeTab !== "merking"}
        saving={saving}
        disabled={isScaled}
        onSave={() => void save()}
      />

      <UnsavedChangesDialog
        open={unsavedGuard.isBlocked}
        onConfirm={unsavedGuard.discard}
        onCancel={unsavedGuard.stay}
      />
    </>


  );
}
