/**
 * Live-advarsler i oppskriftseditoren.
 *
 * Samler alt som kan gjøre en oppskrift ubrukelig i produksjon eller på et
 * etikettgrunnlag, og peker på nøyaktig hvilken linje det gjelder — med en lenke
 * til stedet feilen kan rettes.
 *
 * Advarslene er rådgivende: de blokkerer aldri lagring. Men de skal aldri lyve,
 * så en advarsel vises kun når vi faktisk vet at noe mangler.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isLineConvertible, lineToGrams, type BakersLine } from "@/varer/lib/bakers";

export type RecipeWarningKind =
  | "missing_nutrition"
  | "missing_allergens"
  | "missing_package"
  | "missing_unit_weight"
  | "zero_quantity"
  | "free_text_line"
  | "unknown_conversion"
  | "low_margin";

export interface RecipeWarning {
  kind: RecipeWarningKind;
  /** Linjen advarselen hører til, når den gjelder en bestemt linje. */
  lineId: string | null;
  rawMaterialId: string | null;
  /** Kort tekst som vises på raden og i banneret. */
  message: string;
  /** Hvor brukeren kan rette det. */
  action: { label: string; href: string } | null;
}

export const WARNING_TITLE: Record<RecipeWarningKind, string> = {
  missing_nutrition: "Mangler næringsdata",
  missing_allergens: "Mangler allergeninformasjon",
  missing_package: "Mangler pakning",
  missing_unit_weight: "Mangler stykkvekt",
  zero_quantity: "Mengde er null",
  free_text_line: "Fritekstlinje",
  unknown_conversion: "Ukjent omregning",
  low_margin: "Lav dekningsgrad",
};

/** Linjen slik editoren kjenner den. */
export type WarningLine = BakersLine & {
  id: string;
  ingredient_name?: string | null;
  sub_product_id?: string | null;
};

interface Options {
  lines: WarningLine[];
  /** Oppskriftens status — fritekstlinjer godtas i utkast, ikke i aktive oppskrifter. */
  status: string;
  /** Dekningsgrad i prosent, når den kan beregnes. */
  marginPct?: number | null;
  /** Målet dekningsgraden måles mot. */
  marginTargetPct?: number | null;
}

/** Råvarene i oppskriften mangler: næring, allergener eller pakning. */
interface CoverageMaps {
  nutrition: Set<string>;
  allergens: Set<string>;
  packages: Set<string>;
  unitWeights: Map<string, number | null>;
  names: Map<string, string>;
}

function useCoverage(rawMaterialIds: string[]) {
  const key = [...rawMaterialIds].sort().join(",");
  return useQuery<CoverageMaps>({
    queryKey: ["recipe-warning-coverage", key],
    enabled: rawMaterialIds.length > 0,
    queryFn: async () => {
      const ids = [...new Set(rawMaterialIds)];
      const [nutrition, allergens, units, materials] = await Promise.all([
        supabase.from("raw_material_nutrition").select("raw_material_id").in("raw_material_id", ids),
        supabase.from("raw_material_allergens").select("raw_material_id").in("raw_material_id", ids),
        supabase.from("raw_material_units").select("raw_material_id").in("raw_material_id", ids),
        supabase.from("raw_materials").select("id, name, unit_weight_grams").in("id", ids),
      ]);
      // Feiler en av spørringene, er det bedre å ikke vise advarsler enn å vise
      // gale. Vi kaster, slik at QueryState/kalleren kan si fra.
      for (const res of [nutrition, allergens, units, materials]) {
        if (res.error) throw res.error;
      }
      const toSet = (rows: { raw_material_id: string }[] | null) =>
        new Set((rows ?? []).map((r) => r.raw_material_id));
      const unitWeights = new Map<string, number | null>();
      const names = new Map<string, string>();
      for (const m of (materials.data ?? []) as { id: string; name: string | null; unit_weight_grams: number | null }[]) {
        unitWeights.set(m.id, m.unit_weight_grams);
        names.set(m.id, m.name ?? "Uten navn");
      }
      return {
        nutrition: toSet(nutrition.data as { raw_material_id: string }[] | null),
        allergens: toSet(allergens.data as { raw_material_id: string }[] | null),
        packages: toSet(units.data as { raw_material_id: string }[] | null),
        unitWeights,
        names,
      };
    },
  });
}

