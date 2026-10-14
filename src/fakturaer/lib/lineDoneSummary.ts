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
  link: { package_size: number | null; package_unit: string | null; base_units_per_package: number | null; package_confirmed_at: string | null } | null | undefined,
  line: { package_size?: number | null; package_unit?: string | null; unit?: string | null },
): ConfirmedPackage | null {
  if (!link || !link.package_confirmed_at) return null;
  const size = Number(link.package_size), bupp = Number(link.base_units_per_package);
  if (!(size > 0) || !(bupp > 0) || !Number.isFinite(size) || !Number.isFinite(bupp) || !link.package_unit) return null;
  if (line.package_size == null || Math.abs(Number(line.package_size) - size) > 1e-9 || norm(line.package_unit) !== norm(link.package_unit)) return null;
  return { size, unit: link.package_unit, container: line.unit ?? null, baseUnitsPerPackage: bupp, confirmedAt: link.package_confirmed_at };
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
