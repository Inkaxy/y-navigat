import { supabase } from "@/integrations/supabase/client";
import type { ItemType } from "@/ravarer/lib/itemTypes";

/**
 * AI-forslag for én fakturalinje — hentes kun når saksbehandleren ber om det.
 *
 * Forslaget er en gjetning fra en språkmodell, validert på serveren. Det kobler,
 * bekrefter, oppretter og godkjenner ingenting; mennesket bekrefter i eksisterende
 * skjema. Ukjent er null (aldri 0). Feiler modellen, fortsetter man manuelt.
 */
export type AiDecision = "existing" | "new_draft" | "not_raw_material" | "unclear";
export type AiLineClass = "vare" | "emballasje" | "handelsvare" | "frakt" | "pant" | "gebyr" | "rabatt" | "kreditnota" | "erstatning" | "annet";
export type AiPriceBasis = "per_enhet" | "per_pakning" | "per_kg" | "per_l" | "per_stk" | "ukjent";

export interface AiDraft {
  name: string;
  itemType: ItemType;
  category: string | null;
  baseUnit: "kg" | "l" | "stk" | null;
  supplierSku: string | null;
}
export interface AiEvidence { field: string; value: string; source: "faktura" | "kjent_vare" | "korrigering" | "forslag" }

export interface AiLineSuggestion {
  decision: AiDecision;
  rawMaterialId: string | null;
  lineClass: AiLineClass;
  confidence: number | null;
  packageSize: number | null;
  packageUnit: string | null;
  countPerPackage: number | null;
  priceBasis: AiPriceBasis;
  draft: AiDraft | null;
  evidence: AiEvidence[];
  explanation: string | null;
  uncertainties: string[];
  missing: string[];
  rejected: string[];
  model: string;
  candidateCount: number | null;
}

export type AiSuggestionReason =
  | "ingen_kandidater" | "for_lite_tekst" | "ingen_ai_konfigurasjon" | "ai_feilet" | "tidsavbrudd"
  | "ai_avslo" | "ai_ufullstendig" | "modell_utilgjengelig" | "holdt_utenfor" | "ikke_vare";

export interface AiLineSuggestionResult {
  suggestion: AiLineSuggestion | null;
  reason: AiSuggestionReason | null;
}

export const AI_REASON_LABELS: Record<AiSuggestionReason, string> = {
  ingen_kandidater: "Fant ingen kandidatvarer å foreslå blant. Søk fram varen manuelt.",
  for_lite_tekst: "Linjen har for lite tekst til et forslag. Søk fram varen manuelt.",
  ingen_ai_konfigurasjon: "AI-hjelp er ikke satt opp. Fortsett manuelt som før.",
  ai_feilet: "AI-hjelpen svarte ikke. Fortsett manuelt som før.",
  tidsavbrudd: "AI-hjelpen brukte for lang tid. Fortsett manuelt som før.",
  ai_avslo: "AI-hjelpen avslo å svare på denne linjen. Fortsett manuelt.",
  ai_ufullstendig: "AI-svaret ble ufullstendig og er ikke brukt. Fortsett manuelt.",
  modell_utilgjengelig: "AI-modellen er ikke tilgjengelig. Fortsett manuelt.",
  holdt_utenfor: "Linjen er holdt utenfor råvarebehandling. Det gis ikke vareforslag.",
  ikke_vare: "Linjen er allerede registrert som ikke-vare (frakt, pant, gebyr, rabatt e.l.). Det gis ikke vareforslag.",
};

export const LINE_CLASS_LABELS: Record<AiLineClass, string> = {
  vare: "Råvare", emballasje: "Emballasje", handelsvare: "Handelsvare", frakt: "Frakt", pant: "Pant",
  gebyr: "Gebyr", rabatt: "Rabatt", kreditnota: "Kreditnota", erstatning: "Erstatning", annet: "Annet",
};
export const PRICE_BASIS_LABELS: Record<AiPriceBasis, string> = {
  per_enhet: "per enhet på linjen", per_pakning: "per pakning", per_kg: "per kg", per_l: "per liter", per_stk: "per stk", ukjent: "ukjent",
};

const KNOWN_REASONS = Object.keys(AI_REASON_LABELS) as AiSuggestionReason[];
const DECISIONS: AiDecision[] = ["existing", "new_draft", "not_raw_material", "unclear"];
const CLASSES = Object.keys(LINE_CLASS_LABELS) as AiLineClass[];
const BASES = Object.keys(PRICE_BASIS_LABELS) as AiPriceBasis[];
const ITEM_TYPES: ItemType[] = ["ravare", "emballasje", "forbruksvare", "videresalg"];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
/** null/""/ugyldig → null. `Number(null)` er 0 og skal aldri bli et tall her. */
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
const oneOf = <T extends string>(v: unknown, list: readonly T[], fb: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fb);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string") : []);

