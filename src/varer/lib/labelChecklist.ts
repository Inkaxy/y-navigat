/**
 * PLIKTFELT PÅ FORBRUKEREMBALLASJE
 * ---------------------------------------------------------------------------
 * Sjekklisten følger matinformasjonsforordningen (EU) nr. 1169/2011 art. 9:
 * betegnelse, ingrediensliste med uthevede allergener, «Kan inneholde spor av»
 * når det er relevant, nettovekt, holdbarhet, oppbevaring, produsent og
 * næringsdeklarasjon. Røde punkter sperrer både utskrift og godkjenning —
 * en etikett uten pliktfelt skal aldri kunne trykkes fra NBhub.
 */

export type ChecklistLevel = "ok" | "warn" | "error";

export interface ChecklistItem {
  key: string;
  label: string;
  level: ChecklistLevel;
  detail: string;
}

export interface LabelChecklistInput {
  productName: string | null | undefined;
  ingredientText: string | null | undefined;
  /** Allergener som skal være uthevet i ingredienslisten. */
  contains: string[];
  mayContain: string[];
  netWeightGrams: number | null | undefined;
  shelfLifeDays: number | null | undefined;
  storageInstructions: string | null | undefined;
  producerName: string | null | undefined;
  producerAddress: string | null | undefined;
  nutrition: Record<string, number | null | undefined> | null | undefined;
  /** Dekningsgrad for beregnet næring (null når kilden er manuell). */
  coveragePct: number | null | undefined;
  /** Beregningen er sperret (kritiske mangler). */
  blocked?: boolean;
  /** Brødskala'n er påstått. */
  claimGrain?: boolean;
  /** Grovhetsprosent bak påstanden. */
  grainPct?: number | null;
  /** Nøkkelhullet er påstått. */
  claimKeyhole?: boolean;
  /** Nøkkelhullberegningen konkluderer med «oppfylt». */
  keyholeQualifies?: boolean;
}

export interface LabelChecklist {
  items: ChecklistItem[];
  /** Røde punkter — utskrift og godkjenning sperres. */
  errors: ChecklistItem[];
  blocked: boolean;
}

const NUTRIENT_KEYS = [
  "energy_kj",
  "energy_kcal",
  "fat_g",
  "saturated_fat_g",
  "carbs_g",
  "sugars_g",
  "protein_g",
  "salt_g",
] as const;

/**
 * Er allergenet uthevet i ingredienslisten?
 *
 * Godtar markørene *term*, **term** og <strong>term</strong>. Rendrerne (skjerm og
 * PDF) uthever i tillegg hver allergenterm de finner i teksten, også når teksten
 * er strippet for markører eller skrevet med VERSALER. Derfor holder det at termen
 * finnes i teksten.
 */
export function allergenIsHighlighted(text: string, term: string): boolean {
  if (!term.trim()) return true;
  const t = term.trim().toLocaleLowerCase("nb-NO");
  const lower = text.toLocaleLowerCase("nb-NO");
  const marked = /\*{1,2}(.+?)\*{1,2}|<strong>(.+?)<\/strong>/g;
  let m: RegExpExecArray | null;
  while ((m = marked.exec(lower)) !== null) {
    if ((m[1] ?? m[2] ?? "").includes(t)) return true;
  }
  // Rendreren uthever per term — termen i klartekst er nok.
  return lower.includes(t);
}

