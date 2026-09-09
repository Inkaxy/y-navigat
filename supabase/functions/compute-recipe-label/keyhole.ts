// Nøkkelhull-regler som kan testes uten å starte edge-funksjonen.
// Kilde: Mattilsynets veileder til nøkkelhullforskriften, produktgruppe 8 og 9.

/** Allergenkodene for glutenholdig korn slik de er lagret i `allergen_type`. */
export const GLUTEN_ALLERGEN_CODES = [
  "gluten_wheat",
  "gluten_rye",
  "gluten_barley",
  "gluten_oats",
  "gluten_spelt",
  "gluten_khorasan",
] as const;

/**
 * Glutenfritt: ingen av glutenkornenes allergenkoder er i «Inneholder».
 * Kodesjekk — IKKE tekstsøk i de norske etikettene («Hvete» inneholder ikke
 * ordet «gluten», så tekstsøket var alltid sant og ga feil fullkornkrav).
 */
export function isGlutenFreeFromCodes(containsCodes: readonly string[]): boolean {
  return !containsCodes.some((c) => (GLUTEN_ALLERGEN_CODES as readonly string[]).includes(c));
}

/** Glutenfrie produkter har lavere fullkornkrav (veilederen 4.2.1). */
export const GLUTEN_FREE_WHOLE_GRAIN_LIMIT: Record<string, number> = { "8a": 10, "8b": 15, "9": 15 };

/** Fullkornkravet i prosent av tørrstoff for en gruppe. */
export function wholeGrainLimitFor(group: "8a" | "8b" | "9", glutenFree: boolean, defaultLimit: number): number {
  if (!glutenFree) return defaultLimit;
  return GLUTEN_FREE_WHOLE_GRAIN_LIMIT[group] ?? defaultLimit;
}

// ============ Gruppevalg og statusberegning (ren funksjon, uten atferdsendring) ============

export type KeyholeCriterionDef = { key: string; name: string; op: "min" | "max"; limit: number; unit: string };

const KEYHOLE_GROUPS: Record<"8a" | "8b" | "9", { label: string; criteria: KeyholeCriterionDef[] }> = {
  "8a": {
    label: "Gruppe 8a — brød",
    criteria: [
      { key: "whole_grain_pct_of_dry", name: "Fullkorn av tørrstoff", op: "min", limit: 30, unit: "%" },
      { key: "fiber_g", name: "Kostfiber", op: "min", limit: 5, unit: "g/100 g" },
      { key: "fat_g", name: "Fett", op: "max", limit: 7, unit: "g/100 g" },
      { key: "sugars_g", name: "Sukkerarter", op: "max", limit: 5, unit: "g/100 g" },
      { key: "salt_g", name: "Salt", op: "max", limit: 1.0, unit: "g/100 g" },
    ],
  },
  "8b": {
    label: "Gruppe 8b — rugbrød",
    criteria: [
      { key: "whole_grain_pct_of_dry", name: "Fullkorn av tørrstoff", op: "min", limit: 35, unit: "%" },
      { key: "fiber_g", name: "Kostfiber", op: "min", limit: 6, unit: "g/100 g" },
      { key: "fat_g", name: "Fett", op: "max", limit: 7, unit: "g/100 g" },
      { key: "sugars_g", name: "Sukkerarter", op: "max", limit: 5, unit: "g/100 g" },
      { key: "salt_g", name: "Salt", op: "max", limit: 1.2, unit: "g/100 g" },
      { key: "rye_share_of_grain_pct", name: "Rugandel av kornet", op: "min", limit: 30, unit: "%" },
    ],
  },
  "9": {
    label: "Gruppe 9 — knekkebrød",
    criteria: [
      { key: "whole_grain_pct_of_dry", name: "Fullkorn av tørrstoff", op: "min", limit: 50, unit: "%" },
      { key: "fiber_g", name: "Kostfiber", op: "min", limit: 6, unit: "g/100 g" },
      { key: "fat_g", name: "Fett", op: "max", limit: 7, unit: "g/100 g" },
      { key: "sugars_g", name: "Sukkerarter", op: "max", limit: 5, unit: "g/100 g" },
      { key: "salt_g", name: "Salt", op: "max", limit: 1.3, unit: "g/100 g" },
    ],
  },
};

const NUTRIENT_KEYS = new Set(["fiber_g", "fat_g", "sugars_g", "salt_g"]);
export const KEYHOLE_MIN_COVERAGE_PCT = 90;

/** Nøkkelhullet vurderes bare for brød, rundstykker og knekkebrød. */
export function keyholeGroupForRecipe(category: string | null, name: string | null): "8a" | "9" | null {
  const hay = `${category ?? ""} ${name ?? ""}`.toLowerCase();
  if (/knekkebr|flatbr/.test(hay)) return "9";
  if (/br(ø|o)d|rundstykk|bagett|loff|ciabatta|focaccia|horn|bolle?br/.test(hay)) return "8a";
  return null;
}

function nb(n: number, decimals = 1): string {
  return Number(n).toFixed(decimals).replace(".", ",");
}

/** Datagrunnlaget `evaluateKeyhole` trenger fra kjernen — et utvalg av CoreResult pluss beregnede mål. */
export type KeyholeCore = {
  containsCodes: readonly string[];
  whole_grain_pct_of_dry: number | null;
  rye_share_of_grain_pct: number | null;
  free_text_grain_lines: readonly { name: string }[];
  missing_bake_loss: boolean;
};

export type KeyholeRecipe = { category: string | null; name: string | null };

export type KeyholePer100 = { fiber_g: number | null; fat_g: number | null; sugars_g: number | null; salt_g: number | null };

