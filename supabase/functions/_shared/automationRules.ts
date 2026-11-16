// Automatikkregler i fakturamatchingen (variant B). Ren logikk, testes fra appens testsett.
// Begge reglene er bak databaseendringen 20261117_automatikk: uten kolonnen/tabellen er de av,
// og matchingen oppfører seg som før.

export interface KeyLimit { maxIncreasePct: number | null; minImpactNok: number | null }

/**
 * Egen prisgrense for en nøkkelråvare. Kan bare LEGGE TIL gjennomgang, aldri fjerne en annen årsak.
 * Over grensen når økningen er større enn maks-prosenten, og (hvis satt) kronevirkningen er minst minimum.
 */
export function keyLimitOver(limit: KeyLimit | undefined, variancePct: number, impactNok: number | null): boolean {
  if (!limit || limit.maxIncreasePct == null || !Number.isFinite(variancePct)) return false;
  if (variancePct <= limit.maxIncreasePct) return false;
  if (limit.minImpactNok != null) {
    if (impactNok == null || !Number.isFinite(impactNok)) return true; // ukjent virkning: heller se på den
    return Math.abs(impactNok) >= limit.minImpactNok;
  }
  return true;
}

export interface DepositLine { id: string; line_kind?: string | null; vat_rate?: number | string | null; raw_material_id?: string | null; line_number?: number | null }

/** Er pant-som-følgevare slått på? Kolonnen finnes bare etter SQL-en; null = på (standard). */
export function depositFollowEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return !!settings && Object.prototype.hasOwnProperty.call(settings, "deposit_as_follow_item") && settings.deposit_as_follow_item !== false;
}

/** Pantlinje som skal følge varen: pant, mva-fri og ikke koblet til en råvare. */
export function isDepositFollowLine(settings: Record<string, unknown> | null | undefined, line: DepositLine): boolean {
  if (!depositFollowEnabled(settings)) return false;
  if (line.line_kind !== "pant") return false;
  if (line.raw_material_id) return false;
  const vat = line.vat_rate == null ? 0 : Number(line.vat_rate);
  return Number.isFinite(vat) && vat === 0;
}

/** Nærmeste varelinje over pantlinjen på samme faktura; null = følger fakturaen som helhet. */
export function depositParent(all: readonly DepositLine[], line: DepositLine): string | null {
  if (line.line_number == null) return null;
  let best: DepositLine | null = null;
  for (const x of all) {
    if (x.id === line.id || x.line_number == null || x.line_number >= line.line_number) continue;
    if ((x.line_kind ?? "vare") !== "vare") continue;
    if (!best || (x.line_number > (best.line_number ?? -Infinity))) best = x;
  }
  return best?.id ?? null;
}

export const DEPOSIT_NOTE = "Pant – følgevare (utenfor kost, mva-fri)";
