/**
 * Sentralt register over interne ruter per app-slug.
 *
 * Alle apper bor i samme React-app (NBhub) — vi navigerer ALDRI til
 * `apps.deploy_url` lenger. App-launchere/switchere/command-palette
 * bruker dette registeret for å rute internt.
 *
 * Apper uten oppføring her behandles som "kommer snart" og
 * vises disabled i UI-komponentene.
 */
export const APP_INTERNAL_ROUTES: Record<string, string> = {
  nbhub: "/",
  nbos: "/admin",
  varer: "/varer",
  kunder: "/kunder",
  ravarer: "/ravarer/vareliste",
  ordre: "/ordre",
  produksjon: "/produksjon",
  pos_styring: "/pos-styring",
};

export function getAppInternalRoute(slug: string): string | null {
  return APP_INTERNAL_ROUTES[slug] ?? null;
}

export function hasAppInternalRoute(slug: string): boolean {
  return slug in APP_INTERNAL_ROUTES;
}
