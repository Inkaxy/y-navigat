/**
 * Rute → aktiv appkode.
 *
 * `AppShell` trenger å vite hvilken app brukeren står i, slik at
 * `AppColorProvider` setter riktig `--app-color` på `:root` (fokus-ringer,
 * primær-CTA, badges). Tidligere var dette hardkodet til `nbhub`.
 *
 * Kodene matcher `apps.code` i databasen. Oppslag skjer med **lengste
 * prefiks først**, slik at en mer spesifikk rute kan overstyre en generell.
 */

export const DEFAULT_APP_CODE = "nbhub";

export interface AppRoutePrefix {
  /** Pathname-prefiks uten etterfølgende skråstrek, f.eks. `/pos-styring`. */
  prefix: string;
  /** `apps.code` i databasen. */
  code: string;
}

/** Kilde-tabellen. Rekkefølgen her er likegyldig — oppslaget sorterer selv. */
export const APP_ROUTE_PREFIXES: AppRoutePrefix[] = [
  { prefix: "/admin", code: "nbos" },
  { prefix: "/varer", code: "varer" },
  { prefix: "/kunder", code: "kunder" },
  { prefix: "/ravarer", code: "ravarer" },
  { prefix: "/ordre", code: "ordre" },
  { prefix: "/produksjon", code: "produksjon" },
  { prefix: "/pos-styring", code: "pos_styring" },
  { prefix: "/fakturering", code: "faktura" },
  { prefix: "/rapporter", code: "rapporter" },
];

const normalizePath = (pathname: string): string => {
  const path = (pathname || "/").split(/[?#]/)[0];
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
};

const matches = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Utleder aktiv appkode fra en pathname. Faller tilbake til `nbhub` for
 * plattformsider (hjem, profil, varsler, hjelp) og ukjente ruter.
 */
export function resolveAppCodeFromPath(
  pathname: string,
  prefixes: AppRoutePrefix[] = APP_ROUTE_PREFIXES,
): string {
  const path = normalizePath(pathname);
  const sorted = [...prefixes].sort((a, b) => b.prefix.length - a.prefix.length);
  return sorted.find((entry) => matches(path, normalizePath(entry.prefix)))?.code ?? DEFAULT_APP_CODE;
}
