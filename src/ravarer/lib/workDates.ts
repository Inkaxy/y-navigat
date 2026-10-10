/** Trekker et antall døgn fra et tidspunkt (for «siste N dager»-oppslag). */
export function subtractDays(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}
