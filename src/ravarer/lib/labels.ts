/**
 * ÉN etikettkilde for Råvarer og Priskontroll. Hver kode har en norsk etikett,
 * en fargetoken (`--rm-*`/`--state-*`) og en kort forklaring. Ukjente koder får
 * alltid en pen fallback — rå koder skal aldri vises i grensesnittet.
 *
 * Detaljkart som allerede fantes (årsakskoder, priskilder, linjetyper,
 * forhandlingsstatus) leses herfra; de opprinnelige eksportene er beholdt for
 * bakoverkompatibilitet.
 */
import { REASON_LABELS } from "@/fakturaer/lib/reviewReasons";
import { LINE_KIND_LABEL, SUPPLIER_ITEM_STATUS_META } from "@/fakturaer/lib/supplierItems";
import { PRICE_REFERENCE_LABEL } from "@/ravarer/lib/priceReference";
import { NEGOTIATION_STATUS_LABEL } from "@/ravarer/lib/negotiationMatrix";

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
  faktura_flagget: { label: "Flagget", tokenVar: "--rm-flagget" },
  faktura_klar: { label: "Klar til avstemming", tokenVar: "--rm-avstemt" },
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
  excluded: { label: "Utelatt", tokenVar: "--rm-ikke-vare" },
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
};

/** CSS-farge for en token, til StatusPill (10 % fyll, 45 % ring). */
export const toneStyle = (tokenVar: string) => ({
  color: `hsl(var(${tokenVar}))`,
  backgroundColor: `hsl(var(${tokenVar}) / 0.1)`,
  boxShadow: `inset 0 0 0 1px hsl(var(${tokenVar}) / 0.45)`,
});
