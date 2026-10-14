// Manuelt dokumentverifiserte fasiter for modellsammenligningen.
// Brukes BARE til scoring etter at modellen har svart — sendes aldri som hint til modellen.

/** `sku` er dokumentverifisert varenummer slik det står trykt. null = ikke verifisert → linjen kan ikke scores. */
export interface FasitLine { sku: string | null; quantity: number; unit_price: number; total_amount: number }
export interface Fasit { invoice_number: string; verified_note: string; lines: FasitLine[]; net: number; vat: number; gross: number }

export const EVAL_FASIT: Record<string, Fasit> = {
  // PALS 526301: kilde-PDF viser mengde 10.000/11.340/396.000 (punktum-desimal) og beløp med komma.
  "dffd27f6-7f1b-4a3b-8c11-8f9cfa0ab95d": {
    invoice_number: "526301",
    verified_note: "Lokalt dokumentverifisert mot original-PDF (oppgitt av Henrik 14.10.2026).",
    // SKU-er er ikke lagt inn ennå: linjene står som uavklarte til dokumentverifiserte varenumre er oppgitt.
    lines: [
      { sku: null, quantity: 10, unit_price: 110, total_amount: 1100 },
      { sku: null, quantity: 10, unit_price: 113, total_amount: 1130 },
      { sku: null, quantity: 11.34, unit_price: 86, total_amount: 975.24 },
      { sku: null, quantity: 396, unit_price: 52, total_amount: 20592 },
      { sku: null, quantity: 25, unit_price: 79.5, total_amount: 1987.5 },
    ],
    net: 25784.74, vat: 3867.71, gross: 29652.45,
  },
};

const eq = (a: unknown, b: number) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) < 0.005;

/** Bare mellomrom normaliseres (trim + sammenslåtte mellomrom). «5301 0» ≠ «5301». */
export const normSku = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
};

export interface FasitScore {
  verified: true;
  note: string;
  fields_total: number;
  fields_correct: number;
  /** Felt som ikke kunne scores fordi fasitlinjen ikke kunne kobles entydig på SKU. */
  fields_unresolved: number;
  line_count_expected: number;
  line_count_read: number;
  sku_errors: string[];
  /** Leste rader som ikke ble koblet til noen fasitlinje. */
  unresolved_rows: Array<{ index: number; sku: string | null; description: string | null }>;
  errors: string[];
}

type ReadLine = { sku?: string | null; description?: string | null; quantity: number | null; unit_price: number | null; total_amount: number | null };

/**
 * Kobler fasit til leste linjer BARE på eksakt SKU (kun mellomrom normalisert) — aldri på rekkefølge eller pris.
 * Feil/manglende/tvetydig SKU er en identitetsfeil: SKU-feltet teller som feil og de tre tallfeltene som uavklarte.
 * Ingen fasit → null (= ikke verifisert).
 */
export function scoreAgainstFasit(invoiceId: string, read: { lines: readonly ReadLine[]; header: Record<string, unknown> | null }): FasitScore | null {
  const f = EVAL_FASIT[invoiceId];
  if (!f) return null;
  const errors: string[] = [], skuErrors: string[] = [];
  let total = 0, ok = 0, unresolved = 0;
  const used = new Set<number>();
  f.lines.forEach((fl, i) => {
    const want = normSku(fl.sku);
    if (want == null) { unresolved += 4; errors.push(`Fasitlinje ${i + 1}: SKU ikke verifisert – uavklart`); return; }
    total++;
    const hits = read.lines.map((l, j) => [l, j] as const).filter(([l]) => normSku(l.sku) === want);
    if (hits.length !== 1) {
      const msg = hits.length === 0 ? `SKU «${want}»: ikke funnet blant leste linjer` : `SKU «${want}»: ${hits.length} leste linjer – tvetydig`;
      skuErrors.push(msg); errors.push(msg); unresolved += 3; return;
    }
    const [l, j] = hits[0]; used.add(j); ok++;
    for (const k of ["quantity", "unit_price", "total_amount"] as const) {
      total++;
      if (eq(l[k], fl[k])) ok++;
      else errors.push(`SKU «${want}» ${k}: lest ${String(l[k])}, fasit ${fl[k]}`);
    }
  });
  const h = read.header ?? {};
  for (const [k, v] of [["total_excl_vat", f.net], ["total_vat", f.vat], ["total_amount", f.gross]] as const) {
    total++;
    if (eq(h[k], v)) ok++; else errors.push(`${k}: lest ${String(h[k] ?? "mangler")}, fasit ${v}`);
  }
  total++;
  if (read.lines.length === f.lines.length) ok++; else errors.push(`Antall linjer: lest ${read.lines.length}, fasit ${f.lines.length}`);
  const unresolvedRows = read.lines.flatMap((l, j) => used.has(j) ? [] : [{ index: j + 1, sku: normSku(l.sku), description: typeof l.description === "string" ? l.description : null }]);
  return { verified: true, note: f.verified_note, fields_total: total, fields_correct: ok, fields_unresolved: unresolved, line_count_expected: f.lines.length, line_count_read: read.lines.length, sku_errors: skuErrors, unresolved_rows: unresolvedRows, errors };
}
