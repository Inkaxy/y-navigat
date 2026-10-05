/**
 * Klientsiden av «Hent allergener fra deklarasjon».
 * Serveren har allerede kontrollert belegg mot teksten; her leses svaret strengt
 * og regnes om til hva som faktisk skal skje med feltene i den lokale kladden.
 */

export interface SuggestedAllergen {
  code: string;
  label: string;
  evidence: string;
}
export interface AllergenSuggestion {
  sourceFingerprint: string;
  contains: SuggestedAllergen[];
  mayContain: SuggestedAllergen[];
  traceStatement: { stated: boolean; evidence: string | null };
  uncertainties: { term: string; evidence: string; note: string }[];
  rejected: { value: string; reason: string }[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function readAllergens(v: unknown): SuggestedAllergen[] | null {
  if (!Array.isArray(v)) return null;
  const out: SuggestedAllergen[] = [];
  for (const a of v) {
    if (!isObj(a) || typeof a.code !== "string" || typeof a.label !== "string" || typeof a.evidence !== "string") return null;
    if (!a.label.trim()) return null;
    out.push({ code: a.code, label: a.label, evidence: a.evidence });
  }
  return out;
}

/** Null når svaret ikke er på avtalt form — da brukes ingenting. */
export function parseAllergenSuggestion(raw: unknown): AllergenSuggestion | null {
  if (!isObj(raw) || raw.mode !== "allergens" || typeof raw.source_fingerprint !== "string") return null;
  const e = raw.extraction;
  if (!isObj(e)) return null;
  const contains = readAllergens(e.contains);
  const mayContain = readAllergens(e.mayContain);
  const t = e.traceStatement;
  if (!contains || !mayContain || !isObj(t) || typeof t.stated !== "boolean") return null;
  if (!(t.evidence === null || typeof t.evidence === "string")) return null;
  if (!Array.isArray(e.uncertainties) || !Array.isArray(e.rejected)) return null;
  const uncertainties = e.uncertainties.filter(
    (u): u is { term: string; evidence: string; note: string } =>
      isObj(u) && typeof u.term === "string" && typeof u.evidence === "string" && typeof u.note === "string",
  );
  const rejected = e.rejected.filter(
    (r): r is { value: string; reason: string } => isObj(r) && typeof r.value === "string" && typeof r.reason === "string",
  );
  // Uten sporsetning kan det ikke finnes sporfunn.
  if (!t.stated && mayContain.length) return null;
  return {
    sourceFingerprint: raw.source_fingerprint,
    contains,
    mayContain,
    traceStatement: { stated: t.stated, evidence: t.evidence as string | null },
    uncertainties,
    rejected,
  };
}

const splitLabels = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const sameSet = (a: string, b: string) => {
  const x = dedupe(splitLabels(a)).map((s) => s.toLowerCase()).sort();
  const y = dedupe(splitLabels(b)).map((s) => s.toLowerCase()).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export interface AllergenApplyPlan {
  next: { contains: string; mayContain: string };
  changes: { field: "contains" | "mayContain"; before: string; after: string }[];
  /** Et ikke-tomt felt endres — må bekreftes før det skjer. */
  needsConfirm: boolean;
}

/**
 * Hva «Bruk allergenforslag» gjør:
 * - «Inneholder» fylles bare når AI fant allergener; et tomt funn tømmer aldri feltet.
 * - «Kan inneholde spor av» endres bare når sporsetning er oppgitt. «Ikke oppgitt»
 *   er en status, ikke et allergen, og rører ikke eksisterende verdi.
 */
export function planAllergenApply(
  current: { contains: string; mayContain: string },
  s: AllergenSuggestion,
): AllergenApplyPlan {
  const next = { ...current };
  const changes: AllergenApplyPlan["changes"] = [];
  if (s.contains.length) {
    const after = dedupe(s.contains.map((a) => a.label)).join(", ");
    if (!sameSet(after, current.contains)) {
      next.contains = after;
      changes.push({ field: "contains", before: current.contains, after });
    }
  }
  if (s.traceStatement.stated && s.mayContain.length) {
    const after = dedupe(s.mayContain.map((a) => a.label)).join(", ");
    if (!sameSet(after, current.mayContain)) {
      next.mayContain = after;
      changes.push({ field: "mayContain", before: current.mayContain, after });
    }
  }
  const needsConfirm = changes.some((c) => c.before.trim() !== "");
  return { next, changes, needsConfirm };
}

export const ALLERGEN_FIELD_LABEL: Record<"contains" | "mayContain", string> = {
  contains: "Inneholder",
  mayContain: "Kan inneholde spor av",
};
