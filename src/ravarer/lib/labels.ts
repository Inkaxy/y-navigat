/**
 * ÉN etikettkilde for Råvarer og Priskontroll. Hver kode har en norsk etikett,
 * en fargetoken (`--rm-*`/`--state-*`) og en kort forklaring. Ukjente koder får
 * alltid en pen fallback — rå koder skal aldri vises i grensesnittet.
 *
 * Grunnkartene (årsakskoder, priskilder, linjetyper, leverandørvarestatus,
 * forhandlingsstatus) DEFINERES her; de gamle modulene re-eksporterer dem tynt.
 */
import type { ReasonCode } from "@/fakturaer/lib/reviewReasons";
import type { SupplierItemStatus } from "@/fakturaer/lib/supplierItems";
import type { StatusTone } from "@/fakturaer/lib/lineStatus";
import type { PriceRefSource } from "@/fakturaer/lib/parseRpcJson";

export const SUPPLIER_ITEM_STATUS_META: Record<SupplierItemStatus, { label: string; tone: StatusTone }> = {
  ukoblet: { label: "Ukoblet", tone: "danger" },
  mangler_pakning: { label: "Mangler pakning", tone: "warning" },
  prisavvik: { label: "Prisavvik", tone: "warning" },
  kontroll: { label: "Kontroll", tone: "warning" },
  koblet: { label: "Koblet", tone: "success" },
  ikke_vare: { label: "Ikke vare", tone: "muted" },
};

export const LINE_KIND_LABEL: Record<string, string> = {
  vare: "Vare",
  pant: "Pant",
  frakt: "Frakt",
  gebyr: "Gebyr",
  rabatt: "Rabatt",
  avrunding: "Avrunding",
  mva: "Mva",
  annet: "Annet",
};

export const PRICE_REFERENCE_LABEL: Record<PriceRefSource, string> = {
  agreement: "Avtalepris",
  start_price: "Startpris",
  last_purchase: "Siste kjøp",
  conflict: "To likestilte avtaler — konflikt",
  none: "Ingen prisgrunnlag",
};

export const REASON_LABELS: Record<ReasonCode, string> = {
  unmatched: "Umatchet",
  low_confidence: "Lav tillit",
  price_variance: "Prisavvik",
  price_increase: "Prisøkning",
  price_drop: "Prisfall",
  uncertain_cost: "Usikker kostpris",
  unknown_package_size: "Ukjent pakningsstørrelse",
  package_conflict: "Flere pakninger hos leverandøren",
  sku_collision: "Konflikt",
  unsupported_currency: "Valuta ikke støttet",
  agreement_conflict: "To likestilte avtaler",
  price_reference_error: "Prisgrunnlag kunne ikke hentes",
  recalculation_pending: "Må beregnes på nytt",
  extraction_unresolved: "Beløp mangler i dokumentet",
  missing_base_unit: "Varen mangler grunnenhet",
  start_price_manual_check: "Startpris må kontrolleres manuelt",
  no_automatic_basis: "Uten gyldig prisgrunnlag",
  no_baseline: "Uten prisgrunnlag",
  extraction_issue: "Uttrekk eller sum stemmer ikke",
  zero_quantity: "Mengde mangler eller er null",
};

export const NEGOTIATION_STATUS_LABEL: Record<string, string> = {
  draft: "Utkast",
  invited: "Invitert",
  in_progress: "Pågår",
  awaiting_confirmation: "Venter på bekreftelse",
  concluded: "Avsluttet",
  cancelled: "Avbrutt",
};

export type LabelMeta = { label: string; tokenVar: string; hint?: string };
export type LabelMap = Record<string, LabelMeta>;

export const FALLBACK_LABEL = "Annen årsak";
const NEUTRAL = "--state-neutral";

/** Slår opp en kode; ukjent eller tom kode gir en pen fallback. */
export function labelFor(map: LabelMap, code: string | null | undefined, fallback = FALLBACK_LABEL): LabelMeta {
  if (code && Object.prototype.hasOwnProperty.call(map, code)) return map[code];
  return { label: fallback, tokenVar: NEUTRAL };
}