export type KeyholeCriterionResult = {
  key: string;
  name: string;
  requirement: string;
  limit: number;
  op: "min" | "max";
  unit: string;
  value: number | null;
  met: boolean | null;
  difference: number | null;
};

export type KeyholeGroupEvaluation = {
  group: "8a" | "8b" | "9";
  group_label: string;
  criteria: KeyholeCriterionResult[];
  allMet: boolean;
  anyUnknown: boolean;
};

export type KeyholeEvaluation = {
  baseGroup: "8a" | "9" | null;
  candidates: Array<"8a" | "8b" | "9">;
  evaluations: KeyholeGroupEvaluation[];
  best: KeyholeGroupEvaluation | null;
  status: "oppfylt" | "ikke_oppfylt" | "ukjent";
  statusReason: string | null;
  groupChoiceReason: string;
};

/**
 * Gruppevalg og statusberegning for Nøkkelhullet — ren funksjon uten sideeffekter.
 * Kriterievurdering og fremdriftsrådene (advice-tekstene) ligger fortsatt i index.ts
 * siden de trenger flere mellomregnede tall (ferdigvekt, melmengde osv.).
 */
export function evaluateKeyhole(
  core: KeyholeCore,
  recipe: KeyholeRecipe,
  per100: KeyholePer100,
  coveragePct: number,
): KeyholeEvaluation {
  const isGlutenFree = isGlutenFreeFromCodes(core.containsCodes);
  const measured: Record<string, number | null> = {
    whole_grain_pct_of_dry: core.whole_grain_pct_of_dry,
    rye_share_of_grain_pct: core.rye_share_of_grain_pct,
    fiber_g: per100.fiber_g,
    fat_g: per100.fat_g,
    sugars_g: per100.sugars_g,
    salt_g: per100.salt_g,
  };

  function evaluateGroup(groupKey: "8a" | "8b" | "9"): KeyholeGroupEvaluation {
    const g = KEYHOLE_GROUPS[groupKey];
    const criteria: KeyholeCriterionResult[] = g.criteria.map((c0) => {
      const c = c0.key === "whole_grain_pct_of_dry"
        ? { ...c0, limit: wholeGrainLimitFor(groupKey, isGlutenFree, c0.limit) }
        : c0;
      const value = measured[c.key];
      const needsNutrition = NUTRIENT_KEYS.has(c.key);
      const unknown = value == null || (needsNutrition && coveragePct < KEYHOLE_MIN_COVERAGE_PCT);
      const met = unknown ? null : (c.op === "max" ? value! <= c.limit : value! >= c.limit);
      return {
        key: c.key,
        name: c.name,
        requirement: `${c.op === "max" ? "høyst" : "minst"} ${nb(c.limit)} ${c.unit}`,
        limit: c.limit,
        op: c.op,
        unit: c.unit,
        value: value ?? null,
        met,
        difference: value == null ? null : Math.round((c.op === "max" ? value - c.limit : value - c.limit) * 100) / 100,
      };
    });
    const anyUnknown = criteria.some((c) => c.met === null);
    const allMet = criteria.every((c) => c.met === true);
    return { group: groupKey, group_label: g.label, criteria, allMet, anyUnknown };
  }

  // Gruppevalg: produkttype først (Nøkkelhullet gjelder bare brødvarer),
  // deretter rugandel ≥ 30 % ⇒ vurder også 8b.
  const baseGroup = keyholeGroupForRecipe(recipe.category ?? null, recipe.name ?? null);
  const ryeSharePct = core.rye_share_of_grain_pct;
  const candidates: Array<"8a" | "8b" | "9"> = baseGroup === "9"
    ? ["9"]
    : (ryeSharePct ?? 0) >= 30
      ? ["8b", "8a"]
      : ["8a"];
  const evaluations = baseGroup ? candidates.map(evaluateGroup) : [];
  const best = evaluations.find((e) => e.allMet && !e.anyUnknown) ?? evaluations[0] ?? null;

  let status: "oppfylt" | "ikke_oppfylt" | "ukjent";
  let statusReason: string | null = null;
  if (!baseGroup || !best) {
    status = "ukjent";
    statusReason = "Oppskriften er ikke brød, rundstykke eller knekkebrød — Nøkkelhullet vurderes ikke.";
  } else if (core.free_text_grain_lines.length) {
    status = "ukjent";
    statusReason = `Fritekstlinjer med korn er ikke koblet til råvare: ${core.free_text_grain_lines.map((l) => l.name).join(", ")}.`;
  } else if (core.missing_bake_loss) {
    status = "ukjent";
    statusReason = "Ferdigvekt er lik innveid vekt (0 % stektap) — fullkorn og næring per 100 g kan ikke vurderes.";
  } else if (coveragePct < KEYHOLE_MIN_COVERAGE_PCT) {
    status = "ukjent";
    statusReason = `Datadekningen er ${nb(coveragePct)} % av deigvekten. Det kreves minst ${KEYHOLE_MIN_COVERAGE_PCT} % næringsdekning for å konkludere.`;
  } else if (best.anyUnknown) {
    status = "ukjent";
    statusReason = "Ett eller flere kriterier mangler data.";
  } else {
    status = best.allMet ? "oppfylt" : "ikke_oppfylt";
  }

  const groupChoiceReason = !baseGroup
    ? "Nøkkelhullet gjelder bare brød, rundstykker og knekkebrød."
    : (ryeSharePct ?? 0) >= 30
    ? `Rugandelen er ${nb(ryeSharePct ?? 0)} % — vurdert mot rugbrødgruppen.`
    : `Rugandelen er ${ryeSharePct == null ? "ukjent" : nb(ryeSharePct) + " %"} — vurdert mot brødgruppen.`;

  return { baseGroup, candidates, evaluations, best, status, statusReason, groupChoiceReason };
}
