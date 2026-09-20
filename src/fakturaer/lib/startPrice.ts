import { supabase } from "@/integrations/supabase/client";

/**
 * Startpris — ÉN kilde til hva klienten kan si om startpris.
 *
 * Alle regler avgjøres på serveren (`rm_start_price_eligibility`,
 * `rm_confirm_start_price`). Denne filen oversetter bare serverens svar til
 * norsk og gir typede kall. Klienten bestemmer ALDRI selv om en linje er
 * kvalifisert — den viser bare det serveren har svart.
 */

/** Sperrene serveren kan returnere. Ukjente koder vises ærlig som ukjente. */
export const START_PRICE_BLOCKERS = [
  "mangler_linje",
  "linjen_finnes_ikke",
  "fakturaen_finnes_ikke",
  "linjen_er_ikke_koblet_til_vare",
  "varen_finnes_ikke",
  "faktura_og_vare_i_ulike_selskap",
  "fakturaen_mangler_leverandor",
  "kreditnota",
  "annen_valuta",
  "fakturaen_mangler_dato",
  "varen_mangler_grunnenhet",
  "linjen_star_til_gjennomgang",
  "koblingen_er_ikke_manuelt_bekreftet",
  "ugyldig_nettobelop",
  "ugyldig_mengde",
  "ukjent_mengde_i_grunnenhet",
  "ugyldig_pris_per_grunnenhet",
  "mangler_leverandorkobling",
  "ukjent_pakning",
  "startpris_finnes_allerede",
  "leverandor_i_annet_selskap",
  "fakturaen_er_flagget",
  "uavklart_gjennomgangsarsak",
  "inkonsistent_gjennomgangsstatus",
  "utdaterte_beregnede_verdier",
  "mengden_stemmer_ikke_med_pakningen",
  "enhet_endret_etter_fakturalinjen",
  "pakning_ikke_bekreftet_etter_enhetsendring",
  "enhet_passer_ikke_med_grunnenheten",
  "ukjent_enhet_pa_linjen",
] as const;
export type StartPriceBlocker = (typeof START_PRICE_BLOCKERS)[number];

const BLOCKER_LABELS: Record<StartPriceBlocker, string> = {
  mangler_linje: "Ingen fakturalinje er valgt.",
  linjen_finnes_ikke: "Fakturalinjen finnes ikke lenger.",
  fakturaen_finnes_ikke: "Fakturaen finnes ikke lenger.",
  linjen_er_ikke_koblet_til_vare: "Linjen er ikke koblet til en vare ennå.",
  varen_finnes_ikke: "Varen finnes ikke lenger.",
  faktura_og_vare_i_ulike_selskap: "Fakturaen og varen hører til ulike selskap.",
  fakturaen_mangler_leverandor: "Fakturaen mangler leverandør.",
  kreditnota: "Kreditnota kan ikke gi startpris.",
  annen_valuta: "Fakturaen er ikke i norske kroner.",
  fakturaen_mangler_dato: "Fakturaen mangler dato.",
  varen_mangler_grunnenhet: "Varen mangler grunnenhet.",
  linjen_star_til_gjennomgang: "Linjen står fortsatt til gjennomgang.",
  koblingen_er_ikke_manuelt_bekreftet: "Koblingen mellom linje og vare må bekreftes manuelt først.",
  ugyldig_nettobelop: "Nettobeløpet på linjen er ikke et gyldig positivt tall.",
  ugyldig_mengde: "Mengden på linjen er ikke et gyldig positivt tall.",
  ukjent_mengde_i_grunnenhet: "Mengden i grunnenhet er ikke avklart.",
  ugyldig_pris_per_grunnenhet: "Prisen per grunnenhet er ikke et gyldig positivt tall.",
  mangler_leverandorkobling: "Varen er ikke koblet til denne leverandøren.",
  ukjent_pakning: "Pakningen er ikke bekreftet for denne leverandøren.",
  startpris_finnes_allerede: "Det finnes allerede en bekreftet startpris.",
  leverandor_i_annet_selskap: "Leverandøren på fakturaen hører til et annet selskap.",
  fakturaen_er_flagget: "Fakturaen er flagget og må avklares først.",
  uavklart_gjennomgangsarsak: "Linjen har en uavklart gjennomgangsårsak.",
  inkonsistent_gjennomgangsstatus:
    "Linjen har en gjennomgangsårsak, men er ikke merket til gjennomgang. Kjør kontrollen på nytt.",
  utdaterte_beregnede_verdier:
    "Prisen per grunnenhet stemmer ikke med beløp og mengde på linjen. Kjør beregningen på nytt.",
  mengden_stemmer_ikke_med_pakningen: "Mengden i grunnenhet stemmer ikke med den bekreftede pakningen.",
  enhet_endret_etter_fakturalinjen: "Grunnenheten er endret etter at denne linjen ble hentet inn.",
  pakning_ikke_bekreftet_etter_enhetsendring: "Pakningen må bekreftes på nytt etter enhetsendringen.",
  enhet_passer_ikke_med_grunnenheten:
    "Enheten på fakturalinjen kan ikke regnes om til varens grunnenhet (for eksempel liter mot kilo).",
  ukjent_enhet_pa_linjen: "Enheten på fakturalinjen mangler eller er ukjent, så mengden kan ikke kontrolleres.",
};

