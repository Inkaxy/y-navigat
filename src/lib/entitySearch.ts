/**
 * Hjelpere for globalt entitetssøk i kommandopaletten.
 * Holdt utenfor komponenten slik at sanitering og gruppering kan testes.
 */

export const MIN_SEARCH_LENGTH = 2;
export const MAX_HITS_PER_GROUP = 5;

/**
 * Saniterer fritekst før den brukes i PostgREST `or(...ilike...)`.
 * Tegnene `,` `.` `(` `)` bryter filtersyntaksen, og `%`/`_` er jokertegn.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/[,.()%_*"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bygger et PostgREST `or`-uttrykk med ilike over flere kolonner. */
export function buildIlikeOr(columns: string[], term: string): string {
  const safe = sanitizeSearchTerm(term);
  return columns.map((c) => `${c}.ilike.%${safe}%`).join(",");
}

export type EntityKind = "customer" | "order" | "product" | "ticket";

export type EntityHit = {
  kind: EntityKind;
  id: string;
  title: string;
  subtitle?: string;
};

export const ENTITY_GROUP_LABEL: Record<EntityKind, string> = {
  customer: "Kunder",
  order: "Ordrer",
  product: "Varer",
  ticket: "Saker",
};

export const ENTITY_GROUP_ORDER: EntityKind[] = ["customer", "order", "product", "ticket"];

export function entityRoute(hit: EntityHit): string {
  switch (hit.kind) {
    case "customer":
      return `/kunder/kundeliste/${hit.id}`;
    case "order":
      return `/ordre/ordrer/${hit.id}`;
    case "product":
      return `/varer/vareliste/${hit.id}`;
    case "ticket":
      return `/ordre/ticket/${hit.id}`;
  }
}

/** Grupperer treff i fast rekkefølge og kutter hver gruppe til maks 5. */
export function groupEntityHits(
  hits: EntityHit[],
  limitPerGroup = MAX_HITS_PER_GROUP,
): { kind: EntityKind; label: string; hits: EntityHit[] }[] {
  return ENTITY_GROUP_ORDER.map((kind) => ({
    kind,
    label: ENTITY_GROUP_LABEL[kind],
    hits: hits.filter((h) => h.kind === kind).slice(0, limitPerGroup),
  })).filter((g) => g.hits.length > 0);
}
