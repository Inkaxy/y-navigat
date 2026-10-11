import { isObj, num, str, type Obj } from "@/fakturaer/lib/parseRpcJson";

/** Grense for én opplasting (R147). Flere filer avvises med beskjed — aldri stille avkorting. */
export const MAX_BULK_FILES = 100;
/** Kandidatscore som kan FORHÅNDSVELGE et mål. Autoriserer aldri skriving alene. */
export const PRESELECT_SCORE = 0.7;

export interface MatchCandidate { id: string; name: string; sku: string; score: number }

export function parseCandidates(data: unknown): MatchCandidate[] {
  if (!isObj(data) || !Array.isArray(data.candidates)) return [];
  const out: MatchCandidate[] = [];
  for (const c of data.candidates) {
    if (!isObj(c)) continue;
    const id = str(c, "id");
    const score = num(c, "score");
    if (!id || score == null) continue;
    out.push({ id, name: str(c, "name") ?? "Ukjent råvare", sku: str(c, "sku") ?? "", score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Sammendrag av det AI leste — vises før anvend, slik at hver fil kan gjennomgås. */
export interface ExtractSummary {
  name: string | null;
  supplier: string | null;
  nutritionFields: number;
  allergens: string[];
  declaration: string | null;
  /** Brødskala-klassifiseringen serveren skriver (`grain_classification_hint`), ikke et ja/nei. */
  grain: string | null;
  packageText: string | null;
}

export function summarizeExtract(ai: unknown): ExtractSummary {
  const o: Obj = isObj(ai) ? ai : {};
  const nut = isObj(o.nutrition) ? o.nutrition : {};
  const allergens = Array.isArray(o.allergens)
    ? o.allergens.map((a) => (typeof a === "string" ? a : isObj(a) ? str(a, "allergen") ?? str(a, "name") ?? str(a, "code") : null)).filter((x): x is string => !!x)
    : [];
  const size = num(o, "package_size_value");
  const unit = str(o, "package_size_unit");
  return {
    name: str(o, "name"),
    supplier: str(o, "supplier_name"),
    nutritionFields: Object.values(nut).filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "")).length,
    allergens,
    declaration: str(o, "ingredient_declaration"),
    grain: str(o, "grain_classification_hint"),
    packageText: size != null ? `${size} ${unit ?? ""}`.trim() : null,
  };
}

/** Felt bulken kan sende. `package`, `composite` og `allergen_removals` sendes bevisst aldri. */
export const BULK_FIELDS = ["nutrition", "allergens", "ingredient_declaration", "grain"] as const;
export type BulkField = (typeof BULK_FIELDS)[number];
export const FIELD_LABEL: Record<BulkField, string> = {
  nutrition: "næring", allergens: "allergener (bare tillegg)", ingredient_declaration: "deklarasjon", grain: "brødskala",
};

/** Hvilke felt databladet faktisk har verdi for (samme betingelser som serveren). */
export function presentFields(ai: unknown): BulkField[] {
  const o: Obj = isObj(ai) ? ai : {};
  const out: BulkField[] = [];
  if (isObj(o.nutrition) && Object.values(o.nutrition).some((v) => v != null)) out.push("nutrition");
  if (Array.isArray(o.allergens) && o.allergens.length > 0) out.push("allergens");
  if (str(o, "ingredient_declaration")) out.push("ingredient_declaration");
  if (str(o, "grain_classification_hint")) out.push("grain");
  return out;
}

/**
 * Gjennomgått, frosset operasjon for én fil. Anvend (enkelt og samlet) sender NØYAKTIG dette —
 * aldri rekonstruerte «alle felt». Bundet til selskap, generasjon, datablad og mål.
 */
export interface ReviewedOp {
  entity: string;
  gen: number;
  datasheetId: string;
  rmId: string;
  fields: BulkField[];
  nutritionFields: string[];
}

export function applyBody(op: ReviewedOp) {
  return {
    datasheet_id: op.datasheetId,
    raw_material_id: op.rmId,
    accepted_fields: [...op.fields],
    accepted_nutrition_fields: op.fields.includes("nutrition") ? [...op.nutritionFields] : [],
  };
}

export type ApplyKind = "applied" | "partial" | "failed" | "unknown";

export interface ApplyOutcome {
  kind: ApplyKind;
  changes: number | null;
  failures: string[];
  /** Manuell oppfølging: allergenfjerning som serveren hoppet over. */
  allergenRemovalsSkipped: string[];
  packageSuggestion: { size: number | null; unit: string | null } | null;
  error: string | null;
}

const blank = (kind: ApplyKind, error: string | null): ApplyOutcome => ({ kind, changes: null, failures: [], allergenRemovalsSkipped: [], packageSuggestion: null, error });

/**
 * Leser apply-datasheet-update. Bare `applied === true` med tom, gyldig `failures` er anvendt.
 * - `failures` ikke tom (HTTP 207): serveren er ikke transaksjonell → DELVIS (noe kan være lagret).
 * - eksplisitt `applied:false` uten feil, manglende/ugyldig form: UKJENT, aldri «anvendt».
 * - `error` uten resultatfelt: avvist.
 */
export function parseApplyOutcome(data: unknown): ApplyOutcome {
  if (!isObj(data)) return blank("unknown", "Ugyldig svar fra serveren");
  const err = str(data, "error");
  if (err && !("applied" in data)) return blank("failed", err);
  if (typeof data.applied !== "boolean" || !Array.isArray(data.failures)) return blank("unknown", "Ufullstendig svar fra serveren");
  const failures = data.failures.map((f) => (typeof f === "string" ? f : isObj(f) ? str(f, "message") ?? str(f, "field") ?? "ukjent feil" : String(f)));
  const fu = isObj(data.follow_ups) ? data.follow_ups : {};
  const skippedRaw = fu.allergen_removals_skipped;
  const allergenRemovalsSkipped = Array.isArray(skippedRaw) ? skippedRaw.map((x) => (typeof x === "string" ? x : isObj(x) ? str(x, "code") ?? str(x, "name") ?? "ukjent" : String(x))) : skippedRaw ? ["se råvaren"] : [];
  const pkg = isObj(fu.package_suggestion) ? fu.package_suggestion : null;
  const sug = pkg && isObj(pkg.suggested) ? pkg.suggested : null;
  const kind: ApplyKind = failures.length > 0 ? "partial" : data.applied === true && !err ? "applied" : "unknown";
  return {
    kind,
    changes: num(data, "changes_logged"),
    failures,
    allergenRemovalsSkipped,
    packageSuggestion: sug ? { size: num(sug, "size"), unit: str(sug, "unit") } : null,
    error: kind === "unknown" ? err ?? "Serveren bekreftet ikke at databladet ble anvendt" : err,
  };
}

/** Feil fra `functions.invoke`: 4xx er en sikker avvisning; nettverk/5xx/ukjent kan ha skrevet noe. */
export function invokeErrorKind(error: unknown): "failed" | "unknown" {
  const ctx = isObj(error) ? error.context : undefined;
  const status = ctx instanceof Response ? ctx.status : isObj(ctx) && typeof ctx.status === "number" ? ctx.status : null;
  return status != null && status >= 400 && status < 500 ? "failed" : "unknown";
}

export interface BulkRowLike {
  key: string;
  status: string;
  applyState: "idle" | "applying" | ApplyKind;
  candidates: MatchCandidate[];
  selectedRm: string | null;
  manualTarget: boolean;
  datasheet_id?: string;
  reviewed?: ReviewedOp | null;
}

/** Gjennomgangen gjelder bare samme datablad og mål i gjeldende selskap/generasjon. */
export function reviewValid(r: BulkRowLike, entity: string | null, gen: number): r is BulkRowLike & { reviewed: ReviewedOp } {
  const v = r.reviewed;
  return !!v && v.entity === entity && v.gen === gen && v.datasheetId === r.datasheet_id && v.rmId === r.selectedRm && v.fields.length > 0;
}

/**
 * Trygg for «Bekreft alle»: klar, ikke anvendt/ukjent/delvis, GJENNOMGÅTT for valgt mål, og valgt mål ER
 * toppkandidaten med høy score og ikke manuelt valgt. Et annet mål arver aldri toppkandidatens score.
 */
export function safeForBulk(r: BulkRowLike, entity: string | null = null, gen = 0): boolean {
  if (r.status !== "ready" || (r.applyState !== "idle" && r.applyState !== "failed") || r.manualTarget || !r.selectedRm) return false;
  if (!reviewValid(r, entity, gen)) return false;
  const chosen = r.candidates.find((c) => c.id === r.selectedRm);
  const top = r.candidates[0];
  return !!chosen && !!top && chosen.id === top.id && chosen.score >= PRESELECT_SCORE;
}

/** Målrettet nytt forsøk: har vi datablad-ID, kjøres bare matching (ingen nytt AI-uttrekk/duplikat). */
export function retryStage(r: { storage_path?: string; datasheet_id?: string }): "upload" | "extract" | "match" {
  if (r.datasheet_id) return "match";
  if (r.storage_path) return "extract";
  return "upload";
}
