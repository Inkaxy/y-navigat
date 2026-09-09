import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { RecipeDepartment } from "@/varer/lib/departments";
import { lineCost } from "@/varer/lib/recipeCost";
import type { ScaleMode, ScaledBatchLine } from "@/varer/lib/scaling";
import {
  calcWaterTemp,
  computePartSummary,
  computeTotals,
  isFlourLine,
  lineDisplayName,
  roundBakerGrams,
  fmtDuration,
  fmtNum,
  scaleLines,
  STEP_TYPE_LABEL,
  toGrams,
  weighingOrder,
  type BakersLine,
} from "@/varer/lib/bakers";

// ===== Datamodell for begge PDF-ene =====

export interface RecipePDFLine {
  id: string;
  name: string;
  /** Avrundet, bakervennlig gramvekt — det bakeren veier. 0 når vekten er ukjent. */
  grams: number;
  /** Usann når mengden ikke kunne regnes om til gram — da er 0 g ikke en vekt. */
  exactWeight: boolean;
  /** Mengden i linjens egen enhet, brukt når gramvekten er ukjent. */
  fallbackQuantity: string | null;
  /** Uavrundet gramvekt. */
  exactGrams: number;
  /** Bakerprosent — uendret av skalering. */
  percent: number;
  isFlour: boolean;
  /** Linja er en grunnoppskrift/halvfabrikat — merkes med «†» i utskriftene. */
  isSubRecipe: boolean;

  /** Kostpris for linja (kun oppskriftskortet, og kun når brukeren ber om det). */
  cost: number | null;
}

export interface RecipePDFPart {
  id: string;
  name: string;
  partType: string;
  prefermentKind: string | null;
  targetTempCelsius: number | null;
  ripeTimeHours: number | null;
  instructions: string | null;
  /** Kort forberedelsesnotat — f.eks. utledet av forberedelsestid, vises under deltittelen. */
  prepNote?: string | null;
  /** Hviletid i minutter, vises under deltittelen når den er satt. */
  restMinutes?: number | null;
  lines: RecipePDFLine[];
  totalG: number;
  hydrationPct: number;
  prefermentedFlourPct: number;
}

export interface RecipePDFStep {
  index: number;
  typeLabel: string;
  title: string | null;
  instruction: string | null;
  durationMinutes: number | null;
  tempCelsius: number | null;
  humidityPct: number | null;
}

export interface RecipePDFData {
  name: string;
  category: string | null;
  department: RecipeDepartment | null;
  version: number | null;
  description: string | null;
  imageUrl: string | null;
  printedAt: Date;
  /** Batch-id skrevet inn i utskriftsdialogen, kun til bruk på produksjonsarket. */
  batchId?: string | null;
  /** Produksjonsdato (YYYY-MM-DD) valgt i utskriftsdialogen. */
  productionDate?: string | null;
  /** Allergener som skal fremheves på produksjonsarket, når kjent. */
  allergens?: string[] | null;

  scaledUnits: number;
  scaleFactorValue: number;
  unitWeightGrams: number | null;

  stats: {
    flourG: number;
    doughG: number;
    exactDoughG: number;
    hydrationPct: number;
    saltPct: number;
    leavenPct: number;
    prefermentedFlourPct: number;
    targetDoughTemp: number | null;
    waterTemp: number | null;
    waterTempFeasible: boolean;
    /** Faktisk rom- og meltemperatur som vanntemperaturen er regnet ut fra. */
    roomTemp: number;
    flourTemp: number;
    prefermentTemp: number | null;
  };

  preferments: RecipePDFPart[];
  mainParts: RecipePDFPart[];
  steps: RecipePDFStep[];
  totalProcessMinutes: number;

  costs: { total: number; perUnit: number | null } | null;

  /** Per-batch-oppstilling — satt når oppskriften er delt i flere fysiske batcher. */
  batches?: {
    count: number;
    perBatchDoughG: number | null;
    lines: { name: string; grams: number | null; unit: string; quantity: number }[];
  } | null;
}