export const SUPPLIER_ITEM_STATUS_LABELS: LabelMap = {
  ukoblet: { label: SUPPLIER_ITEM_STATUS_META.ukoblet.label, tokenVar: "--rm-ukoblet", hint: "Leverandørvaren er ikke koblet til en råvare." },
  mangler_pakning: { label: SUPPLIER_ITEM_STATUS_META.mangler_pakning.label, tokenVar: "--rm-pakning", hint: "Pakningsinnholdet er ikke bekreftet." },
  prisavvik: { label: SUPPLIER_ITEM_STATUS_META.prisavvik.label, tokenVar: "--rm-pris", hint: "Prisen avviker fra prisgrunnlaget." },
  kontroll: { label: SUPPLIER_ITEM_STATUS_META.kontroll.label, tokenVar: "--rm-kontroll", hint: "Noe annet må sjekkes." },
  koblet: { label: SUPPLIER_ITEM_STATUS_META.koblet.label, tokenVar: "--rm-koblet", hint: "Alt er i orden." },
  ikke_vare: { label: SUPPLIER_ITEM_STATUS_META.ikke_vare.label, tokenVar: "--rm-ikke-vare", hint: "Linjen er ikke en vare (frakt, gebyr o.l.)." },
};

export const WORK_GROUP_LABELS: LabelMap = {
  alle: { label: "Alle", tokenVar: NEUTRAL },
  kobling: { label: "Kobling", tokenVar: "--rm-ukoblet", hint: "Leverandørvarer som mangler råvare." },
  pakning: { label: "Pakning", tokenVar: "--rm-pakning", hint: "Pakningsinnhold som må bekreftes." },
  pris: { label: "Pris", tokenVar: "--rm-pris", hint: "Prisavvik som må vurderes." },
  kontroll: { label: "Kontroll", tokenVar: "--rm-kontroll", hint: "Annet som må sjekkes." },
  fakturaer: { label: "Fakturaer", tokenVar: "--rm-flagget", hint: "Fakturaer som trenger deg." },
};

export const WORK_KIND_LABELS: LabelMap = {
  ukoblet: { label: "Ukoblet vare", tokenVar: "--rm-ukoblet" },
  mangler_pakning: { label: "Mangler pakning", tokenVar: "--rm-pakning" },
  prisavvik: { label: "Prisavvik", tokenVar: "--rm-pris" },
  kontroll: { label: "Kontroll", tokenVar: "--rm-kontroll" },
  faktura_mangler_linjer: { label: "Mangler linjer", tokenVar: "--rm-ukoblet", hint: "Fakturalinjene er ikke lest inn." },
  faktura_sumavvik: { label: "Sum stemmer ikke", tokenVar: "--rm-pris", hint: "Linjesummen avviker fra fakturabeløpet." },
  faktura_flagget: { label: "Flagget", tokenVar: "--rm-flagget", hint: "Fakturaen er flagget for oppfølging." },
  faktura_klar: { label: "Klar til avstemming", tokenVar: "--rm-avstemt", hint: "Alle linjer er avklart og summen stemmer." },
};

export const INVOICE_STATUS_LABELS: LabelMap = {
  imported: { label: "Importert", tokenVar: "--state-info" },
  needs_review: { label: "Til behandling", tokenVar: "--state-warning" },
  ready: { label: "Klar", tokenVar: "--rm-kontroll" },
  reconciled: { label: "Avstemt", tokenVar: "--rm-avstemt" },
  reconciled_auto: { label: "Avstemt automatisk", tokenVar: "--rm-auto" },
  reconciled_manual: { label: "Avstemt manuelt", tokenVar: "--rm-avstemt" },
  flagged: { label: "Flagget", tokenVar: "--rm-flagget" },
  cancelled: { label: "Kansellert", tokenVar: NEUTRAL },
  approved: { label: "Godkjent", tokenVar: "--rm-godkjent" },
  credit_note: { label: "Kreditnota", tokenVar: "--rm-kreditnota" },
};

/** Fakturastatus der avstemt skilles på automatisk/manuelt. */
export function invoiceStatusLabel(status: string | null | undefined, reconciledMode?: string | null): LabelMeta {
  if (status === "reconciled" && reconciledMode === "auto") return INVOICE_STATUS_LABELS.reconciled_auto;
  if (status === "reconciled" && reconciledMode) return INVOICE_STATUS_LABELS.reconciled_manual;
  return labelFor(INVOICE_STATUS_LABELS, status, "Ukjent status");
}

