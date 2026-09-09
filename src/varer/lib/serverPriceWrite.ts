import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * PRISSKRIVING PÅ SERVER
 * ---------------------------------------------------------------------------
 * `set_price` / `set_prices` gjør hele jobben atomisk i databasen: sjekker
 * tilgang og selskap, lukker forrige periode, hindrer overlapp og skriver
 * revisjonsspor. Klienten skal derfor ALDRI skrive `price_list_items` direkte.
 */

export interface PriceRowInput {
  priceListId: string;
  productId: string;
  price: number;
  /** ISO yyyy-mm-dd. Utelatt = i dag (databasens dato). */
  validFrom?: string;
  note?: string | null;
  /** Vises i feilmelding og logg. */
  label?: string;
}

export interface SetPricesRowResult {
  index: number;
  ok: boolean;
  productId: string | null;
  priceListId: string | null;
  unchanged: boolean;
  oldPrice: number | null;
  price: number | null;
  error: string | null;
}

export interface SetPricesResult {
  ok: boolean;
  total: number;
  succeeded: number;
  unchanged: number;
  failed: number;
  rows: SetPricesRowResult[];
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Tolker svaret fra `set_prices` uten å anta at feltene finnes. */
export function parseSetPricesResult(raw: unknown): SetPricesResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rawRows = Array.isArray(o.results) ? o.results : [];
  const rows: SetPricesRowResult[] = rawRows.map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      index: typeof row.index === "number" ? row.index : i,
      ok: row.ok === true,
      productId: str(row.product_id),
      priceListId: str(row.price_list_id),
      unchanged: row.unchanged === true,
      oldPrice: num(row.old_price),
      price: num(row.price),
      error: str(row.error),
    };
  });
  return {
    ok: o.ok === true,
    total: num(o.total) ?? rows.length,
    succeeded: num(o.succeeded) ?? 0,
    unchanged: num(o.unchanged) ?? 0,
    failed: num(o.failed) ?? rows.filter((r) => !r.ok).length,
    rows,
  };
}

/** Bygger raddata til `set_prices`. Ugyldige priser sendes ikke til serveren. */
export function toSetPricesPayload(rows: PriceRowInput[]): Record<string, Json>[] {
  return rows.map((r) => {
    if (!Number.isFinite(r.price) || r.price < 0) {
      throw new Error(`Ugyldig pris for ${r.label ?? "varen"}`);
    }
    const row: Record<string, Json> = {
      price_list_id: r.priceListId,
      product_id: r.productId,
      price: r.price,
    };
    if (r.validFrom) row.valid_from = r.validFrom;
    if (r.note) row.note = r.note;
    return row;
  });
}

/** Skriver én pris. Kaster med databasens norske melding ved feil. */
export async function setPrice(row: PriceRowInput): Promise<void> {
  if (!Number.isFinite(row.price) || row.price < 0) throw new Error("Ugyldig pris");
  const { error } = await supabase.rpc("set_price", {
    p_price_list_id: row.priceListId,
    p_product_id: row.productId,
    p_price: row.price,
    ...(row.validFrom ? { p_valid_from: row.validFrom } : {}),
    ...(row.note ? { p_note: row.note } : {}),
  });
  if (error) throw new Error(error.message);
}

/**
 * Skriver mange priser i ett kall. Standard er delvis lagring: rader som feiler
 * rapporteres tilbake, resten blir lagret.
 */
export async function setPrices(
  rows: PriceRowInput[],
  opts: { allOrNothing?: boolean } = {},
): Promise<SetPricesResult> {
  if (rows.length === 0) {
    return { ok: true, total: 0, succeeded: 0, unchanged: 0, failed: 0, rows: [] };
  }
  const { data, error } = await supabase.rpc("set_prices", {
    p_rows: toSetPricesPayload(rows) as unknown as Json,
    p_all_or_nothing: opts.allOrNothing ?? false,
  });
  if (error) throw new Error(error.message);
  return parseSetPricesResult(data);
}

/** Kort oppsummering til brukeren, på norsk. */
export function summarizeSetPrices(res: SetPricesResult, labelFor?: (productId: string | null) => string): string {
  const parts: string[] = [];
  if (res.succeeded > 0) parts.push(`${res.succeeded} pris${res.succeeded === 1 ? "" : "er"} lagret`);
  if (res.unchanged > 0) parts.push(`${res.unchanged} uendret`);
  if (res.failed > 0) {
    const first = res.rows.find((r) => !r.ok);
    const who = first && labelFor ? labelFor(first.productId) : null;
    parts.push(
      `${res.failed} feilet${first?.error ? ` (${who ? `${who}: ` : ""}${first.error})` : ""}`,
    );
  }
  return parts.length > 0 ? parts.join(", ") : "Ingen endringer";
}
