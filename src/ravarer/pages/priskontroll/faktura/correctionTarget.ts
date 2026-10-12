/**
 * Hvilken linje en rettehandling skal åpne. Én regel for primærknapp, meny og forhåndsvisning:
 * 1) eksplisitt valgt linje når den hører til DENNE fakturaen, 2) første linje med lesevarsel,
 * ellers ingen — aldri en tilfeldig første linje eller en linje fra en annen faktura/kø.
 */
export type CorrectionTarget = { id: string; reason: "valgt" | "lesevarsel" } | null;

export function correctionTarget<L extends { id: string }>(
  lines: readonly L[],
  selectedId: string | null | undefined,
  hasReadIssue: (l: L) => boolean,
): CorrectionTarget {
  if (selectedId && lines.some((l) => l.id === selectedId)) return { id: selectedId, reason: "valgt" };
  const flagged = lines.find(hasReadIssue);
  return flagged ? { id: flagged.id, reason: "lesevarsel" } : null;
}

/**
 * Lenke fra forhåndsvisning til fullflatens eksisterende, vaktede rettevei. Navigasjon skriver ingenting:
 * bare eksakt faktura, en linje på DENNE fakturaen med lesevarsel (valgfri; flaten validerer `?linje=` på nytt)
 * og gjeldende listekontekst som retur.
 */
export function correctionHref<L extends { id: string }>(
  fakturaHref: (id: string, q?: Record<string, string | undefined>) => string,
  invoiceId: string,
  lines: readonly L[],
  hasReadIssue: (l: L) => boolean,
  returnSearch: string,
  returnParam: string,
): string {
  const t = correctionTarget(lines, null, hasReadIssue);
  return fakturaHref(invoiceId, { linje: t?.id, [returnParam]: returnSearch || undefined });
}
