/** Norsk tallformat med fast antall desimaler (komma, mellomrom som tusenskille). */
export function formatNorwegianNumber(n: number, decimals: number): string {
  return new Intl.NumberFormat("nb-NO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}
