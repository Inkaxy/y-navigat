/**
 * EKSPORT AV DEKLARASJONER
 * ---------------------------------------------------------------------------
 * Ren logikk for `declarations-export`: hvilke varer regnes som «Merking:
 * Godkjent», og er API-nøkkelen gyldig for dette formålet. Samme regel som
 * varelisten bruker (`productLabelingStatus` / `deriveLabelingStatusFromDb`):
 * deklarasjon må finnes, den må ikke være markert for ny gjennomgang, og en
 * beregningsrad som finnes må ikke være utdatert.
 */

export const DECLARATIONS_SCOPE = "declarations";

export interface ExportCandidate {
  /** Effektiv deklarasjonstekst på produktet. */
  ingredientText: string | null | undefined;
  /** Produktet er flagget for ny gjennomgang. */
  needsReview: boolean | null | undefined;
  /** Beregningsraden for oppskriften — null når produktet ikke er koblet. */
  calculated: { computed_at: string | null; is_stale: boolean | null } | null;
}

export type ExportRejection = "mangler_deklarasjon" | "krever_ny_gjennomgang" | "utdatert";

/** Null når varen kan eksporteres, ellers årsaken til at den holdes tilbake. */
export function exportRejection(row: ExportCandidate): ExportRejection | null {
  if (!row.ingredientText || !row.ingredientText.trim()) return "mangler_deklarasjon";
  if (row.needsReview === true) return "krever_ny_gjennomgang";
  if (row.calculated) {
    if (!row.calculated.computed_at) return "utdatert";
    if (row.calculated.is_stale === true) return "utdatert";
  }
  return null;
}

export function isApprovedForExport(row: ExportCandidate): boolean {
  return exportRejection(row) === null;
}

export interface ApiKeyRow {
  id: string;
  legal_entity_id: string;
  revoked_at: string | null;
  scopes: string[] | null;
}

export type KeyCheck =
  | { ok: true; keyId: string; legalEntityId: string }
  | { ok: false; code: "unauthorized" | "revoked" | "forbidden_scope" };

/** Nøkkelen må finnes, ikke være tilbakekalt, og ha rettigheten «declarations». */
export function checkApiKey(row: ApiKeyRow | null | undefined): KeyCheck {
  if (!row) return { ok: false, code: "unauthorized" };
  if (row.revoked_at) return { ok: false, code: "revoked" };
  if (!(row.scopes ?? []).includes(DECLARATIONS_SCOPE)) return { ok: false, code: "forbidden_scope" };
  return { ok: true, keyId: row.id, legalEntityId: row.legal_entity_id };
}

/** Stabil, sorteringsuavhengig nøkkel for innholdet — mottaker kan cache på denne. */
export async function contentHash(value: unknown): Promise<string> {
  const json = JSON.stringify(value, Object.keys(flatten(value)).sort());
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function flatten(value: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      out[k] = true;
      walk(child);
    }
  };
  walk(value);
  return out;
}

export type GrainLevel = "fint" | "halvgrovt" | "grovt" | "ekstra_grovt";

const GRAIN_LABEL: Record<GrainLevel, string> = {
  fint: "Fint",
  halvgrovt: "Halvgrovt",
  grovt: "Grovt",
  ekstra_grovt: "Ekstra grovt",
};
const GRAIN_PIECES: Record<GrainLevel, number> = { fint: 1, halvgrovt: 2, grovt: 3, ekstra_grovt: 4 };

function levelFromPct(pct: number): GrainLevel {
  if (pct < 26) return "fint";
  if (pct < 51) return "halvgrovt";
  if (pct < 76) return "grovt";
  return "ekstra_grovt";
}

export interface ExportGrain {
  level: GrainLevel;
  label: string;
  pct: number | null;
  /** Antall fylte kakestykker i Brødskala'n-merket (1–4). */
  pieces: number;
  pieces_total: 4;
  source: "manual" | "auto";
}

/**
 * Grovhet slik oppskriften viser den: manuell prosent når manuelt er valgt,
 * ellers beregnet kategori/prosent. Null når grunnlag mangler — aldri gjetning.
 */
