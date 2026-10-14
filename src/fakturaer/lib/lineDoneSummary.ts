import { normalizeUnit, toBaseFactor } from "@/fakturaer/lib/units";
import type { PriceGate } from "@/fakturaer/lib/financialPresentation";

/** Bekreftet leverandørpakning slik den vises på linjen. */
export interface ConfirmedPackage {
  size: number;
  unit: string;
  container: string | null;
  baseUnitsPerPackage: number;
  confirmedAt: string;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Bekreftet pakning bare når leverandørkoblingen faktisk er bekreftet (tidspunkt + positiv faktor + innhold)
 * OG linjens trykte innhold er det samme (100 g = 100 g). Ellers null: teksten forblir et forslag.
 */
export function confirmedPackageFor(
  link: { package_size: number | null; package_unit: string | null; base_units_per_package: number | null; package_confirmed_at: string | null; container_unit?: string | null } | null | undefined,
  line: { package_size?: number | null; package_unit?: string | null; unit?: string | null },
): ConfirmedPackage | null {
  if (!link || !link.package_confirmed_at) return null;
  const size = Number(link.package_size), bupp = Number(link.base_units_per_package);
  if (!(size > 0) || !(bupp > 0) || !Number.isFinite(size) || !Number.isFinite(bupp) || !link.package_unit) return null;
  if (!sameContent(line.package_size, line.package_unit, size, link.package_unit)) return null;
  // Fysisk beholder: bekreftet bare når koblingens lagrede beholder er linjens (pose ≠ sekk). Ukjent = ikke bekreftet.
  const linkC = containerKey(link.container_unit), lineC = containerKey(line.unit);
  if (!linkC || !lineC || linkC !== lineC) return null;
  return { size, unit: link.package_unit, container: link.container_unit ?? null, baseUnitsPerPackage: bupp, confirmedAt: link.package_confirmed_at };
}

const containerKey = (u: string | null | undefined): string | null => {
  const n = norm(u);
  return n ? normalizeUnit(n) ?? n : null;
};

/** Samme innhold: lik enhet og størrelse, eller samme mengde i felles grunnenhet (100 g = 0,1 kg). */
function sameContent(lineSize: number | null | undefined, lineUnit: string | null | undefined, size: number, unit: string): boolean {
  const ls = Number(lineSize);
  if (lineSize == null || !Number.isFinite(ls) || !lineUnit) return false;
  if (norm(lineUnit) === norm(unit)) return Math.abs(ls - size) <= 1e-9;
  const f = toBaseFactor(lineUnit, unit);
  return f != null && Math.abs(ls * f - size) <= 1e-9 * Math.max(1, size);
}

/**
 * Ferdig linje: skill «linjen er avklart» fra resten av fakturaen og fra prissammenligningen.
 * `otherOpen=null` = ukjent antall (aldri 0).
 */
export function doneSummary(otherOpen: number | null, gate: PriceGate): { line: string; invoice: string; price: string | null } {
  const invoice = otherOpen == null
    ? "Åpne fakturaen for å se om andre linjer gjenstår."
    : otherOpen === 0
      ? "Ingen andre åpne linjer på fakturaen i denne visningen."
      : `Fakturaen har ${otherOpen} ${otherOpen === 1 ? "annen åpen linje" : "andre åpne linjer"} som gjenstår.`;
  const price = gate.ok ? null : `Prissammenligning og kostpris: ${gate.label}. ${gate.detail}`;
  return { line: "Linjen er avklart (vare, pakning og mengde).", invoice, price };
}
