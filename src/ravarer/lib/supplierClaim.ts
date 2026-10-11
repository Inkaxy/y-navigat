/**
 * Krav og prisforespørsel mot leverandør. Om en linje kan brukes, og hvilket beløp som gjelder,
 * avgjøres bare av serverens `rm_supplier_claim_preview` (live, se
 * supabase/live-mirror/20261011163255_supplier_case_verified_claim_or_inquiry.md).
 */
import type { Json } from "@/integrations/supabase/types";

export type CaseKind = "documented_claim" | "price_inquiry";
export type ClaimBasis = {
  /** Nøyaktig JSON fra forhåndsvisningen — sendes uendret tilbake ved oppretting. */
  raw: Json;
  case_kind: CaseKind;
  amount_excl_vat: number;
  observed_effect_excl_vat: number | null;
  price_reference_source: string | null;
  price_reference_date: string | null;
  price_per_base_unit: number;
  expected_price_per_base_unit: number | null;
  base_quantity: number | null;
  base_unit: string | null;
  invoice_number: string | null;
};
export type ClaimPreviewLine = { line_id: string; eligible: true; basis: ClaimBasis } | { line_id: string; eligible: false; reason: string };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseBasis(raw: Json | undefined): ClaimBasis | null {
  if (!isRec(raw)) return null;
  const kind = raw.case_kind === "documented_claim" || raw.case_kind === "price_inquiry" ? raw.case_kind : null;
  const amount = n(raw.amount_excl_vat), ppbu = n(raw.price_per_base_unit);
  if (!kind || amount == null || ppbu == null) return null;
  if (kind === "documented_claim" && !(amount > 0)) return null;
  if (kind === "price_inquiry" && amount !== 0) return null;
  const ctx = isRec(raw.invoice_context) ? raw.invoice_context : {};
  return {
    raw, case_kind: kind, amount_excl_vat: amount, observed_effect_excl_vat: n(raw.observed_effect_excl_vat),
    price_reference_source: s(raw.price_reference_source), price_reference_date: s(raw.price_reference_date),
    price_per_base_unit: ppbu, expected_price_per_base_unit: n(raw.expected_price_per_base_unit), base_quantity: n(raw.base_quantity),
    base_unit: s(raw.base_unit), invoice_number: s(ctx.invoice_number),
  };
}

/** Svar → linjer. Mangler en forespurt linje, eller er formen ugyldig, regnes den som ikke brukbar. */
export function parseClaimPreview(data: Json, requested: readonly string[]): ClaimPreviewLine[] {
  const rows = isRec(data) && Array.isArray(data.lines) ? data.lines : [];
  const byId = new Map<string, ClaimPreviewLine>();
  for (const r of rows) {
    if (!isRec(r) || typeof r.line_id !== "string") continue;
    if (r.eligible === true) {
      const b = parseBasis(r.basis as Json);
      byId.set(r.line_id, b ? { line_id: r.line_id, eligible: true, basis: b } : { line_id: r.line_id, eligible: false, reason: "ugyldig_grunnlag" });
    } else byId.set(r.line_id, { line_id: r.line_id, eligible: false, reason: s(r.reason) ?? "ukjent" });
  }
  return requested.map((id) => byId.get(id) ?? { line_id: id, eligible: false, reason: "mangler_svar" });
}

export type ClaimPlan =
  | { ok: true; kind: CaseKind; lines: { id: string; price_per_base_unit: number; basis: Json }[]; amount: number; observed: number | null }
  | { ok: false; code: "none" | "ineligible" | "mixed"; message: string; reasons: string[] };

