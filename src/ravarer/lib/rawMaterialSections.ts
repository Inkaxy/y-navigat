/**
 * Råvarekortets seksjoner (fase 4B): URL-kontrakt, oversetting av gamle `tab`-verdier
 * og komplett-sjekklisten. Rene funksjoner — testes uten React.
 */
import { confirmedFactor } from "./supplierPackagePrice";

export const SECTIONS = ["sammendrag", "pris", "leverandorer", "naering", "deklarasjon", "bruk", "lager", "grunndata", "historikk"] as const;
export type SectionId = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<SectionId, string> = {
  sammendrag: "Sammendrag",
  pris: "Pris og innkjøp",
  leverandorer: "Leverandører og varekort",
  naering: "Næring og allergener",
  deklarasjon: "Deklarasjon og datablad",
  bruk: "Bruk",
  lager: "Lager",
  grunndata: "Grunndata",
  historikk: "Historikk",
};

/** Gamle faner → seksjon. `suppliers` dekket både pris og leverandører; standard er pris. */
export const LEGACY_TAB: Record<string, SectionId> = {
  overview: "sammendrag",
  suppliers: "pris",
  nutrition: "naering",
  recipes: "bruk",
  stock: "lager",
  history: "historikk",
};

/** Parametre som tilhører detaljen og aldri skal tolkes som listefilter. */
export const DETAIL_PARAMS = ["seksjon", "tab"] as const;

/** Seksjoner som ikke gjelder emballasje (ingen næringskrav). */
const NOT_FOR_PACKAGING: ReadonlySet<SectionId> = new Set(["naering", "deklarasjon"]);

export function sectionsFor(isPackaging: boolean): SectionId[] {
  return SECTIONS.filter((s) => !(isPackaging && NOT_FOR_PACKAGING.has(s)));
}

/**
 * Leser seksjon fra URL. Ukjent/ugyldig → sammendrag. `normalized` er satt når URL-en skal
 * skrives om (kjent legacy-`tab`, eller ugyldig seksjon) — øvrige parametre beholdes uendret.
 */
export function readSection(sp: URLSearchParams, isPackaging = false): { section: SectionId; normalized: URLSearchParams | null } {
  const allowed = sectionsFor(isPackaging);
  const raw = sp.get("seksjon");
  const tab = sp.get("tab");
  let section: SectionId = "sammendrag";
  let rewrite = false;
  if (raw && (allowed as string[]).includes(raw)) section = raw as SectionId;
  else if (raw) rewrite = true;
  else if (tab && LEGACY_TAB[tab]) { section = LEGACY_TAB[tab]; rewrite = true; }
  if (!(allowed as string[]).includes(section)) { section = "sammendrag"; rewrite = true; }
  if (tab && LEGACY_TAB[tab]) rewrite = true;
  if (!rewrite) return { section, normalized: null };
  const next = new URLSearchParams(sp);
  if (tab && LEGACY_TAB[tab]) next.delete("tab");
  if (section === "sammendrag") next.delete("seksjon");
  else next.set("seksjon", section);
  return { section, normalized: next };
}

/** Listekontekst for forrige/neste og «Tilbake»: alt unntatt detaljparametre. */
export function listContext(sp: URLSearchParams): string {
  const next = new URLSearchParams(sp);
  for (const k of DETAIL_PARAMS) next.delete(k);
  return next.toString();
}

/** URL-søk for en seksjon med bevart listekontekst. */
export function sectionSearch(sp: URLSearchParams, section: SectionId): string {
  const next = new URLSearchParams(listContext(sp));
  if (section !== "sammendrag") next.set("seksjon", section);
  const s = next.toString();
  return s ? `?${s}` : "";
}

export type CheckStatus = "ok" | "missing" | "partial";

export interface CheckItem {
  id: "pakning" | "leverandor" | "prisgrunnlag" | "kategori" | "deklarasjonsnavn" | "naering" | "allergener" | "datablad";
  label: string;
  status: CheckStatus;
  detail: string;
  section: SectionId;
}

export interface CheckInput {
  rm: {
    is_packaging: boolean;
    category: string | null;
    categories: string[] | null;
    declaration_name: string | null;
    cost_basis_status?: string | null;
    allergens_reviewed_at?: string | null;
    package_size: number | null;
    package_unit: string | null;
    base_units_per_package: number | null;
    package_confirmed_at: string | null;
    package_confirmed_by: string | null;
  };
  linkCount: number;
  nutrition: { verified_at?: string | null } | null;
  hasDatasheet: boolean;
}

/** Komplett-sjekklisten. Kalles bare når alle delspørringer er lastet uten feil. */
export function completenessChecklist(i: CheckInput): CheckItem[] {
  const { rm } = i;
  const cost = rm.cost_basis_status;
  const items: CheckItem[] = [
    confirmedFactor(rm) != null
      ? { id: "pakning", label: "Pakning", status: "ok", detail: "Bekreftet pakningsinnhold", section: "grunndata" }
      : { id: "pakning", label: "Pakning", status: rm.base_units_per_package != null ? "partial" : "missing", detail: rm.base_units_per_package != null ? "Pakningsinnhold ikke bekreftet" : "Pakningsinnhold mangler", section: "grunndata" },
    { id: "leverandor", label: "Leverandør", status: i.linkCount > 0 ? "ok" : "missing", detail: i.linkCount > 0 ? `${i.linkCount} koblet` : "Ingen leverandør koblet", section: "leverandorer" },
    { id: "prisgrunnlag", label: "Prisgrunnlag", status: cost === "verifisert" ? "ok" : cost === "uverifisert" ? "partial" : "missing",
      detail: cost === "verifisert" ? "Verifisert kostpris" : cost === "uverifisert" ? "Uverifisert — ingen gyldig kilde" : cost === "mangler" ? "Mangler gyldig kostpris" : "Prisstatus ukjent", section: "pris" },
    { id: "kategori", label: "Kategori", status: rm.category || (rm.categories?.length ?? 0) > 0 ? "ok" : "missing", detail: rm.category ?? rm.categories?.[0] ?? "Ingen kategori", section: "grunndata" },
  ];
  if (!rm.is_packaging) {
    items.push(
      { id: "deklarasjonsnavn", label: "Deklarasjonsnavn", status: rm.declaration_name ? "ok" : "missing", detail: rm.declaration_name ?? "Mangler", section: "deklarasjon" },
      i.nutrition == null
        ? { id: "naering", label: "Næring", status: "missing", detail: "Ingen næringsdata", section: "naering" }
        : { id: "naering", label: "Næring", status: i.nutrition.verified_at ? "ok" : "partial", detail: i.nutrition.verified_at ? "Verifisert" : "Finnes, ikke verifisert", section: "naering" },
      { id: "allergener", label: "Allergener", status: rm.allergens_reviewed_at ? "ok" : "missing", detail: rm.allergens_reviewed_at ? "Vurdert" : "Ikke vurdert", section: "naering" },
      { id: "datablad", label: "Datablad", status: i.hasDatasheet ? "ok" : "missing", detail: i.hasDatasheet ? "Gjeldende datablad" : "Mangler", section: "deklarasjon" },
    );
  }
  return items;
}
