// «Nullstill køen» (bestilling 18.11.2026) – typer og faste regler. Ren logikk, ingen skriving.
export const RESET_LABEL = "Nullstilling 18.11.2026";
export const CLOSE_TEXT = "Avsluttet ved nullstilling 18.11.2026";
/** Regel 2: prisavvik innenfor ±20 % godtas. Over = prishopp → regel 6. */
export const MAX_PRICE_PCT = 20;
/** Regel 3: pris per grunnenhet etter pakning må ligge innenfor ±20 % av varens gjeldende kostpris (eller varen har ingen). */
export const PACKAGE_GUARD = 0.2;
export const NEW_ITEM_CATEGORY = "Ny fra faktura";
export const PRICE_REASONS: readonly string[] = ["price_variance", "price_increase", "price_drop"];
export const PACKAGE_REASONS: readonly string[] = ["unknown_package_size", "no_automatic_basis", "uncertain_cost"];
export const NOT_ITEM_KINDS: readonly string[] = ["pant", "gebyr", "annet"];

export type Rule = 1 | 2 | 3 | 4 | 6;
export type Action = "ikke_vare" | "godta_pris" | "bekreft_pakning" | "koble" | "opprett" | "hold_utenfor";

export type CloseReason =
  | "sumavvik" | "prishopp_over_20" | "mangler_prisgrunnlag" | "lesevarsel" | "pakning_uleselig" | "pakning_passer_ikke"
  | "pakning_ulik" | "pris_utenfor_20" | "uten_varenummer" | "mulig_duplikat" | "flere_varer" | "inaktiv_vare"
  | "godkjent_faktura" | "kreditlinje" | "blandet_varenokkel" | "annen_linjetype" | "ukjent_kobling" | "beregnes_pa_nytt"
  | "uavklart_belop" | "mangler_leverandor" | "apen_etter_fase_1" | "annen_arsak";

export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  sumavvik: "Sumavvik på fakturaen",
  prishopp_over_20: "Prishopp over 20 %",
  mangler_prisgrunnlag: "Mangler prisgrunnlag",
  lesevarsel: "Lesevarsel eller regnefeil på linjen",
  pakning_uleselig: "Pakningen kan ikke leses entydig av linjen",
  pakning_passer_ikke: "Pakningen passer ikke varens enhet",
  pakning_ulik: "Ulik pakning på linjene for samme leverandørvare",
  pris_utenfor_20: "Pris per enhet mer enn 20 % fra kostprisen",
  uten_varenummer: "Ukoblet uten varenummer",
  mulig_duplikat: "Mulig duplikat",
  flere_varer: "Flere varer har samme varenummer hos leverandøren",
  inaktiv_vare: "Varenummeret hører til en inaktiv vare",
  godkjent_faktura: "Fakturaen er godkjent internt – prisen kan ikke godtas",
  kreditlinje: "Kreditlinje",
  blandet_varenokkel: "Pant/gebyr som deler varenøkkel med varer",
  annen_linjetype: "Frakt, rabatt, avrunding eller mva",
  ukjent_kobling: "Koblingen er bare et forslag",
  beregnes_pa_nytt: "Venter på omregning",
  uavklart_belop: "Beløpet er ikke avklart",
  mangler_leverandor: "Mangler leverandør eller varenøkkel",
  apen_etter_fase_1: "Fortsatt åpen etter regel 1–4",
  annen_arsak: "Annen årsak",
};
export const isCloseReason = (v: unknown): v is CloseReason => typeof v === "string" && v in CLOSE_REASON_LABEL;

export const RULE_LABEL: Record<Rule, string> = {
  1: "Regel 1 · Ikke vare (pant, gebyr, annet)",
  2: "Regel 2 · Prisen stemmer (avvik ≤ 20 %)",
  3: "Regel 3 · Bekreft pakning",
  4: "Regel 4 · Koble eller opprett vare",
  6: "Regel 6 · Avsluttet ved nullstilling",
};
export const RULES: readonly Rule[] = [1, 2, 3, 4, 6];
export const ACTION_LABEL: Record<Action, string> = {
  ikke_vare: "Ikke vare", godta_pris: "Prisen stemmer", bekreft_pakning: "Bekreft pakning",
  koble: "Koble til vare", opprett: "Opprett vare", hold_utenfor: "Avslutt (hold utenfor)",
};

