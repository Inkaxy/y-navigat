/** Vektene i mod11-kontrollen for norske organisasjonsnumre. */
const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];

/** Fjerner mellomrom og punktum fra et organisasjonsnummer. */
export function cleanOrgNumber(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s.]/g, "");
}

/**
 * Kontrollerer et norsk organisasjonsnummer: ni siffer der siste siffer er en
 * mod11-kontrollsiffer. Tom verdi regnes som gyldig (feltet er valgfritt).
 */
export function isValidOrgNumber(value: string | null | undefined): boolean {
  const s = cleanOrgNumber(value);
  if (!s) return true;
  if (!/^\d{9}$/.test(s)) return false;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(s[i]), 0);
  const rest = sum % 11;
  const control = rest === 0 ? 0 : 11 - rest;
  if (control === 10) return false;
  return control === Number(s[8]);
}

/** Feilmelding på norsk, eller null når nummeret er i orden. */
export function orgNumberError(value: string | null | undefined): string | null {
  const s = cleanOrgNumber(value);
  if (!s) return null;
  if (!/^\d{9}$/.test(s)) return "Org.nr må være 9 siffer";
  return isValidOrgNumber(s) ? null : "Org.nr har feil kontrollsiffer";
}