export const LINE_STATUS_LABELS: LabelMap = {
  ok: { label: "I orden", tokenVar: "--rm-koblet" },
  review: { label: "Til kontroll", tokenVar: "--rm-kontroll" },
  excluded: { label: "Ikke vare", tokenVar: "--rm-ikke-vare" },
  posted: { label: "Kostpris ført", tokenVar: "--rm-avstemt" },
  flagged: { label: "Flagget", tokenVar: "--rm-flagget" },
};

const REASON_TOKEN: Record<string, string> = {
  unmatched: "--rm-ukoblet", low_confidence: "--rm-kontroll", price_variance: "--rm-pris", price_increase: "--rm-pris",
  price_drop: "--rm-pris", uncertain_cost: "--rm-kontroll", unknown_package_size: "--rm-pakning",
  package_conflict: "--rm-pakning", missing_base_unit: "--rm-pakning", agreement_conflict: "--rm-pris",
  no_automatic_basis: "--rm-kontroll", no_baseline: "--rm-kontroll", start_price_manual_check: "--rm-kontroll",
};

export const REVIEW_REASON_LABELS: LabelMap = {
  ...Object.fromEntries(
    Object.entries(REASON_LABELS).map(([k, label]) => [k, { label, tokenVar: REASON_TOKEN[k] ?? "--rm-kontroll" }]),
  ),
  start_price: { label: "Startpris", tokenVar: "--rm-kontroll" },
};

export const PRICE_SOURCE_LABELS: LabelMap = Object.fromEntries(
  Object.entries(PRICE_REFERENCE_LABEL).map(([k, label]) => [k, { label, tokenVar: k === "conflict" ? "--rm-pris" : k === "none" ? NEUTRAL : "--rm-kontroll" }]),
);

export const LINE_KIND_LABELS: LabelMap = Object.fromEntries(
  Object.entries(LINE_KIND_LABEL).map(([k, label]) => [k, { label, tokenVar: k === "vare" ? "--rm-koblet" : "--rm-ikke-vare" }]),
);

export const NEGOTIATION_STATUS_LABELS: LabelMap = Object.fromEntries(
  Object.entries(NEGOTIATION_STATUS_LABEL).map(([k, label]) => [
    k, { label, tokenVar: k === "concluded" ? "--state-success" : k === "cancelled" ? NEUTRAL : "--state-info" },
  ]),
);

export const ACTIVITY_KIND_LABELS: LabelMap = {
  faktura_avstemt_auto: { label: "Avstemt automatisk", tokenVar: "--rm-auto" },
  faktura_avstemt: { label: "Avstemt", tokenVar: "--rm-avstemt" },
  faktura_gjenapnet: { label: "Gjenåpnet", tokenVar: "--state-warning" },
  mva_rettet: { label: "Mva rettet", tokenVar: "--rm-kontroll" },
  kostpris_fort: { label: "Kostpris ført", tokenVar: "--rm-avstemt" },
  pakning_bekreftet_auto: { label: "Pakning bekreftet automatisk", tokenVar: "--rm-auto" },
  priser_karantene: { label: "Priser i karantene", tokenVar: "--rm-flagget" },
  pris_godtatt: { label: "Pris godtatt", tokenVar: "--rm-godkjent" },
  kobling_bekreftet: { label: "Kobling bekreftet", tokenVar: "--rm-koblet" },
  ikke_vare: { label: "Merket som ikke vare", tokenVar: "--rm-ikke-vare" },
  forste_pris: { label: "Første pris", tokenVar: "--rm-kontroll" },
  gjentatt_pris: { label: "Ny pris bekreftet", tokenVar: "--rm-godkjent" },
  annet: { label: "Annen hendelse", tokenVar: NEUTRAL },
};

/** Status for Tripletex-synk (credentials og synk-logg). */
export const SYNC_STATUS_LABELS: LabelMap = {
  success: { label: "Vellykket", tokenVar: "--state-success" },
  ok: { label: "Vellykket", tokenVar: "--state-success" },
  imported: { label: "Importert", tokenVar: "--state-success" },
  partial: { label: "Delvis", tokenVar: "--state-warning" },
  error: { label: "Feilet", tokenVar: "--state-danger" },
  failed: { label: "Feilet", tokenVar: "--state-danger" },
  running: { label: "Pågår", tokenVar: "--state-info" },
  pending: { label: "Venter", tokenVar: NEUTRAL },
  skipped: { label: "Hoppet over", tokenVar: NEUTRAL },
  none: { label: "Ingen nye", tokenVar: NEUTRAL },
};