export function blockerLabel(code: string): string {
  return (BLOCKER_LABELS as Record<string, string>)[code] ?? `Ukjent sperre (${code})`;
}

export interface StartPriceEligibility {
  eligible: boolean;
  blockers: string[];
  raw_material_supplier_id: string | null;
  raw_material_id: string | null;
  supplier_id: string | null;
  legal_entity_id: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  price_per_base_unit: number | null;
  base_quantity: number | null;
  total_amount: number | null;
  currency: string;
  base_unit: string | null;
  base_units_per_package: number | null;
  package_size: number | null;
  package_unit: string | null;
  existing_start_price: number | null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseEligibility(raw: unknown): StartPriceEligibility {
  const o = (raw ?? {}) as Record<string, unknown>;
  const blockers = Array.isArray(o.blockers) ? o.blockers.map((b) => String(b)) : [];
  return {
    eligible: o.eligible === true,
    blockers,
    raw_material_supplier_id: str(o.raw_material_supplier_id),
    raw_material_id: str(o.raw_material_id),
    supplier_id: str(o.supplier_id),
    legal_entity_id: str(o.legal_entity_id),
    invoice_id: str(o.invoice_id),
    invoice_number: str(o.invoice_number),
    invoice_date: str(o.invoice_date),
    price_per_base_unit: num(o.price_per_base_unit),
    base_quantity: num(o.base_quantity),
    total_amount: num(o.total_amount),
    currency: str(o.currency) ?? "NOK",
    base_unit: str(o.base_unit),
    base_units_per_package: num(o.base_units_per_package),
    package_size: num(o.package_size),
    package_unit: str(o.package_unit),
    existing_start_price: num(o.existing_start_price),
  };
}

export async function fetchStartPriceEligibility(invoiceLineId: string): Promise<StartPriceEligibility> {
  const { data, error } = await supabase.rpc("rm_start_price_eligibility", { p_invoice_line_id: invoiceLineId });
  if (error) throw error;
  return parseEligibility(data);
}

export interface StartPriceConfirmResult {
  created: boolean;
  reason: string | null;
  start_price: number | null;
  currency: string | null;
  base_unit: string | null;
  effective_date: string | null;
  check: StartPriceEligibility | null;
}

const CONFIRM_REASON_LABELS: Record<string, string> = {
  allerede_bekreftet_fra_denne_linjen: "Startprisen var allerede bekreftet fra denne linjen.",
  startpris_finnes_allerede: "En annen bekreftelse rakk først — startprisen står allerede.",
  ikke_kvalifisert: "Linjen kvalifiserer ikke lenger til startpris.",
  utdatert_forslag: "Forslaget var utdatert — prisen på linjen er endret. Kontroller på nytt.",
  ugyldig_linje: "Fakturalinjen kunne ikke leses.",
  mangler_leverandorkobling: "Varen er ikke koblet til denne leverandøren.",
};

export function confirmReasonLabel(code: string | null): string {
  if (!code) return "Startprisen ble ikke lagret.";
  return CONFIRM_REASON_LABELS[code] ?? `Startprisen ble ikke lagret (${code}).`;
}

/**
 * Bekrefter startpris. Serveren låser koblingen, vurderer på nytt og er
 * idempotent: gjentatt bekreftelse gir `created: false` uten å endre noe.
 */
export async function confirmStartPrice(
  invoiceLineId: string,
  expectedPrice: number | null,
): Promise<StartPriceConfirmResult> {
  const { data, error } = await supabase.rpc("rm_confirm_start_price", {
    p_invoice_line_id: invoiceLineId,
    p_expected_price: expectedPrice ?? undefined,
  });
  if (error) throw error;
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    created: o.created === true,
    reason: str(o.reason),
    start_price: num(o.start_price),
    currency: str(o.currency),
    base_unit: str(o.base_unit),
    effective_date: str(o.start_price_effective_date),
    check: o.check ? parseEligibility(o.check) : null,
  };
}

export interface StartPriceCandidate {
  raw_material_supplier_id: string;
  raw_material_id: string;
  raw_material_name: string | null;
  base_unit: string | null;
  supplier_id: string;
  supplier_name: string | null;
  invoice_line_id: string;
  description: string | null;
  price_per_base_unit: number | null;
  base_quantity: number | null;
  total_amount: number | null;
  invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  currency: string;
}