/** Én åpen linje slik `rm_queue_reset_snapshot_lines` gir den. */
export interface SnapLine {
  line_id: string; invoice_id: string; invoice_number: string | null; invoice_date: string | null;
  supplier_id: string | null; supplier_name: string | null; lines_sum_status: string | null; is_credit_note: boolean;
  approved: boolean; cost_posted: boolean; item_key: string | null; supplier_sku: string | null; description: string | null;
  quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null; discount_amount: number | null;
  unit_price_basis: string | null; line_kind: string | null; extraction_issues: unknown;
  package_size: number | null; package_unit: string | null; count_per_package: number | null;
  raw_material_id: string | null; match_confidence: string | null; review_reason: string | null;
  price_per_base_unit: number | null; expected_price_per_base_unit: number | null; price_variance_pct: number | null;
  line_updated_at: string; read_issue: string | null;
  /** Serverens sperre for «hold utenfor» (`_rm_line_exclusion_blocker`): kostpris ført, lager, varemottak, prisobservasjon. */
  exclusion_blocker: string | null;
  rm_name: string | null; rm_base_unit: string | null; rm_cost: number | null; rm_active: boolean;
}

export interface CatalogLink { supplier_id: string; raw_material_id: string; name: string; base_unit: string | null; is_active: boolean; cost: number | null; skus: string[] }
export interface Catalog { suppliers: { id: string; name: string | null; new_item_type: string | null }[]; links: CatalogLink[] }

export interface PackagePayload { package_size: number; package_unit: string; base_units_per_package: number; confirm: true }

/** Et steg i planen. `payload` sendes uendret til serveren og brukes av utføreren. */
export interface PlanItem {
  rule: Rule; action: Action;
  supplier_id: string | null; supplier_name: string | null; item_key: string | null;
  raw_material_id: string | null; raw_material_name: string | null;
  line_ids: string[]; invoice_ids: string[];
  reason_code: CloseReason | null; detail: string | null;
  /** Pris per grunnenhet per linje (for kostanslag). */
  prices: { line_id: string; ppb: number | null; date: string | null }[];
  payload: ItemPayload;
}

export interface ItemPayload {
  title: string; supplier_name: string | null;
  cost_before?: number | null;
  package?: PackagePayload | null;
  new_raw_material?: { name: string; base_unit: string; item_type: string; category: string };
  /** Regel 2: prisen brukeren (her: forhåndsvisningen) så – serveren avviser endret pris. */
  lines?: { id: string; price_per_base_unit: number | null }[];
  /** Regel 6. */
  invoice_id?: string; line_updated_at?: string; reason_text?: string; detail?: string | null;
}

export interface RuleTotals { lines: number; supplierItems: number; rawMaterials: number; newItems: number }
export interface SupplierTotals { supplier_id: string | null; name: string; byRule: Record<Rule, number>; lines: number }
export interface CostChange { raw_material_id: string; name: string; base_unit: string | null; before: number | null; after: number; pct: number | null; rule: Rule; date: string | null }
export interface Creation { supplier_name: string | null; name: string; item_type: string; base_unit: string; package: PackagePayload | null; lines: number; price: number | null; item_key: string }

export interface Plan {
  snapshotIds: string[];
  /** Fase 1: regel 1–4 (kjøres). */
  items: PlanItem[];
  /** Anslag for regel 6 (lukkes i fase 2 hvis de fortsatt er åpne). */
  closes: PlanItem[];
  totals: Record<Rule, RuleTotals>;
  bySupplier: SupplierTotals[];
  costChanges: CostChange[];
  creations: Creation[];
  /** Regel 6-linjer som «hold utenfor» ikke tillater (serverens sperre). Ingen handling; de blir stående åpne. */
  leftOpen: LeftOpen[];
  fingerprint: string;
}
export interface LeftOpen { line_id: string; invoice_id: string; invoice_number: string | null; description: string | null; supplier_name: string | null; blocker: string; reason_code: CloseReason }
export const BLOCKER_LABEL: Record<string, string> = {
  kostpris_fort: "Kostpris er ført", lagerbevegelse: "Har lagerbevegelse", varemottak: "Varemottak er registrert",
  lagerparti: "Har lagerparti", prisobservasjon: "Har aktiv prisobservasjon",
};
