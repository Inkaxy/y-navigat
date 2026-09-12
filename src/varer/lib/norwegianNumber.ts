/**
 * Tall skrevet på norsk: «0,5» skal bety et halvt, ikke NaN.
 * Brukes der brukeren skriver inn en faktor eller mengde for hånd.
 */
export function parseNorwegianDecimal(input: string): number {
  const cleaned = input.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return NaN;
  // Bare ett tall, valgfritt fortegn og ett desimalskille.
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

/** Sann når teksten er et gyldig positivt tall. */
export function isPositiveNorwegianDecimal(input: string): boolean {
  const n = parseNorwegianDecimal(input);
  return Number.isFinite(n) && n > 0;
}
