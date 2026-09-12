import {
  PRODUCTION_SCOPE_STATUSES,
  isPausedForDate,
  isPendingOrder,
  type DeliveryPauseLike,
  type PendingOrderLike,
} from "@/ordre/lib/pendingOrders";

/** Hvor en planlinje kommer fra. */
export type PlanSource = "pakkseddel" | "bestilling" | "fastordre" | "ny_etter_kjoring";

export const PLAN_SOURCE_LABEL: Record<PlanSource, string> = {
  pakkseddel: "Pakkseddel",
  bestilling: "Bestilling",
  fastordre: "Fastordre",
  ny_etter_kjoring: "Ny etter kjøring",
};

export const PLAN_SOURCE_SHORT: Record<PlanSource, string> = {
  pakkseddel: "PS",
  bestilling: "B",
  fastordre: "F",
  ny_etter_kjoring: "NY",
};

export const PLAN_SOURCE_TOOLTIP: Record<PlanSource, string> = {
  pakkseddel: "Fra pakkseddel etter fullført hovedkjøring",
  bestilling: "Fra registrert bestilling",
  fastordre: "Fra fastordre (mal), ikke registrert som ordre ennå",
  ny_etter_kjoring: "Ordre lagt inn etter hovedkjøringen — mangler pakkseddel",
};

const SOURCE_ORDER: PlanSource[] = ["pakkseddel", "bestilling", "fastordre", "ny_etter_kjoring"];

export function sortSources(sources: Iterable<PlanSource>): PlanSource[] {
  const set = new Set(sources);
  return SOURCE_ORDER.filter((s) => set.has(s));
}

/**
 * Statuser som skal produseres for en gitt dato.
 * `delivered` tas kun med når datoen er passert — en ordre kan ikke være levert
 * for en dato som ikke har vært, og skal da ikke telles som produksjonsgrunnlag.
 */
export function productionStatusesForDate(date: string, today: string): string[] {
  const base: string[] = [...PRODUCTION_SCOPE_STATUSES];
  if (date < today) base.push("delivered");
  return base;
}

export type PausableLine = { customer_id: string; tour_id: string | null };

/** Fjerner linjer for kunder som er i leveransepause på datoen (respekterer tour_filter). */
export function excludePausedLines<T extends PausableLine>(
  lines: readonly T[],
  pauses: readonly DeliveryPauseLike[],
  date: string,
): T[] {
  return lines.filter((l) => !isPausedForDate(pauses, l.customer_id, date, l.tour_id));
}

export type RunLike = {
  id: string;
  completed_at: string | null;
  finished_at: string | null;
  tour_filter: string[] | null;
  notes_generated: number | null;
};

/**
 * Velger den fullførte hovedkjøringen som dekker det valgte turfilteret.
 * En kjøring uten tour_filter dekker alle turer. Ellers må kjøringen dekke
 * alle valgte tur-numre — hvis ikke er pakksedlene ikke fasit for utvalget.
 */
export function pickCompletedMainRun(
  runs: readonly RunLike[],
  selectedTourNumbers: readonly number[],
  tourNumberById: ReadonlyMap<string, number | null>,
): RunLike | null {
  for (const run of runs) {
    const filter = run.tour_filter;
    if (!filter || filter.length === 0) return run;
    if (selectedTourNumbers.length === 0) continue;
    const covered = new Set(
      filter.map((id) => tourNumberById.get(id) ?? null).filter((n): n is number => n !== null),
    );
    if (selectedTourNumbers.every((n) => covered.has(n))) return run;
  }
  return null;
}

export const MAIN_RUN_PAGE = 50;
/**
 * Sikkerhetsgrense for hvor mange kjøringer vi leter gjennom for samme dag.
 * Nås grensen uten at vi har nådd slutten, er svaret ukjent — da feiler vi
 * heller enn å påstå at hovedkjøringen ikke er kjørt.
 */
export const MAIN_RUN_MAX_SCAN = 2000;

export interface RunPageResult {
  data: RunLike[] | null;
  error: { message: string } | null;
}

/**
 * Leter gjennom dagens fullførte hovedkjøringer side for side til vi finner en
 * kjøring som dekker turfilteret, eller til listen faktisk er slutt.
 *
 * Uten paginering kunne ti nyere kjøringer med et annet turfilter skjule en
 * eldre, riktig kjøring — og planen ville feilaktig si «hovedkjøring ikke kjørt».
 */
export async function findCompletedMainRun(
  fetchPage: (from: number, to: number) => Promise<RunPageResult>,
  selectedTourNumbers: readonly number[],
  tourNumberById: ReadonlyMap<string, number | null>,
): Promise<RunLike | null> {
  let scanned = 0;
  while (scanned < MAIN_RUN_MAX_SCAN) {
    const { data, error } = await fetchPage(scanned, scanned + MAIN_RUN_PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    const hit = pickCompletedMainRun(page, selectedTourNumbers, tourNumberById);
    if (hit) return hit;
    scanned += page.length;
    if (page.length < MAIN_RUN_PAGE) return null;
  }
  throw new Error(
    `Fant ikke hovedkjøringen etter ${MAIN_RUN_MAX_SCAN} kjøringer. Grunnlaget er uavklart.`,
  );
}

/** Tidspunktet kjøringen ble fullført (RPC-en skriver `completed_at`). */
export function runCompletedAt(run: RunLike): string | null {
  return run.completed_at ?? run.finished_at;
}

/**
 * Ordre som er kommet etter hovedkjøringen: i produksjonsscope, ikke retur,
 * ikke pauset og uten pakkseddellinje.
 */
export function ordersNewAfterRun<T extends PendingOrderLike>(
  orders: readonly T[],
  packedOrderIds: ReadonlySet<string>,
  pauses: readonly DeliveryPauseLike[],
): T[] {
  return orders.filter((o) => isPendingOrder(o, packedOrderIds, pauses));
}
