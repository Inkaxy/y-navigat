import type { CheckItem } from "./rawMaterialSections";

/** Handlingstekst per kontrollpunkt — forteller hva som rettes, ikke bare «pris». */
const ACTION: Record<CheckItem["id"], string> = {
  pakning: "Bekreft pakningsinnholdet",
  leverandor: "Koble en leverandør",
  prisgrunnlag: "Kontroller prisgrunnlaget",
  kategori: "Velg kategori",
  deklarasjonsnavn: "Legg inn deklarasjonsnavn",
  naering: "Fyll ut næringsinnhold",
  allergener: "Vurder allergener",
  datablad: "Last opp datablad",
};

/** Rekkefølge: pakning og leverandør først (prisen avhenger av dem), deretter pris, grunndata og deklarasjon. */
const PRIORITY: CheckItem["id"][] = ["pakning", "leverandor", "prisgrunnlag", "kategori", "deklarasjonsnavn", "allergener", "naering", "datablad"];

export type NextFix =
  | { kind: "fix"; item: CheckItem; label: string }
  | { kind: "unknown"; label: string }
  | { kind: "complete" };

/**
 * Det viktigste som mangler på en råvare. Ukjent prisstatus (lasting/feil) gir aldri «komplett»
 * og peker ikke stille på pris; den sier at status er ukjent.
 */
export function nextFix(items: readonly CheckItem[], priceUnknown: boolean): NextFix {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of PRIORITY) {
    const it = byId.get(id);
    if (!it || it.status === "ok") continue;
    if (id === "prisgrunnlag" && priceUnknown) return { kind: "unknown", label: "Prisstatus er ukjent akkurat nå" };
    return { kind: "fix", item: it, label: ACTION[id] };
  }
  if (priceUnknown) return { kind: "unknown", label: "Prisstatus er ukjent akkurat nå" };
  return { kind: "complete" };
}
