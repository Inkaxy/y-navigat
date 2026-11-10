/**
 * Visningstekst for statusene `product_margins` returnerer per prisnivå.
 * Tekstene er de samme som i varens kalkylefane. Tonen styrer farge, men
 * status vises alltid også som tekst og ikon.
 */
export type MarginTone = "ok" | "warn" | "bad" | "neutral";

export interface MarginStatusMeta {
  label: string;
  tone: MarginTone;
}

const META: Record<string, MarginStatusMeta> = {
  gronn: { label: "God", tone: "ok" },
  gul: { label: "Under mål", tone: "warn" },
  rod: { label: "Svak", tone: "bad" },
  ingen_pris: { label: "Ingen pris", tone: "neutral" },
  forelopig: { label: "Foreløpig", tone: "neutral" },
  ikke_vurdert: { label: "Ikke vurdert", tone: "neutral" },
  halvfabrikat: { label: "Halvfabrikat", tone: "neutral" },
};

/** Ukjent status vises som «Ikke vurdert», aldri som god. */
export function marginStatusMeta(status: string | null | undefined): MarginStatusMeta {
  return (status && META[status]) || META.ikke_vurdert;
}
