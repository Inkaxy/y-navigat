/**
 * Retningsbestemt tekst for sumavvik og norsk visning av maskintall i lesevarsler.
 * Retning avgjøres bare av endelige, sammenlignbare beløp (netto og lest linjesum med samme fortegn) —
 * aldri av et prosenttall uten fortegn eller AI-sikkerhet. Lagrede tall og varseltekster endres ikke.
 */
export type SumDirection = "for_hoy" | "for_lav" | "ukjent";

export function sumDirection(linesSum: number | null | undefined, net: number | null | undefined): SumDirection {
  if (linesSum == null || net == null || !Number.isFinite(linesSum) || !Number.isFinite(net)) return "ukjent";
  if (net === 0 || linesSum === 0 || Math.sign(linesSum) !== Math.sign(net)) return "ukjent";
  const d = Math.abs(linesSum) - Math.abs(net);
  if (Math.abs(d) < 0.005) return "ukjent";
  return d > 0 ? "for_hoy" : "for_lav";
}

export function sumDirectionText(dir: SumDirection, creditNote = false): string {
  const doc = creditNote ? "kreditnotaen" : "fakturaen";
  if (dir === "for_hoy") return `Linjene summerer seg til mer enn ${doc} eks. mva. En linje kan være lest feil eller telt dobbelt — kontroller mot originalen.`;
  if (dir === "for_lav") return `Linjene summerer seg til mindre enn ${doc} eks. mva. Det kan mangle linjer — kontroller mot originalen.`;
  return "Summen må kontrolleres mot originalen.";
}

const nb = (digits: number) => new Intl.NumberFormat("nb-NO", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Fortegnet prosent med norsk desimal: +1 230,6 %. */
export function formatSignedPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = nb(digits).format(Math.abs(v));
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s} %`;
}

/** Bare for visning: gjør maskintall som 1130000.00 eller 1230.6 i en varseltekst om til norsk format. */
export function formatMachineNumbersNb(text: string): string {
  return text.replace(/(?<![\d.,])(-?\d+)\.(\d+)(?![\d.,]*\d)/g, (_m, i: string, f: string) => {
    const n = Number(`${i}.${f}`);
    return Number.isFinite(n) ? nb(f.length).format(n).replace("-", "−") : _m;
  });
}
