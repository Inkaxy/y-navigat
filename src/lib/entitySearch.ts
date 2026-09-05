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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tar imot en direkte referanse til en sak: en ren UUID, eller UUID-en med
 * «T-»/«#»-prefiks slik den vises i saksoverskrifter og lenker.
 */
export function parseTicketRef(raw: string): string | null {
  const t = raw.trim().replace(/^[#tT]-?/, "").trim();
  return UUID_RE.test(t) ? t.toLowerCase() : null;
}

/**
 * Kort saksreferanse: de første tegnene av UUID-en, slik den vises som «T-1a2b».
 * Brukes til prefikssøk på `tickets.id::text`.
 */
export function parseTicketPrefix(raw: string): string | null {
  const t = raw.trim().replace(/^[#tT]-?/, "").trim();
  if (UUID_RE.test(t)) return null;
  return /^[0-9a-f]{2,8}$/i.test(t) ? t.toLowerCase() : null;
}

/** Er søket bare siffer? Da er det trolig et ordre-, kunde- eller varenummer. */
export function isNumericTerm(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
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