export interface BuildRecipePDFInput {
  name: string;
  category?: string | null;
  department?: RecipeDepartment | null;
  version?: number | null;
  description?: string | null;
  imageUrl?: string | null;
  unitWeightGrams?: number | null;
  targetDoughTemp?: number | null;
  frictionFactor?: number | null;
  roomTemp?: number;
  flourTemp?: number;
  scaledUnits: number;
  factor: number;
  /** Antall enheter per fysisk batch — brukes til å regne ut per-batch-vekter når satt. */
  unitsPerBatch?: number | null;
  batchId?: string | null;
  productionDate?: string | null;
  allergens?: string[] | null;
  parts: {
    id: string;
    name: string;
    part_type: string;
    preferment_kind: string | null;
    target_temp_celsius: number | null;
    ripe_time_hours: number | null;
    instructions: string | null;
    /** Finnes som kolonne på `recipe_parts`, men fritekst finnes ikke — brukes til å utlede et forberedelsesnotat. */
    prep_time_minutes?: number | null;
    rest_time_minutes?: number | null;
  }[];
  lines: BakersLine[];
  steps: {
    step_type: string;
    title: string | null;
    instruction: string | null;
    duration_minutes: number | null;
    temp_celsius: number | null;
    humidity_pct: number | null;
  }[];
  includeCosts?: boolean;
  /** Skaleringsresultatet fra siden — når satt, viser batch-PDF-en faktiske mengder per sats. */
  scaleResult?: { mode: ScaleMode; batchCount: number; perBatch: ScaledBatchLine[] } | null;
}

function lineCostOrNull(line: BakersLine, grams: number): number | null {
  return lineCost(line, grams).cost;
}

/**
 * Bygger PDF-datasettet fra den skalerte visningen som står på skjermen.
 * Bakerprosentene regnes fra den uskalerte oppskriften, slik at de er identiske
 * uansett hvor mye man skalerer.
 */
