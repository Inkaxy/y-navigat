import { NEGOTIATION_STATUS_LABEL } from "@/ravarer/lib/labels";
import { isBaseUnit, normalizeUnit, toBaseFactor } from "@/fakturaer/lib/units";

/**
 * Norske etiketter for statusene i forhandlingsmodulen. Rå enum-verdier skal
 * aldri vises i grensesnittet.
 */
// Kilde: `@/ravarer/lib/labels` (ett statusspråk). Re-eksportert for bakoverkompatibilitet.
export { NEGOTIATION_STATUS_LABEL } from "@/ravarer/lib/labels";

export const RECIPIENT_STATUS_LABEL: Record<string, string> = {
  invited: "Invitert",
  viewed: "Åpnet",
  responded: "Har svart",
  declined: "Takket nei",
  expired: "Utløpt",
  locked: "Låst",
};

export function negotiationStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return NEGOTIATION_STATUS_LABEL[status] ?? "Ukjent status";
}

export function recipientStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return RECIPIENT_STATUS_LABEL[status] ?? "Ukjent status";
}

/** Forhandlingen er avsluttet eller avbrutt — ingen redigering. */
export function isNegotiationClosed(status: string | null | undefined): boolean {
  return status === "concluded" || status === "cancelled";
}

export interface OfferInput {
  /** Prisen leverandøren oppga. */
  offeredPrice: number | null | undefined;
  /** Pakningsstørrelse i tilbudet, hvis oppgitt. */
  offeredPackageSize?: number | null;
  /** Pakningsenhet i tilbudet, hvis oppgitt. */
  offeredPackageUnit?: string | null;
  /** Varens grunnenhet (kg, l, stk …). */
  baseUnit: string | null | undefined;
  /** Antall grunnenheter per emballasjeenhet fra DENNE leverandørens bekreftede kobling — aldri råvarens globale tall. */
  linkBaseUnitsPerPackage?: number | null;
}

export interface OfferPerBaseUnit {
  /** Pris per grunnenhet, eller null når den ikke kan regnes ut trygt. */
  value: number | null;
  /** Kort forklaring når prisen ikke kunne regnes om. */
  reason: string | null;
}

/**
 * Regner et tilbud om til pris per grunnenhet.
 *
 * - Er pakningsenheten den samme målestørrelsen som grunnenheten (kg/g, l/ml),
 *   regnes pakningen om og prisen deles på antall grunnenheter.
 * - Er pakningsenheten en emballasjeenhet (sekk, kartong), brukes antall
 *   grunnenheter per pakning fra leverandørkoblingen.
 * - Mangler begge deler, returneres null i stedet for et gjett.
 */
export function offerPricePerBaseUnit(input: OfferInput): OfferPerBaseUnit {
  // Ingen tvang via Number(): null/tom pris blir aldri 0. Eksplisitt endelig 0 er en pris.
  const raw = input.offeredPrice;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return { value: null, reason: "Ingen pris" };
  const price = raw;
  const base = normalizeUnit(input.baseUnit);
  if (!base) return { value: null, reason: "Ukjent grunnenhet" };

  const size = typeof input.offeredPackageSize === "number" && Number.isFinite(input.offeredPackageSize) ? input.offeredPackageSize : null;
  const hasSize = size != null && size > 0;
  const unitRaw = input.offeredPackageUnit?.trim() ? input.offeredPackageUnit : null;

  // Ingen pakning oppgitt: prisen gjelder én grunnenhet (portalens kontrakt).
  if (!hasSize && !unitRaw) return { value: price, reason: null };
  if (!hasSize || !unitRaw) return { value: null, reason: "Ufullstendig pakning" };

  const unit = normalizeUnit(unitRaw);
  const factor = toBaseFactor(unit, base);
  if (factor != null && factor > 0) return { value: price / (size * factor), reason: null };
  // Målt enhet i en annen dimensjon (l mot kg): aldri omregning via noe pakningstall.
  if (unit && isBaseUnit(unit)) return { value: null, reason: "Annen målestørrelse enn grunnenheten" };

  // Emballasjeenhet (sekk, kartong): bare leverandørspesifikt, bekreftet antall grunnenheter.
  const linkUnits = typeof input.linkBaseUnitsPerPackage === "number" && Number.isFinite(input.linkBaseUnitsPerPackage) ? input.linkBaseUnitsPerPackage : null;
  if (linkUnits != null && linkUnits > 0) return { value: price / (size * linkUnits), reason: null };
  return { value: null, reason: "Ukjent pakningsenhet" };
}

/** Finner beste (laveste) tilbud per grunnenhet. Returnerer mottaker-ID. */
export function bestOfferRecipient(
  offers: { recipientId: string; pricePerBaseUnit: number | null }[],
): string | null {
  let best: { recipientId: string; price: number } | null = null;
  for (const o of offers) {
    if (o.pricePerBaseUnit == null || !Number.isFinite(o.pricePerBaseUnit)) continue;
    if (!best || o.pricePerBaseUnit < best.price) best = { recipientId: o.recipientId, price: o.pricePerBaseUnit };
  }
  return best?.recipientId ?? null;
}

/** Standard målsetting når forhandlingen ikke har et eget målnivå. */
export const DEFAULT_TARGET_PCT = 5;

/**
 * Målprosent for en linje: utledes av linjens målpris mot baseline når begge
 * finnes, ellers brukes standarden.
 */
export function targetPctForItem(args: {
  targetPrice: number | null | undefined;
  baselinePrice: number | null | undefined;
  fallbackPct?: number;
}): number {
  const target = Number(args.targetPrice);
  const baseline = Number(args.baselinePrice);
  if (Number.isFinite(target) && Number.isFinite(baseline) && baseline > 0 && target > 0 && target < baseline) {
    return ((baseline - target) / baseline) * 100;
  }
  return args.fallbackPct ?? DEFAULT_TARGET_PCT;
}
