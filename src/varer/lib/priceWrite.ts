/**
 * PRISSKRIVING MED PERIODER
 * ---------------------------------------------------------------------------
 * `price_list_items` har en EXCLUDE-constraint som hindrer overlappende
 * perioder for samme (prisliste, vare). En ny pris må derfor ALLTID lukke
 * forrige periode (`valid_to` = dagen før) før den nye raden settes inn.
 *
 * Logikken ligger her — ikke i sidene — slik at matrisen, batch-justeringen og
 * prisliste-detaljen skriver helt likt, og slik at den kan testes uten nett.
 */

export interface PriceRowRef {
  id: string;
  price: number;
  valid_from: string;
  valid_to: string | null;
}

/** Persisteringslag — implementeres mot Supabase i produksjon, mockes i test. */
export interface PricePersistence {
  /** Raden som er aktiv på `date` (valid_from <= date og valid_to null/>= date). */
  findActive(priceListId: string, productId: string, date: string): Promise<PriceRowRef | null>;
  /** Endrer pris på en eksisterende rad som starter samme dag. */
  updatePrice(rowId: string, price: number): Promise<void>;
  /** Lukker en periode ved å sette valid_to. */
  closePeriod(rowId: string, validTo: string): Promise<void>;
  /** Setter inn ny periode og returnerer id-en. */
  insertPeriod(input: {
    priceListId: string;
    productId: string;
    price: number;
    validFrom: string;
  }): Promise<string>;
}

export interface PriceWriteResult {
  /** "update" = samme startdato, "insert" = ny periode (forrige ble lukket). */
  action: "update" | "insert";
  rowId: string;
  /** Id-en til perioden som ble lukket, hvis noen. */
  closedRowId: string | null;
  /** Prisen før endringen, når den fantes. */
  previousPrice: number | null;
}

/** Dagen før `date` (ISO yyyy-mm-dd), regnet i UTC for å unngå sommertidshopp. */
export function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Skriver `price` gyldig fra `date`:
 *  - finnes en aktiv rad som starter samme dag → oppdater prisen
 *  - finnes en eldre aktiv rad → lukk den på dagen før og sett inn ny rad
 *  - finnes ingen → sett inn ny rad
 */
export async function writePriceForDate(
  store: PricePersistence,
  args: { priceListId: string; productId: string; price: number; date: string },
): Promise<PriceWriteResult> {
  const { priceListId, productId, price, date } = args;
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Ugyldig pris");
  }
  const existing = await store.findActive(priceListId, productId, date);

  if (existing && existing.valid_from === date) {
    await store.updatePrice(existing.id, price);
    return {
      action: "update",
      rowId: existing.id,
      closedRowId: null,
      previousPrice: existing.price,
    };
  }

  let closedRowId: string | null = null;
  if (existing && existing.valid_from < date) {
    await store.closePeriod(existing.id, previousDay(date));
    closedRowId = existing.id;
  }

  const rowId = await store.insertPeriod({ priceListId, productId, price, validFrom: date });
  return {
    action: "insert",
    rowId,
    closedRowId,
    previousPrice: existing ? existing.price : null,
  };
}

export interface BatchPriceChange {
  priceListId: string;
  productId: string;
  price: number;
  /** Navn som vises i feilmelding/logg. */
  label: string;
}

export interface BatchPriceOutcome {
  ok: number;
  failed: { label: string; message: string }[];
  written: { label: string; rowId: string; price: number; previousPrice: number | null }[];
}

/**
 * Skriver mange priser med samme dato. Feil på én celle stopper ikke resten —
 * alle feil samles og rapporteres under ett.
 */
export async function writePriceBatch(
  store: PricePersistence,
  changes: BatchPriceChange[],
  date: string,
): Promise<BatchPriceOutcome> {
  const out: BatchPriceOutcome = { ok: 0, failed: [], written: [] };
  for (const ch of changes) {
    try {
      const res = await writePriceForDate(store, {
        priceListId: ch.priceListId,
        productId: ch.productId,
        price: ch.price,
        date,
      });
      out.ok++;
      out.written.push({
        label: ch.label,
        rowId: res.rowId,
        price: ch.price,
        previousPrice: res.previousPrice,
      });
    } catch (e) {
      out.failed.push({
        label: ch.label,
        message: e instanceof Error ? e.message : "Ukjent feil",
      });
    }
  }
  return out;
}

/**
 * Nødvendig pris for å nå et dekningsbidragsmål (DG2 i prosent av salgspris):
 *   pris = kost / (1 - mål/100)
 * Returnerer null når målet ikke gir en gyldig pris (>= 100 %).
 */
export function requiredPriceForTarget(
  cost: number | null | undefined,
  targetPct: number | null | undefined,
): number | null {
  if (cost == null || !Number.isFinite(cost) || cost < 0) return null;
  if (targetPct == null || !Number.isFinite(targetPct)) return null;
  if (targetPct >= 100) return null;
  const price = cost / (1 - targetPct / 100);
  if (!Number.isFinite(price)) return null;
  return Math.round(price * 100) / 100;
}

/** Dekningsgrad (DG2) i prosent av salgspris. */
export function marginPct(price: number | null | undefined, cost: number | null | undefined): number | null {
  if (price == null || cost == null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(cost) || price <= 0) return null;
  return Math.round(((price - cost) / price) * 1000) / 10;
}