export function buildRecipePDFData(input: BuildRecipePDFInput): RecipePDFData {
  const baseTotals = computeTotals(input.lines, input.unitWeightGrams);
  const scaled = scaleLines(input.lines, input.factor, baseTotals.totalFlourG);
  const byId = new Map(scaled.map((l) => [l.id, l]));

  const prefermentTemp =
    input.parts.find((p) => p.part_type === "preferment" && p.target_temp_celsius != null)?.target_temp_celsius ?? null;

  /** Fordeigens vekt — brukes til å vekte fordeigens bidrag til vanntemperaturen proporsjonalt med dens andel av deigen. */
  const prefermentPartIds = new Set(input.parts.filter((p) => p.part_type === "preferment").map((p) => p.id));
  const prefermentGrams =
    prefermentPartIds.size > 0
      ? computePartSummary(input.lines.filter((l) => prefermentPartIds.has(l.recipe_part_id)), baseTotals.totalFlourG).totalG
      : 0;

  const weightedTemp = calcWaterTemp({
    targetDoughTempC: input.targetDoughTemp ?? 24,
    roomTempC: input.roomTemp ?? 21,
    flourTempC: input.flourTemp ?? 21,
    frictionC: input.frictionFactor ?? 0,
    preferment: prefermentTemp != null && prefermentGrams > 0 ? { tempC: prefermentTemp, grams: prefermentGrams } : null,
    totalDoughG: baseTotals.totalDoughG,
  });
  const waterTemp = weightedTemp?.waterTempC ?? null;
  const waterTempFeasible = waterTemp != null && waterTemp >= 0 && waterTemp <= 60;

  function buildPart(p: BuildRecipePDFInput["parts"][number]): RecipePDFPart {
    const partLines = input.lines.filter((l) => l.recipe_part_id === p.id);
    const summary = computePartSummary(partLines, baseTotals.totalFlourG);
    const ordered = weighingOrder(partLines);
    const lines: RecipePDFLine[] = ordered.map((l) => {
      const s = byId.get(l.id);
      const exactWeight = s ? s.exact : true;
      const exactGrams = s?.exactGrams ?? toGrams(l.quantity, l.unit) * input.factor;
      const grams = roundBakerGrams(exactGrams);
      return {
        id: l.id,
        name: lineDisplayName(l),
        grams,
        exactWeight,
        fallbackQuantity: exactWeight
          ? null
          : `${fmtNum(s?.scaledQuantity ?? Number(l.quantity) * input.factor, 2)} ${l.unit}`,
        exactGrams,
        percent: s?.percent ?? 0,
        isFlour: isFlourLine(l),
        isSubRecipe: !!l.sub_product_id || !!l._rm?.produced_by_recipe_id,

        // Ukjent vekt gir ingen kostpris — 0 g ville blitt 0 kr og skjult mangelen.
        cost: input.includeCosts && exactWeight ? lineCostOrNull(l, exactGrams) : null,
      };
    });
    return {
      id: p.id,
      name: p.name,
      partType: p.part_type,
      prefermentKind: p.preferment_kind,
      targetTempCelsius: p.target_temp_celsius,
      ripeTimeHours: p.ripe_time_hours,
      instructions: p.instructions,
      prepNote: p.prep_time_minutes != null ? `Forberedelse: ${fmtDuration(p.prep_time_minutes)}` : null,
      restMinutes: p.rest_time_minutes ?? null,
      lines,
      totalG: summary.totalG * input.factor,
      hydrationPct: summary.hydrationPct,
      prefermentedFlourPct: summary.prefermentedFlourPct,
    };
  }

  const allParts = input.parts.map(buildPart);
  const preferments = allParts.filter((p) => p.partType === "preferment");
  const mainParts = allParts.filter((p) => p.partType !== "preferment");
  const prefermentedFlourPct = preferments.reduce((s, p) => s + p.prefermentedFlourPct, 0);

  // Per-batch-oppstilling — deler den skalerte oppskriften i fysiske batcher når
  // antall enheter per batch er kjent. Baker-% er uendret; det som deles er gram/mengde.
  let batches: RecipePDFData["batches"] = null;
  const unitsPerBatch = Number(input.unitsPerBatch) || 0;
  if (input.scaleResult && input.scaleResult.batchCount > 1) {
    const { batchCount, perBatch } = input.scaleResult;
    batches = {
      count: batchCount,
      perBatchDoughG: perBatch.reduce((s, l) => s + (l.grams ?? 0), 0) || null,
      lines: perBatch.map((l) => ({ name: l.name, grams: l.grams, unit: l.unit, quantity: l.quantity })),
    };
  } else if (unitsPerBatch > 0) {
    const count = Math.max(1, Math.round(input.scaledUnits / unitsPerBatch));
    const batchLines = input.lines.map((l) => {
      const s = byId.get(l.id);
      const exact = s ? s.exact : false;
      const exactGrams = s?.exactGrams ?? 0;
      return {
        name: lineDisplayName(l),
        grams: exact ? roundBakerGrams(exactGrams / count) : null,
        unit: l.unit,
        quantity: (s?.scaledQuantity ?? Number(l.quantity) * input.factor) / count,
      };
    });
    const doughG = allParts.reduce((s, p) => s + p.lines.reduce((ls, l) => ls + l.grams, 0), 0);
    batches = { count, perBatchDoughG: count > 0 ? roundBakerGrams(doughG / count) : null, lines: batchLines };
  }

  const steps: RecipePDFStep[] = input.steps.map((s, i) => ({
    index: i + 1,
    typeLabel: STEP_TYPE_LABEL[s.step_type] ?? s.step_type,
    title: s.title,
    instruction: s.instruction,
    durationMinutes: s.duration_minutes,
    tempCelsius: s.temp_celsius,
    humidityPct: s.humidity_pct,
  }));

  const exactDoughG = baseTotals.totalDoughG * input.factor;
  const uw = Number(input.unitWeightGrams) || 0;

  let costs: RecipePDFData["costs"] = null;
  if (input.includeCosts) {
    const total = allParts.reduce(
      (s, p) => s + p.lines.reduce((ls, l) => ls + (l.cost ?? 0), 0),
      0,
    );
    const units = uw > 0 ? Math.floor(exactDoughG / uw) : Math.round(input.scaledUnits);
    costs = { total, perUnit: units > 0 ? total / units : null };
  }

  return {
    name: input.name || "Oppskrift",
    category: input.category ?? null,
    department: input.department ?? null,
    version: input.version ?? null,
    description: input.description ?? null,
    imageUrl: input.imageUrl ?? null,
    printedAt: new Date(),
    batchId: input.batchId ?? null,
    productionDate: input.productionDate ?? null,
    allergens: input.allergens ?? null,
    scaledUnits: Math.round(input.scaledUnits),
    scaleFactorValue: input.factor,
    unitWeightGrams: uw > 0 ? uw : null,
    stats: {
      flourG: baseTotals.totalFlourG * input.factor,
      doughG: allParts.reduce((s, p) => s + p.lines.reduce((ls, l) => ls + l.grams, 0), 0),
      exactDoughG,
      hydrationPct: baseTotals.hydrationPct,
      saltPct: baseTotals.saltPct,
      leavenPct: baseTotals.leavenPct,
      prefermentedFlourPct,
      targetDoughTemp: input.targetDoughTemp ?? null,
      waterTemp,
      waterTempFeasible,
      roomTemp: input.roomTemp ?? 21,
      flourTemp: input.flourTemp ?? 21,
      prefermentTemp,
    },
    preferments,
    mainParts,
    steps,
    totalProcessMinutes: steps.reduce((s, x) => s + (Number(x.durationMinutes) || 0), 0),
    costs,
    batches,
  };
}

