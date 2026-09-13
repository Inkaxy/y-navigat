/**
 * Hvilke registrerte allergenrader kan i det hele tatt underbygge et BEKREFTET funn?
 *
 * Bare rader der råvaren er gjennomgått OG presence = "contains". Alt annet —
 * ikke gjennomgåtte råvarer, «kan inneholde», spor, «fri for» — er kontekst.
 * Manglende gjennomgang er ingen konklusjon i noen retning.
 */

export interface RawMaterialRef {
  name: string;
  reviewed: boolean;
}

export interface AllergenRow {
  raw_material_id: string;
  allergen: string;
  presence: string;
}

export interface AllergenEvidence {
  /** Rader som kan underbygge et bekreftet funn. */
  verified: { code: string; evidence: string }[];
  /** Alle rader som tekst, til modellens kontekst. */
  context: string[];
  /** Allergener registrert med presence=contains, uavhengig av gjennomgang. */
  registeredContains: string[];
  /** Antall rader som IKKE kan gjøre et funn bekreftet. */
  unconfirmedCount: number;
}

export function buildAllergenEvidence(
  rows: AllergenRow[],
  materials: Map<string, RawMaterialRef>,
): AllergenEvidence {
  const result: AllergenEvidence = {
    verified: [],
    context: [],
    registeredContains: [],
    unconfirmedCount: 0,
  };

  for (const row of rows) {
    const rm = materials.get(row.raw_material_id);
    const reviewed = rm?.reviewed === true;
    const contains = row.presence === "contains";
    const status = reviewed ? "gjennomgått" : "IKKE gjennomgått";
    const weight =
      reviewed && contains ? "kan underbygge bekreftet funn" : "kan IKKE underbygge bekreftet funn";
    const line = `${rm?.name ?? "råvare"}: ${row.allergen} (${row.presence}, råvaredata ${status} — ${weight})`;
    result.context.push(line);
    if (reviewed && contains) {
      result.verified.push({ code: row.allergen, evidence: line });
    } else {
      result.unconfirmedCount += 1;
    }
    if (contains) result.registeredContains.push(row.allergen);
  }

  return result;
}