export interface RecipeWarningsResult {
  warnings: RecipeWarning[];
  /** Advarselstekst per linje-id — mates rett inn i linjegriddet. */
  byLine: Record<string, string | undefined>;
  isLoading: boolean;
}

export function useRecipeWarnings({
  lines,
  status,
  marginPct = null,
  marginTargetPct = null,
}: Options): RecipeWarningsResult {
  const rawMaterialIds = useMemo(
    () => [...new Set(lines.map((l) => l.raw_material_id).filter((v): v is string => !!v))],
    [lines],
  );
  const coverage = useCoverage(rawMaterialIds);

  const warnings = useMemo<RecipeWarning[]>(() => {
    const out: RecipeWarning[] = [];
    const cov = coverage.data;

    for (const line of lines) {
      const rmId = line.raw_material_id ?? null;
      const name = (rmId ? cov?.names.get(rmId) : null) ?? line.ingredient_name ?? "Ukjent ingrediens";

      // Fritekstlinje: hverken råvare eller halvfabrikat er valgt.
      if (!rmId && !line.sub_product_id) {
        if (status === "active") {
          out.push({
            kind: "free_text_line",
            lineId: line.id,
            rawMaterialId: null,
            message: `«${name}» er ikke koblet til en råvare — den teller ikke i kost, næring eller deklarasjon`,
            action: null,
          });
        }
        continue;
      }

      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty === 0) {
        out.push({
          kind: "zero_quantity",
          lineId: line.id,
          rawMaterialId: rmId,
          message: `«${name}» har ingen mengde`,
          action: null,
        });
      }

      if (!isLineConvertible(line) || !lineToGrams(line).exact) {
        out.push({
          kind: "unknown_conversion",
          lineId: line.id,
          rawMaterialId: rmId,
          message: `«${name}»: mengden kan ikke regnes om til gram`,
          action: rmId ? { label: "Åpne råvaren", href: `/ravarer/vare/${rmId}?tab=pakninger` } : null,
        });
      }

      if (line.unit === "stk" && rmId && cov && !cov.unitWeights.get(rmId)) {
        out.push({
          kind: "missing_unit_weight",
          lineId: line.id,
          rawMaterialId: rmId,
          message: `«${name}» er ført i stk, men råvaren mangler stykkvekt`,
          action: { label: "Sett stykkvekt", href: `/ravarer/vare/${rmId}?tab=pakninger` },
        });
      }

      if (rmId && cov) {
        if (!cov.nutrition.has(rmId)) {
          out.push({
            kind: "missing_nutrition",
            lineId: line.id,
            rawMaterialId: rmId,
            message: `«${name}» mangler næringsdata`,
            action: { label: "Legg inn næring", href: `/ravarer/vare/${rmId}?tab=nutrition` },
          });
        }
        if (!cov.allergens.has(rmId)) {
          out.push({
            kind: "missing_allergens",
            lineId: line.id,
            rawMaterialId: rmId,
            message: `«${name}» mangler allergeninformasjon`,
            action: { label: "Legg inn allergener", href: `/ravarer/vare/${rmId}?tab=nutrition` },
          });
        }
        if (!cov.packages.has(rmId)) {
          out.push({
            kind: "missing_package",
            lineId: line.id,
            rawMaterialId: rmId,
            message: `«${name}» mangler pakning`,
            action: { label: "Legg inn pakning", href: `/ravarer/vare/${rmId}?tab=pakninger` },
          });
        }
      }
    }

    if (marginPct != null && marginTargetPct != null && marginPct < marginTargetPct) {
      out.push({
        kind: "low_margin",
        lineId: null,
        rawMaterialId: null,
        message: `Dekningsgraden er ${marginPct.toFixed(1).replace(".", ",")} % — under målet på ${marginTargetPct.toFixed(1).replace(".", ",")} %`,
        action: null,
      });
    }

    return out;
  }, [lines, coverage.data, status, marginPct, marginTargetPct]);

  const byLine = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const w of warnings) {
      if (!w.lineId) continue;
      map[w.lineId] = map[w.lineId] ? `${map[w.lineId]} · ${w.message}` : w.message;
    }
    return map;
  }, [warnings]);

  return { warnings, byLine, isLoading: coverage.isLoading };
}