// ===== Generering =====

/** Sjekker at bildet faktisk kan lastes før det sendes inn i PDF-en. */
function imageLoads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
    setTimeout(() => resolve(false), 8000);
  });
}

function openBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    // Popup blokkert — fall tilbake til nedlasting.
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export interface RecipeCardOptions {
  includeCosts: boolean;
  includeImage: boolean;
}

export function useRecipePDF() {
  const [generating, setGenerating] = useState<null | "production" | "card">(null);

  const printProductionSheet = useCallback(async (data: RecipePDFData) => {
    setGenerating("production");
    try {
      const [{ pdf }, { RecipePDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/varer/components/recipes/RecipePDFDocument"),
      ]);
      const blob = await pdf(<RecipePDFDocument data={data} />).toBlob();
      openBlob(blob, `Produksjonsark - ${data.name} - ${data.scaledUnits} stk.pdf`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Kunne ikke lage produksjonsarket");
    } finally {
      setGenerating(null);
    }
  }, []);

  const printRecipeCard = useCallback(async (data: RecipePDFData, options: RecipeCardOptions) => {
    setGenerating("card");
    try {
      let imageUrl: string | null = null;
      if (options.includeImage && data.imageUrl) {
        const ok = await imageLoads(data.imageUrl);
        if (ok) imageUrl = data.imageUrl;
        else toast.warning("Bildet kunne ikke lastes — kortet lages uten bilde.");
      }
      const [{ pdf }, { RecipeCardPDFDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/varer/components/recipes/RecipeCardPDFDocument"),
      ]);
      const blob = await pdf(
        <RecipeCardPDFDocument data={{ ...data, imageUrl }} showCosts={options.includeCosts} />,
      ).toBlob();
      openBlob(blob, `Oppskrift - ${data.name}.pdf`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Kunne ikke lage oppskriftskortet");
    } finally {
      setGenerating(null);
    }
  }, []);

  return { generating, printProductionSheet, printRecipeCard };
}