export function buildLabelChecklist(input: LabelChecklistInput): LabelChecklist {
  const items: ChecklistItem[] = [];
  const push = (key: string, label: string, level: ChecklistLevel, detail: string) =>
    items.push({ key, label, level, detail });

  const name = (input.productName ?? "").trim();
  push(
    "name",
    "Betegnelse",
    name ? "ok" : "error",
    name ? name : "Produktet mangler navn på etiketten.",
  );

  const text = (input.ingredientText ?? "").trim();
  push(
    "ingredients",
    "Ingrediensliste",
    text ? "ok" : "error",
    text ? "Ingredienslisten er på plass." : "Ingredienslisten mangler.",
  );

  const missingHighlight = text
    ? input.contains.filter((a) => !allergenIsHighlighted(text, a))
    : input.contains;
  push(
    "allergens",
    "Allergener uthevet",
    input.contains.length === 0 ? "ok" : missingHighlight.length === 0 ? "ok" : "error",
    input.contains.length === 0
      ? "Ingen allergener registrert."
      : missingHighlight.length === 0
        ? `Uthevet: ${input.contains.join(", ")}`
        : `Ikke uthevet i listen: ${missingHighlight.join(", ")}`,
  );

  push(
    "may_contain",
    "«Kan inneholde spor av»",
    "ok",
    input.mayContain.length > 0 ? input.mayContain.join(", ") : "Ingen sporstoffer registrert.",
  );

  const net = input.netWeightGrams;
  push(
    "net_weight",
    "Nettovekt",
    net != null && net > 0 ? "ok" : "error",
    net != null && net > 0 ? `${Math.round(net)} g` : "Nettovekt mangler — pakket vare må ha nettovekt.",
  );

  const shelf = input.shelfLifeDays;
  push(
    "shelf_life",
    "Holdbarhet",
    shelf != null && shelf > 0 ? "ok" : "error",
    shelf != null && shelf > 0 ? `${shelf} dager` : "Holdbarhet mangler — «best før» kan ikke settes.",
  );

  const storage = (input.storageInstructions ?? "").trim();
  push(
    "storage",
    "Oppbevaring",
    storage ? "ok" : "warn",
    storage || "Oppbevaringsanvisning mangler. Påkrevd når produktet krever særskilt oppbevaring.",
  );

  const producer = (input.producerName ?? "").trim();
  const address = (input.producerAddress ?? "").trim();
  push(
    "producer",
    "Produsent",
    producer && address ? "ok" : "error",
    producer && address
      ? `${producer}, ${address}`
      : producer
        ? "Produsentadressen mangler."
        : "Produsentnavn og adresse mangler.",
  );

  const nut = input.nutrition ?? null;
  const missingNutrients = nut ? NUTRIENT_KEYS.filter((k) => nut[k] == null) : NUTRIENT_KEYS.slice();
  const coverage = input.coveragePct;
  const coverageOk = coverage == null || coverage >= 90;
  if (input.blocked) {
    push("nutrition", "Næringsdeklarasjon", "error", "Beregningen er sperret — grunnlaget er ufullstendig.");
  } else if (nut && missingNutrients.length === 0 && coverageOk) {
    push("nutrition", "Næringsdeklarasjon", "ok", "Alle obligatoriske næringsstoffer er utfylt.");
  } else if (nut && missingNutrients.length === 0 && !coverageOk) {
    push(
      "nutrition",
      "Næringsdeklarasjon",
      "error",
      `Utelates — dekning ${coverage!.toFixed(1).replace(".", ",")} % (krav 90 %).`,
    );
  } else {
    push(
      "nutrition",
      "Næringsdeklarasjon",
      "error",
      nut
        ? `Mangler verdier: ${missingNutrients.join(", ")}.`
        : "Ingen næringsdeklarasjon — obligatorisk på ferdigpakket mat.",
    );
  }

  if (input.claimGrain) {
    const ok = input.grainPct != null && Number.isFinite(input.grainPct);
    push(
      "mark_grain",
      "Brødskala'n",
      ok ? "ok" : "error",
      ok ? `Grovhet ${input.grainPct!.toFixed(1).replace(".", ",")} %` : "Merket er valgt uten beregnet grovhet.",
    );
  }
  if (input.claimKeyhole) {
    push(
      "mark_keyhole",
      "Nøkkelhullet",
      input.keyholeQualifies ? "ok" : "error",
      input.keyholeQualifies ? "Kriteriene er oppfylt." : "Merket er valgt uten kvalifiserende beregning.",
    );
  }

  const errors = items.filter((i) => i.level === "error");
  return { items, errors, blocked: errors.length > 0 };
}
