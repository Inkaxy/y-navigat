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
  grain: boolean;
  packageText: string | null;
}

export function summarizeExtract(ai: unknown): ExtractSummary {
  const o: Obj = isObj(ai) ? ai : {};
  const nut = isObj(o.nutrition) ? o.nutrition : {};
  const allergens = Array.isArray(o.allergens)
    ? o.allergens.map((a) => (typeof a === "string" ? a : isObj(a) ? str(a, "name") ?? str(a, "code") ?? str(a, "allergen") : null)).filter((x): x is string => !!x)
    : [];
  const size = num(o, "package_size_value");
  const unit = str(o, "package_size_unit");
  return {
    name: str(o, "name"),
    supplier: str(o, "supplier_name"),
    nutritionFields: Object.values(nut).filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "")).length,
    allergens,
    declaration: str(o, "ingredient_declaration") ?? str(o, "ingredients"),
    grain: o.grain != null && o.grain !== false,
    packageText: size != null ? `${size} ${unit ?? ""}`.trim() : null,
  };
}

/** Felt bulken sender. `package`, `composite` og `allergen_removals` sendes bevisst aldri. */
export const BULK_FIELDS = ["nutrition", "allergens", "ingredient_declaration", "grain"] as const;
export const FIELD_LABEL: Record<(typeof BULK_FIELDS)[number], string> = {
  nutrition: "næring", allergens: "allergener (bare tillegg)", ingredient_declaration: "deklarasjon", grain: "korn",
};

export interface ApplyOutcome {
  ok: boolean;
  changes: number;
  failures: string[];
  /** Manuell oppfølging: allergenfjerning som serveren hoppet over. */
  allergenRemovalsSkipped: string[];
  packageSuggestion: { size: number | null; unit: string | null } | null;
  error: string | null;
}

/** Leser apply-datasheet-update (også HTTP 207 med `failures`). Feltfeil = ikke anvendt. */
export function parseApplyOutcome(data: unknown): ApplyOutcome {
  if (!isObj(data)) return { ok: false, changes: 0, failures: [], allergenRemovalsSkipped: [], packageSuggestion: null, error: "Ingen respons fra serveren" };
  const err = str(data, "error");
  const failures = Array.isArray(data.failures) ? data.failures.map((f) => (typeof f === "string" ? f : isObj(f) ? str(f, "message") ?? str(f, "field") ?? "ukjent feil" : String(f))) : [];
  const fu = isObj(data.follow_ups) ? data.follow_ups : {};
  const skippedRaw = fu.allergen_removals_skipped;
  const allergenRemovalsSkipped = Array.isArray(skippedRaw) ? skippedRaw.map((x) => (typeof x === "string" ? x : isObj(x) ? str(x, "code") ?? str(x, "name") ?? "ukjent" : String(x))) : skippedRaw ? ["se råvaren"] : [];
  const pkg = isObj(fu.package_suggestion) ? fu.package_suggestion : null;
  const sug = pkg && isObj(pkg.suggested) ? pkg.suggested : null;
  return {
    ok: !err && failures.length === 0,
    changes: num(data, "changes_logged") ?? 0,
    failures,
    allergenRemovalsSkipped,
    packageSuggestion: sug ? { size: num(sug, "size"), unit: str(sug, "unit") } : null,
    error: err,
  };
}

export interface BulkRowLike {
  key: string;
  status: string;
  applyState: "idle" | "applying" | "applied" | "failed";
  candidates: MatchCandidate[];
  selectedRm: string | null;
  manualTarget: boolean;
}

/**
 * Trygg for «Bekreft alle»: klar, ikke anvendt, valgt mål ER toppkandidaten med høy score og ikke manuelt valgt.
 * Et annet valgt mål arver aldri toppkandidatens score — det må anvendes enkeltvis.
 */
export function safeForBulk(r: BulkRowLike): boolean {
  if (r.status !== "ready" || r.applyState === "applied" || r.applyState === "applying" || r.manualTarget || !r.selectedRm) return false;
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