/** Streng tolkning av serverens svar. Ukjent form → null (ikke et tomt forslag). */
export function parseAiSuggestion(raw: unknown): AiLineSuggestion | null {
  if (!isRec(raw)) return null;
  const d = isRec(raw.draft) ? raw.draft : null;
  const name = d ? str(d.name) : null;
  const decision = oneOf(raw.decision, DECISIONS, raw.raw_material_id ? "existing" : "unclear");
  const size = num(raw.package_size);
  return {
    decision,
    rawMaterialId: decision === "existing" ? str(raw.raw_material_id) : null,
    lineClass: oneOf(raw.line_class, CLASSES, "annet"),
    confidence: (() => { const c = num(raw.confidence); return c != null && c >= 0 && c <= 1 ? c : null; })(),
    packageSize: size != null && size > 0 ? size : null,
    packageUnit: str(raw.package_unit),
    countPerPackage: (() => { const c = num(raw.count_per_package); return c != null && c > 0 ? c : null; })(),
    priceBasis: oneOf(raw.price_basis, BASES, "ukjent"),
    draft: d && name ? {
      name,
      itemType: oneOf(d.item_type, ITEM_TYPES, "ravare"),
      category: str(d.category),
      baseUnit: d.base_unit === "kg" || d.base_unit === "l" || d.base_unit === "stk" ? d.base_unit : null,
      supplierSku: str(d.supplier_sku),
    } : null,
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.filter(isRec).map((e) => ({
          field: str(e.field) ?? "", value: str(e.value) ?? "",
          source: oneOf(e.source, ["faktura", "kjent_vare", "korrigering", "forslag"] as const, "forslag"),
        })).filter((e) => e.field && e.value)
      : [],
    explanation: str(raw.explanation),
    uncertainties: strs(raw.uncertainties),
    missing: strs(raw.missing),
    rejected: strs(raw.rejected),
    model: str(raw.model) ?? "",
    candidateCount: num(raw.candidate_count),
  };
}

export function parseAiSuggestionResponse(data: unknown): AiLineSuggestionResult {
  const o = isRec(data) ? data : {};
  if (o.suggestion == null) {
    const reason = str(o.reason);
    return { suggestion: null, reason: KNOWN_REASONS.includes(reason as AiSuggestionReason) ? (reason as AiSuggestionReason) : "ai_feilet" };
  }
  const s = parseAiSuggestion(o.suggestion);
  return s ? { suggestion: s, reason: null } : { suggestion: null, reason: "ai_feilet" };
}

export async function fetchAiLineSuggestion(args: {
  invoiceLineId: string;
  candidateIds?: string[];
  timeoutMs?: number;
}): Promise<AiLineSuggestionResult> {
  const timeoutMs = args.timeoutMs ?? 60_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<AiLineSuggestionResult>((resolve) => {
    timer = setTimeout(() => resolve({ suggestion: null, reason: "tidsavbrudd" }), timeoutMs);
  });
  const call = (async (): Promise<AiLineSuggestionResult> => {
    const { data, error } = await supabase.functions.invoke("suggest-invoice-line-match", {
      body: { invoice_line_id: args.invoiceLineId, candidate_ids: args.candidateIds ?? null },
    });
    if (error) return { suggestion: null, reason: "ai_feilet" };
    return parseAiSuggestionResponse(data);
  })();
  try {
    return await Promise.race([call, timeout]);
  } catch {
    return { suggestion: null, reason: "ai_feilet" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Hva «Bruk forslag» fyller inn: bare tomme, uberørte felt. Brukerens endringer vinner alltid. */
export function planAiApply(
  s: AiLineSuggestion,
  form: { selectedRmId: string | null; packageSize: string; packageUnit: string; packageTouched: boolean },
): { rawMaterialId: string | null; packageSize: string | null; packageUnit: string | null; kept: string[] } {
  const kept: string[] = [];
  let rawMaterialId: string | null = null;
  if (s.rawMaterialId) {
    if (!form.selectedRmId || form.selectedRmId === s.rawMaterialId) rawMaterialId = s.rawMaterialId;
    else kept.push("valgt vare");
  }
  // Pakningsfeltene gjelder bare forslagets egen eksisterende vare — aldri en annen manuelt valgt vare,
  // og aldri et utkast til ny vare (det fylles bare i «Ny råvare»-skjemaet).
  const sameMaterial = s.decision === "existing" && rawMaterialId != null;
  if (!sameMaterial && (s.packageSize != null || s.packageUnit) && form.selectedRmId && form.selectedRmId !== s.rawMaterialId) kept.push("pakning (gjelder ikke valgt vare)");
  let packageSize: string | null = null;
  let packageUnit: string | null = null;
  // Pakningen fylles bare inn når varen er forslagets og brukeren ikke har rørt feltene.
  if (sameMaterial && (s.packageSize != null || s.packageUnit)) {
    if (form.packageTouched || form.packageSize.trim() || form.packageUnit.trim()) kept.push("pakning");
    else {
      // Forslaget følger linjekontrakten (package_size = indre enhet, count_per_package = antall), mens
      // skjemafeltet er HELE pakningens innhold: «2x5kg» → 10 kg. Aldri size×count to ganger.
      const total = s.packageSize != null ? s.packageSize * (s.countPerPackage ?? 1) : null;
      packageSize = total != null ? String(Math.round(total * 1e6) / 1e6).replace(".", ",") : null;
      packageUnit = s.packageUnit;
    }
  }
  return { rawMaterialId, packageSize, packageUnit, kept };
}