export function exportGrain(input: {
  mode: string | null | undefined;
  manualPct: number | null | undefined;
  calcCategory: string | null | undefined;
  calcPct: number | null | undefined;
}): ExportGrain | null {
  const build = (level: GrainLevel, pct: number | null, source: "manual" | "auto"): ExportGrain => ({
    level,
    label: GRAIN_LABEL[level],
    pct: pct == null ? null : Math.round(pct * 10) / 10,
    pieces: GRAIN_PIECES[level],
    pieces_total: 4,
    source,
  });
  if (input.mode === "manual") {
    const m = Number(input.manualPct);
    if (input.manualPct == null || !Number.isFinite(m)) return null;
    return build(levelFromPct(m), m, "manual");
  }
  const cat = input.calcCategory as GrainLevel | null | undefined;
  const p = input.calcPct == null ? null : Number(input.calcPct);
  if (cat && cat in GRAIN_LABEL) return build(cat, p != null && Number.isFinite(p) ? p : null, "auto");
  if (p != null && Number.isFinite(p)) return build(levelFromPct(p), p, "auto");
  return null;
}

/** Godkjent snapshot fra `recipe_declaration_versions` — fasit for publisering. */
export interface ApprovedVersion {
  id: string;
  version: number;
  approved_at: string | null;
  ingredient_text: string | null;
  allergens_contains: string[] | null;
  allergens_may_contain: string[] | null;
  nutrition_per_100g: Record<string, number | null> | null;
  shelf_life_days: number | null;
  storage_text: string | null;
  origin_text: string | null;
  claim_grain: boolean | null;
  claim_keyhole: boolean | null;
  breadscale_pct: number | null;
}

export type ExportSource = "approved_version" | "legacy";

export interface ExportDecision {
  include: boolean;
  source: ExportSource | null;
  /** Nye endringer venter på gjennomgang; publisert innhold er uendret. */
  needsReview: boolean;
  rejection: ExportRejection | null;
}

/**
 * Skiller «har gyldig sist godkjent versjon» fra «nye endringer krever
 * gjennomgang». En vare med godkjent versjon publiseres alltid med sitt
 * snapshot; review-flagget og utdatert beregning eksponeres bare som tillegg.
 * Uten versjon (eldre data) gjelder den opprinnelige, strenge regelen.
 */
export function exportDecision(
  row: ExportCandidate & { versionId: string | null | undefined; version: ApprovedVersion | null },
): ExportDecision {
  const calcStale = !!row.calculated && (!row.calculated.computed_at || row.calculated.is_stale === true);
  if (row.versionId && row.version && row.version.id === row.versionId && row.version.ingredient_text?.trim()) {
    return { include: true, source: "approved_version", needsReview: row.needsReview === true || calcStale, rejection: null };
  }
  const rejection = exportRejection(row);
  return { include: rejection === null, source: rejection === null ? "legacy" : null, needsReview: false, rejection };
}

/** Grovhet fra godkjent snapshot — aldri fra løpende beregning. */
export function approvedGrain(version: ApprovedVersion, recipeMode: string | null | undefined): ExportGrain | null {
  const pct = version.breadscale_pct == null ? null : Number(version.breadscale_pct);
  if (pct == null || !Number.isFinite(pct)) return null;
  return exportGrain({
    mode: recipeMode === "manual" ? "manual" : "auto",
    manualPct: pct,
    calcCategory: null,
    calcPct: pct,
  });
}

/**
 * Publisert innhold for en vare med godkjent versjon: tekst, allergener,
 * næring, holdbarhet/oppbevaring/opprinnelse og grovhet kommer fra snapshotet.
 */
export function approvedContent(version: ApprovedVersion, recipeMode: string | null | undefined) {
  return {
    ingredient_text: version.ingredient_text ?? "",
    allergens_contains: version.allergens_contains ?? [],
    allergens_may_contain: version.allergens_may_contain ?? [],
    nutrition_per_100g: version.nutrition_per_100g ?? null,
    shelf_life_days: version.shelf_life_days ?? null,
    storage_instructions: version.storage_text ?? null,
    country_of_origin: version.origin_text ?? null,
    grain: approvedGrain(version, recipeMode),
    approved_at: version.approved_at ?? null,
  };
}