export async function fetchStartPriceCandidates(
  legalEntityId: string,
  supplierId: string | null,
  limit = 100,
): Promise<StartPriceCandidate[]> {
  const { data, error } = await supabase.rpc("rm_start_price_candidates", {
    p_legal_entity_id: legalEntityId,
    p_supplier_id: supplierId ?? undefined,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      raw_material_supplier_id: String(o.raw_material_supplier_id ?? ""),
      raw_material_id: String(o.raw_material_id ?? ""),
      raw_material_name: str(o.raw_material_name),
      base_unit: str(o.base_unit),
      supplier_id: String(o.supplier_id ?? ""),
      supplier_name: str(o.supplier_name),
      invoice_line_id: String(o.invoice_line_id ?? ""),
      description: str(o.description),
      price_per_base_unit: num(o.price_per_base_unit),
      base_quantity: num(o.base_quantity),
      total_amount: num(o.total_amount),
      invoice_id: String(o.invoice_id ?? ""),
      invoice_number: str(o.invoice_number),
      invoice_date: str(o.invoice_date),
      currency: str(o.currency) ?? "NOK",
    } satisfies StartPriceCandidate;
  });
}

export const START_PRICE_QUERY_KEYS = {
  eligibility: (lineId: string) => ["start-price-eligibility", lineId] as const,
  candidates: (entityId: string | null, supplierId: string | null) =>
    ["start-price-candidates", entityId ?? "none", supplierId ?? "all"] as const,
};

/**
 * Fjerner en bekreftet startpris. Krever godkjennerrettighet og begrunnelse —
 * begge håndheves på serveren, som også skriver revisjonsspor.
 */
export async function clearStartPrice(rmsId: string, reason: string): Promise<{ cleared: boolean; reason: string | null }> {
  const { data, error } = await supabase.rpc("rm_clear_start_price", { p_rms_id: rmsId, p_reason: reason });
  if (error) throw error;
  const o = (data ?? {}) as Record<string, unknown>;
  return { cleared: o.cleared === true, reason: str(o.reason) };
}

/**
 * Gjør en bekreftet startpris om til avtalepris.
 *
 * Avtalen får en NY gyldighetsdato (i dag som standard) — en ny pris arver
 * aldri den gamle avtaleperioden. Skjermbildet sender med startprisen og
 * pakningen brukeren faktisk så, slik at serveren kan avvise en utdatert
 * visning, og en eksisterende avtalepris erstattes bare når brukeren
 * uttrykkelig har bekreftet det.
 */
export async function startPriceToAgreement(args: {
  rmsId: string;
  reason: string;
  expectedStartPrice: number | null;
  expectedUnitChangeAt: string | null;
  expectedPackageSize: number | null;
  expectedPackageUnit: string | null;
  expectedBaseUnitsPerPackage: number | null;
  replaceExisting: boolean;
  validFrom?: string | null;
}): Promise<{
  updated: boolean;
  agreedPricePerBaseUnit: number | null;
  validFrom: string | null;
  validTo: string | null;
  replacedExisting: boolean;
}> {
  const { data, error } = await supabase.rpc("rm_start_price_to_agreement", {
    p_rms_id: args.rmsId,
    p_reason: args.reason,
    p_expected_start_price: args.expectedStartPrice,
    p_expected_unit_change_at: args.expectedUnitChangeAt,
    p_expected_package_size: args.expectedPackageSize,
    p_expected_package_unit: args.expectedPackageUnit,
    p_expected_base_units_per_package: args.expectedBaseUnitsPerPackage,
    p_replace_existing: args.replaceExisting,
    p_valid_from: args.validFrom ?? null,
  });
  if (error) throw error;
  const o = (data ?? {}) as Record<string, unknown>;
  return {
    updated: o.updated === true,
    agreedPricePerBaseUnit: num(o.agreed_price_per_base_unit),
    validFrom: str(o.agreement_valid_from),
    validTo: str(o.agreement_valid_to),
    replacedExisting: o.replaced_existing === true,
  };
}

/**
 * Startprisen er ugyldig som grunnlag når grunnenheten på varen er endret
 * etter at den ble bekreftet. Da må den bekreftes på nytt.
 */
export function startPriceIsStale(args: {
  startPriceBaseUnit: string | null;
  currentBaseUnit: string | null;
  startPrice: number | null;
}): boolean {
  if (args.startPrice == null) return false;
  if (!args.startPriceBaseUnit || !args.currentBaseUnit) return true;
  return args.startPriceBaseUnit !== args.currentBaseUnit;
}
