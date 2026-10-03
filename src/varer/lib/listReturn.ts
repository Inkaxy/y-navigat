/**
 * Returkontekst fra detaljsider tilbake til riktig liste.
 *
 * Detaljlenken bærer kun listens SPØRRESTRENG (`?fra=…`), aldri en sti. Stien
 * bestemmes av detaljsiden selv, så en manipulert lenke kan aldri sende brukeren
 * til en annen rute eller et eksternt nettsted.
 */
import { resolveInternalPath } from "@/lib/safeInternalPath";

export const LIST_PATHS = {
  recipes: "/varer/oppskrifter",
  products: "/varer/vareliste",
} as const;
export type ListKind = keyof typeof LIST_PATHS;

export const RETURN_PARAM = "fra";
const MAX_RETURN_LENGTH = 1000;

/** Normaliserer en spørrestreng; ugyldig gir tom streng. */
export function sanitizeListSearch(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN_LENGTH) return "";
  const body = raw.startsWith("?") ? raw.slice(1) : raw;
  // Bare et rent spørreuttrykk: ingen skråstrek-start, ingen fragment.
  if (body.startsWith("/") || body.includes("#") || /^[a-z][a-z0-9+.-]*:/i.test(body)) return "";
  const params = new URLSearchParams(body);
  // Returkonteksten skal ikke kjedes inn i seg selv.
  params.delete(RETURN_PARAM);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Lenke til detaljsiden som husker listevalget. */
export function detailHref(kind: ListKind, id: string, listSearch: string): string {
  const base = `${LIST_PATHS[kind]}/${encodeURIComponent(id)}`;
  const search = sanitizeListSearch(listSearch);
  return search ? `${base}?${RETURN_PARAM}=${encodeURIComponent(search)}` : base;
}

/** Tilbake-adresse for listen. Alt annet enn listen selv gir standardlisten. */
export function listReturnHref(kind: ListKind, rawReturn: string | null | undefined): string {
  const path = LIST_PATHS[kind];
  const candidate = `${path}${sanitizeListSearch(rawReturn)}`;
  const resolved = resolveInternalPath(candidate);
  if (!resolved) return path;
  const pathname = resolved.split(/[?#]/, 1)[0];
  return pathname === path ? resolved : path;
}

/** Navigasjonsstate som ber listen gi fokus tilbake til raden. */
export type ListReturnState = { focusId: string };

export function readFocusId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const v = (state as { focusId?: unknown }).focusId;
  return typeof v === "string" && v.length > 0 && v.length <= 100 ? v : null;
}