/** CSS-farge for en token, til StatusPill (10 % fyll, 45 % ring). */
export const toneStyle = (tokenVar: string) => ({
  color: `hsl(var(${tokenVar}))`,
  backgroundColor: `hsl(var(${tokenVar}) / 0.1)`,
  boxShadow: `inset 0 0 0 1px hsl(var(${tokenVar}) / 0.45)`,
});

/**
 * Alle koder `invoice_approval_blockers` kan returnere (lest fra live-definisjonen).
 * Testen vokter at hver kode har en norsk etikett.
 */
export const APPROVAL_BLOCKER_CODES = [
  "finnes_ikke", "flagget", "kansellert", "leverandor_mangler", "belop_mangler", "mva_ukjent", "valuta_mangler",
  "mangler_linjer", "sumavvik", "sum_ukontrollert", "lavt_uttrekk", "duplikat", "mengde", "prisavvik", "leverandorsak",
] as const;
export type ApprovalBlockerCode = (typeof APPROVAL_BLOCKER_CODES)[number];

export function isApprovalBlockerCode(v: string): v is ApprovalBlockerCode {
  return (APPROVAL_BLOCKER_CODES as readonly string[]).includes(v);
}

export const APPROVAL_BLOCKER_LABEL: Record<ApprovalBlockerCode, string> = {
  flagget: "Fakturaen er flagget",
  kansellert: "Fakturaen er kansellert",
  sumavvik: "Linjesummen stemmer ikke med fakturabeløpet",
  mangler_linjer: "Fakturaen har ingen linjer",
  duplikat: "Samme fakturanummer finnes fra før hos leverandøren",
  mengde: "Mengde eller uttrekk på en linje må kontrolleres",
  prisavvik: "Prisavvik er ikke avklart",
  leverandorsak: "Holdes igjen av en åpen leverandørsak",
  finnes_ikke: "Fakturaen finnes ikke",
  leverandor_mangler: "Leverandør mangler",
  belop_mangler: "Fakturabeløpet mangler",
  mva_ukjent: "Mva-beløpet er ukjent",
  valuta_mangler: "Valuta mangler",
  sum_ukontrollert: "Linjesummen er ikke kontrollert mot fakturabeløpet",
  lavt_uttrekk: "Fakturaen er tolket med lav sikkerhet — kontroller registreringen",
};

export const SUPPLIER_CASE_STATUS_LABELS: LabelMap = {
  open: { label: "Åpen", tokenVar: "--state-warning" },
  resolved: { label: "Løst", tokenVar: "--state-success" },
  cancelled: { label: "Avbrutt", tokenVar: "--state-neutral" },
};

/** Norske etiketter for hendelser i revisjonsloggen (`rm_audit_history`). */
export const AUDIT_ACTION_LABEL: Readonly<Record<string, string>> = {
  "invoice.internal_approved": "Internt godkjent",
  "invoice.internal_approval_revoked": "Godkjenning trukket tilbake",
  "invoice.safe_costs_posted": "Kostpris ført for trygge linjer",
  "invoice.auto_reconciled": "Avstemt automatisk",
  "invoice.auto_reconcile_reopened": "Automatisk avstemming åpnet igjen",
  "invoice.reconciled": "Avstemt",
  "invoice.vat_repaired": "Mva rettet",
  "supplier_link.changed": "Kobling endret",
  invoice_line_match_confirmed: "Råvare/pakning bekreftet",
  "package.auto_confirmed": "Pakning bekreftet automatisk",
  "supplier_item.linked": "Koblet",
  "supplier_item.not_item": "Merket som ikke vare",
  "supplier_item.price_accepted": "Pris godtatt",
  "supplier_item.credit_claimed": "Kreditt krevd",
  "invoice_line.price_variance_accepted": "Pris godtatt",
  "prices.quarantined": "Priser satt i karantene",
  "supplier_case.created": "Sak opprettet",
  "supplier_case.status": "Status endret",
  "supplier_case.credit_allocated": "Kreditt fordelt",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? "Endring";
}
