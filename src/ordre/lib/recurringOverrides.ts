/**
 * Overstyringslogikk for fastordre-maler.
 *
 * Regel (avklart med bruker):
 *   Innenfor sin datoperiode overstyrer en mal HELT alle andre maler for
 *   samme kunde. Ingen prioritetsfelt — kun datoperioden avgjør.
 *   «Mest spesifikk» vinner: en mal med både start og slutt slår en mal med
 *   kun én av delene, som igjen slår en åpen mal (uten dato-grenser).
 *
 * Skjer per (customer_id, dato). Kaller filtrerer allerede på is_active og
 * på at malen dekker datoen (valid_from ≤ date ≤ valid_to), så her rangerer
 * vi bare gjenværende kandidater etter spesifisitet.
 */

export type SchedulePeriod = {
  id: string;
  customer_id: string;
  valid_from: string | null;
  valid_to: string | null;
};

export function scheduleCoversDate(
  s: Pick<SchedulePeriod, "valid_from" | "valid_to">,
  date: string,
): boolean {
  if (s.valid_from && date < s.valid_from) return false;
  if (s.valid_to && date > s.valid_to) return false;
  return true;
}

function specificity(s: Pick<SchedulePeriod, "valid_from" | "valid_to">): number {
  return (s.valid_from ? 1 : 0) + (s.valid_to ? 1 : 0);
}

/**
 * Fra en liste av maler som alle dekker gitt dato, returner kun de mest
 * spesifikke per kunde. Grunnmaler (åpne perioder) fjernes hvis kunden har
 * en mer spesifikk mal aktiv samme dag.
 */
export function pickEffectiveSchedulesForDate<T extends SchedulePeriod>(
  schedules: T[],
  date: string,
): T[] {
  const covering = schedules.filter((s) => scheduleCoversDate(s, date));
  const maxByCustomer = new Map<string, number>();
  for (const s of covering) {
    const cur = maxByCustomer.get(s.customer_id) ?? -1;
    const spec = specificity(s);
    if (spec > cur) maxByCustomer.set(s.customer_id, spec);
  }
  return covering.filter(
    (s) => specificity(s) === maxByCustomer.get(s.customer_id),
  );
}

/** True hvis malen er aktiv og gjeldende dato er innenfor perioden. */
export function isScheduleLiveNow(
  s: { is_active: boolean; valid_from: string | null; valid_to: string | null },
  today: string,
): boolean {
  return s.is_active && scheduleCoversDate(s, today);
}
