// Manuelt dokumentverifiserte fasiter for modellsammenligningen.
// Brukes BARE til scoring etter at modellen har svart — sendes aldri som hint til modellen.

export interface FasitLine { quantity: number; unit_price: number; total_amount: number }
export interface Fasit { invoice_number: string; verified_note: string; lines: FasitLine[]; net: number; vat: number; gross: number }

export const EVAL_FASIT: Record<string, Fasit> = {
  // PALS 526301: kilde-PDF viser mengde 10.000/11.340/396.000 (punktum-desimal) og beløp med komma.
  "dffd27f6-7f1b-4a3b-8c11-8f9cfa0ab95d": {
    invoice_number: "526301",
    verified_note: "Lokalt dokumentverifisert mot original-PDF (oppgitt av Henrik 14.10.2026).",
    lines: [
      { quantity: 10, unit_price: 110, total_amount: 1100 },
      { quantity: 10, unit_price: 113, total_amount: 1130 },
      { quantity: 11.34, unit_price: 86, total_amount: 975.24 },
      { quantity: 396, unit_price: 52, total_amount: 20592 },
      { quantity: 25, unit_price: 79.5, total_amount: 1987.5 },
    ],
    net: 25784.74, vat: 3867.71, gross: 29652.45,
  },
};

const eq = (a: unknown, b: number) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) < 0.005;

export interface FasitScore {
  verified: true;
  note: string;
  fields_total: number;
  fields_correct: number;
  line_count_expected: number;
  line_count_read: number;
  errors: string[];
}

/** Sammenligner lest resultat mot fasit, linje for linje i rekkefølge. Ingen fasit → null (= ikke verifisert). */
export function scoreAgainstFasit(invoiceId: string, read: { lines: readonly { quantity: number | null; unit_price: number | null; total_amount: number | null }[]; header: Record<string, unknown> | null }): FasitScore | null {
  const f = EVAL_FASIT[invoiceId];
  if (!f) return null;
  const errors: string[] = [];
  let total = 0, ok = 0;
  f.lines.forEach((fl, i) => {
    const l = read.lines[i];
    for (const k of ["quantity", "unit_price", "total_amount"] as const) {
      total++;
      if (l && eq(l[k], fl[k])) ok++;
      else errors.push(`Linje ${i + 1} ${k}: lest ${l ? String(l[k]) : "mangler"}, fasit ${fl[k]}`);
    }
  });
  const h = read.header ?? {};
  for (const [k, v] of [["total_excl_vat", f.net], ["total_vat", f.vat], ["total_amount", f.gross]] as const) {
    total++;
    if (eq(h[k], v)) ok++; else errors.push(`${k}: lest ${String(h[k] ?? "mangler")}, fasit ${v}`);
  }
  if (read.lines.length !== f.lines.length) errors.push(`Antall linjer: lest ${read.lines.length}, fasit ${f.lines.length}`);
  return { verified: true, note: f.verified_note, fields_total: total, fields_correct: ok, line_count_expected: f.lines.length, line_count_read: read.lines.length, errors };
}
