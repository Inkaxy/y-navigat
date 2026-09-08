import { toBaseFactor } from "@/fakturaer/lib/units";

/**
 * Norske etiketter for statusene i forhandlingsmodulen. Rå enum-verdier skal
 * aldri vises i grensesnittet.
 */
export const NEGOTIATION_STATUS_LABEL: Record<string, string> = {
  draft: "Utkast",
  invited: "Invitert",
  in_progress: "Pågår",
  awaiting_confirmation: "Venter på bekreftelse",
  concluded: "Avsluttet",
  cancelled: "Avbrutt",
};

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
  return NEGOTIATION_STATUS_LABEL[status] ?? status;
}

export function recipientStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return RECIPIENT_STATUS_LABEL[status] ?? status;
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
  /** Antall grunnenheter per pakning fra leverandørkoblingen, som reserve. */
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
  const price = Number(input.offeredPrice);
  if (!Number.isFinite(price)) return { value: null, reason: "Ingen pris" };

  const size = input.offeredPackageSize == null ? null : Number(input.offeredPackageSize);
  const hasSize = size != null && Number.isFinite(size) && size > 0;

  if (hasSize && input.offeredPackageUnit) {
    const factor = toBaseFactor(input.offeredPackageUnit, input.baseUnit);
    if (factor != null && factor > 0) {
      const baseUnits = size * factor;
      if (baseUnits > 0) return { value: price / baseUnits, reason: null };
    }
  }

  const linkUnits = input.linkBaseUnitsPerPackage == null ? null : Number(input.linkBaseUnitsPerPackage);
  if (hasSize && linkUnits != null && Number.isFinite(linkUnits) && linkUnits > 0) {
    return { value: price / linkUnits, reason: null };
  }

  // Ingen pakning oppgitt: prisen er allerede per grunnenhet (portalen spør om
  // «pris per <grunnenhet>»).
  if (!hasSize && !input.offeredPackageUnit) return { value: price, reason: null };

  if (linkUnits != null && Number.isFinite(linkUnits) && linkUnits > 0) {
    return { value: price / linkUnits, reason: null };
  }

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
