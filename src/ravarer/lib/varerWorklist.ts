/**
 * Varearbeidsflaten (fase 4A): én side `/ravarer/varer` med arbeidsliste i `liste`.
 * Ren URL-logikk — testes uten React.
 */
export const LISTER = ["alle", "pakning", "deklarasjon", "naering", "datablad", "prisavvik", "uten-leverandor", "ikke-kjopt", "inaktive"] as const;
export type Liste = (typeof LISTER)[number];

export const LISTE_LABEL: Record<Liste, string> = {
  alle: "Alle varer",
  pakning: "Pakning",
  deklarasjon: "Deklarasjonsnavn",
  naering: "Næring",
  datablad: "Datablad-endringer",
  prisavvik: "Prisavvik",
  "uten-leverandor": "Uten leverandør",
  "ikke-kjopt": "Ikke kjøpt 12 mnd",
  inaktive: "Inaktive",
};

/** Lister som vises med varelisten; verdien er varelistens innebygde visning (`rawMaterialViews`). */
export const LISTE_TO_VIEW: Partial<Record<Liste, string>> = {
  alle: "all",
  prisavvik: "deviation",
  "uten-leverandor": "no_supplier",
  "ikke-kjopt": "not_purchased",
  inaktive: "inactive",
};

/** Varelistens hurtigvisninger som har egen arbeidsliste. */
export const VIEW_TO_LISTE: Record<string, Liste> = {
  missing_package: "pakning",
  missing_declaration: "deklarasjon",
  missing_nutrition: "naering",
  deviation: "prisavvik",
  no_supplier: "uten-leverandor",
  not_purchased: "ikke-kjopt",
  inactive: "inaktive",
};

export function isVarelisteMode(l: Liste): boolean {
  return LISTE_TO_VIEW[l] !== undefined;
}

/** Leser arbeidsliste. Gammel `view` uten `liste` oversettes; ukjent → alle. */
export function readListe(sp: URLSearchParams): Liste {
  const raw = sp.get("liste");
  if (raw && (LISTER as readonly string[]).includes(raw)) return raw as Liste;
  const v = sp.get("view");
  if (!raw && v && VIEW_TO_LISTE[v]) return VIEW_TO_LISTE[v];
  return "alle";
}

/** Parametre hver modus eier. Søk (`q`) er felles og beholdes alltid. */
const MODE_PARAMS: Record<"vareliste" | Exclude<Liste, "alle" | "prisavvik" | "uten-leverandor" | "ikke-kjopt" | "inaktive">, readonly string[]> = {
  vareliste: ["kat", "type", "status", "sort", "view"],
  pakning: ["filter", "pstatus", "sort"],
  deklarasjon: [],
  naering: [],
  datablad: ["visning", "endring"],
};

const familyOf = (l: Liste) => (isVarelisteMode(l) ? "vareliste" : (l as keyof typeof MODE_PARAMS));

/**
 * Lenke til en arbeidsliste. Felles søk beholdes; filtre beholdes bare innen samme modusfamilie.
 * Valgt rad (`valgt`), hendelse (`endring`) og visning nullstilles eksplisitt ved bytte.
 */
export function listeHref(sp: URLSearchParams, target: Liste): string {
  const from = readListe(sp);
  const out = new URLSearchParams();
  const q = sp.get("q");
  if (q) out.set("q", q);
  if (target !== "alle") out.set("liste", target);
  if (familyOf(from) === familyOf(target)) {
    for (const k of MODE_PARAMS[familyOf(target)]) {
      if (k === "view" || k === "endring") continue;
      const v = sp.get(k);
      if (v) out.set(k, v);
    }
  }
  const s = out.toString();
  return `/ravarer/varer${s ? `?${s}` : ""}`;
}

/** Varelistens visning for en liste (vareliste-familien), ellers null. */
export function viewForListe(l: Liste): string | null {
  return LISTE_TO_VIEW[l] ?? null;
}

/** Gammel/mellomfase-sti → liste. */
export const LEGACY_VARER_PATH_LISTE: Record<string, Liste> = {
  "/ravarer/varer/pakninger": "pakning",
  "/ravarer/varer/deklarasjonsnavn": "deklarasjon",
  "/ravarer/varer/naering": "naering",
  "/ravarer/varer/datablad-endringer": "datablad",
};

/** Bevarer alle query-parametre, setter `liste`. */
export function legacyVarerUrl(pathname: string, search: string): string | null {
  const l = LEGACY_VARER_PATH_LISTE[pathname.replace(/\/+$/, "")];
  if (!l) return null;
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  sp.set("liste", l);
  return `/ravarer/varer?${sp.toString()}`;
}