export function planClaim(preview: ClaimPreviewLine[]): ClaimPlan {
  if (preview.length === 0) return { ok: false, code: "none", message: "Velg minst én kontrollert linje.", reasons: [] };
  const bad = preview.filter((p): p is Extract<ClaimPreviewLine, { eligible: false }> => !p.eligible);
  if (bad.length) return { ok: false, code: "ineligible", message: `${bad.length} av ${preview.length} valgte linjer kan ikke brukes i en leverandørsak nå.`, reasons: [...new Set(bad.map((b) => claimReasonText(b.reason)))] };
  const good = preview.filter((p): p is Extract<ClaimPreviewLine, { eligible: true }> => p.eligible);
  const kinds = new Set(good.map((g) => g.basis.case_kind));
  if (kinds.size > 1) return { ok: false, code: "mixed", message: "Utvalget blander dokumentert avtalepris og prisforespørsel. Velg bare én type linjer om gangen.", reasons: [] };
  const kind = good[0].basis.case_kind;
  const observed = good.every((g) => g.basis.observed_effect_excl_vat != null) ? Math.round(good.reduce((a, g) => a + (g.basis.observed_effect_excl_vat ?? 0), 0) * 100) / 100 : null;
  return {
    ok: true, kind, observed,
    amount: Math.round(good.reduce((a, g) => a + g.basis.amount_excl_vat, 0) * 100) / 100,
    lines: good.map((g) => ({ id: g.line_id, price_per_base_unit: g.basis.price_per_base_unit, basis: g.basis.raw })),
  };
}

const REASON: [RegExp, string][] = [
  [/credit_note/, "Kreditnota – ikke en prisendring"],
  [/non_nok_currency/, "Valuta må avklares"],
  [/price_observation_held/, "Prisgrunnlaget er til kontroll"],
  [/invoice_read|invoice_sum|line_arithmetic|invalid_quantity/, "Lesingen eller summen må kontrolleres mot originalen"],
  [/missing_link|invalid_tenant_link|line_needs_review/, "Varekoblingen må avklares"],
  [/package|base_quantity/, "Pakning og mengdegrunnlag må avklares"],
  [/claim_reference_stale_or_unverified|price_reference_unverified/, "Sammenligningsprisen er ikke gyldig lenger"],
  [/claim_invoice_status_unverified|cancelled/, "Fakturastatusen tillater ikke sak"],
  [/ingen_merkostnad/, "Prisen er ikke høyere enn sammenligningsprisen"],
  [/mangler_svar|ugyldig_grunnlag/, "Ikke kontrollert av serveren"],
];
export function claimReasonText(reason: string): string {
  return REASON.find(([re]) => re.test(reason))?.[1] ?? "Kan ikke kontrolleres nå";
}

export const KIND_COPY: Record<CaseKind, { action: string; title: string; amountLabel: string }> = {
  documented_claim: { action: "Krev kreditt", title: "Dokumentert krav", amountLabel: "Krav eks. mva" },
  price_inquiry: { action: "Spør om prisendringen", title: "Prisforespørsel", amountLabel: "Observert prisforskjell" },
};

const CLAIM_ERRORS: [RegExp, string][] = [
  [/claim_preview_required_or_changed/, "Grunnlaget har endret seg siden kontrollen. Kontroller linjene på nytt."],
  [/claim_some_lines_rejected/, "Minst én linje kunne ikke godtas. Ingenting er lagret — kontroller linjene på nytt."],
  [/claim_mixed_kinds_split_required/, "Utvalget blander krav og prisforespørsel. Velg én type om gangen."],
  [/claim_unverified|claim_reference_stale_or_unverified/, "Linjen er ikke kontrollert. Ingenting er lagret."],
  [/linje_allerede_i_aapen_sak/, "En av linjene ligger allerede i en åpen sak."],
  [/forbidden|Mangler skrivetilgang/, "Du har ikke skrivetilgang til fakturaer."],
];
export function claimSubmitError(raw: string | null | undefined): string {
  return CLAIM_ERRORS.find(([re]) => re.test(raw ?? ""))?.[1] ?? "Saken kunne ikke opprettes. Ingenting er lagret.";
}
