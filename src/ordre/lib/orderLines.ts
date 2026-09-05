/**
 * Felles regnestykker og regler for ordrelinjer (Ny ordre + kundeordre-panelet).
 *
 * Samlet her slik at avrunding, re-prisregler og 0-pris-blokkering oppfører seg
 * likt uansett hvilken flate operatøren registrerer i.
 */

/** Avrunder til 2 desimaler med vanlig «halve opp»-regel (unngår 1.005 → 1.00). */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = Math.round((value + Number.EPSILON) * 100);
  return scaled / 100;
}

export type LineTotalsInput = {
  quantity: string | number;
  unit_price: string | number;
  discount_percent?: string | number;
  vat_rate?: string | number;
};

export type LineTotals = {
  subtotal: number;
  vat: number;
  total: number;
  discount: number;
};

function num(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Linjesummer eks. mva, mva og inkl. mva — alle avrundet til øre. */
export function calcLineTotals(line: LineTotalsInput): LineTotals {
  const qty = num(line.quantity);
  const price = num(line.unit_price);
  const disc = num(line.discount_percent);
  const vatRate = num(line.vat_rate);
  const gross = qty * price;
  const subtotal = round2(gross * (1 - disc / 100));
  const vat = round2(subtotal * (vatRate / 100));
  return {
    subtotal,
    vat,
    total: round2(subtotal + vat),
    discount: round2(gross * (disc / 100)),
  };
}

/** Manuelt overstyrte priser er forhandlet av et menneske og skal aldri re-prises. */
export const MANUAL_PRICE_SOURCE = "manual_override";

export function isManualOverride(source: string | null | undefined): boolean {
  return source === MANUAL_PRICE_SOURCE;
}

/** Ved kopiering fra tidligere ordre: kun linjer uten manuell overstyring re-prises. */
export function shouldRepriceCopiedLine(line: { unit_price_source: string | null }): boolean {
  return !isManualOverride(line.unit_price_source);
}

export type PriceRiskLine = {
  hasProduct: boolean;
  unit_price: string | number;
  is_fallback?: boolean;
};

/** Linjer uten reell pris: 0 kr eller fallback-pris fra prismotoren. */
export function isPriceRisky(line: PriceRiskLine): boolean {
  if (!line.hasProduct) return false;
  return num(line.unit_price) <= 0 || line.is_fallback === true;
}

/** Antall linjer som må bekreftes før ordren kan lagres. */
export function countRiskyPriceLines(lines: PriceRiskLine[]): number {
  return lines.filter(isPriceRisky).length;
}

/** Prefiks som brukes når en manuell prisoverstyring begrunnes i linjens notat. */
export const PRICE_OVERRIDE_NOTE_PREFIX = "Pris overstyrt:";

/** Legger begrunnelsen inn i linjens notat uten å miste eksisterende tekst. */
export function withPriceOverrideNote(notes: string, reason: string): string {
  const cleanReason = reason.trim();
  const rest = notes
    .split("\n")
    .filter((l) => !l.trim().startsWith(PRICE_OVERRIDE_NOTE_PREFIX))
    .join("\n")
    .trim();
  const overrideLine = `${PRICE_OVERRIDE_NOTE_PREFIX} ${cleanReason}`;
  return rest ? `${overrideLine}\n${rest}` : overrideLine;
}

/** Flytter fokus til et felt i ordrelinjene (brukes av tastaturflyten). */
export function focusOrderLineField(uid: string, field: "qty" | "search"): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>(`[data-order-line-${field}="${uid}"]`);
    if (!el) return;
    el.focus();
    el.select?.();
  });
}
