import type { CostEvidence } from "@/ravarer/lib/listPriceEvidence";
/**
 * Råvarekortets seksjoner (fase 4B): URL-kontrakt, oversetting av gamle `tab`-verdier
 * og komplett-sjekklisten. Rene funksjoner — testes uten React.
 */
import { confirmedFactor } from "./supplierPackagePrice";
import { NUTRITION_FIELD_LABEL, nutritionState, type NutritionValues } from "./nutritionCompleteness";

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
// `valgt`/`endring` er listekontekst (aktiv rad i arbeidslisten) og beholdes bevisst ved retur.

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
  nutrition: (NutritionValues & { verified_at?: string | null; is_complete?: boolean | null }) | null;
  hasDatasheet: boolean;
  /** Gjeldende kostprisbeslutning fra bundet serverbevis (`costEvidenceFor`). Påkrevd: lagret status alene sertifiserer aldri. */
  costEvidence: CostEvidence;
}

/** Komplett-sjekklisten. Kalles bare når alle delspørringer er lastet uten feil. */
export function completenessChecklist(i: CheckInput): CheckItem[] {
  const { rm } = i;
  const ce = i.costEvidence;
  const items: CheckItem[] = [
    confirmedFactor(rm) != null
      ? { id: "pakning", label: "Pakning", status: "ok", detail: "Bekreftet pakningsinnhold", section: "grunndata" }
      : { id: "pakning", label: "Pakning", status: rm.base_units_per_package != null ? "partial" : "missing", detail: rm.base_units_per_package != null ? "Pakningsinnhold ikke bekreftet" : "Pakningsinnhold mangler", section: "grunndata" },
    { id: "leverandor", label: "Leverandør", status: i.linkCount > 0 ? "ok" : "missing", detail: i.linkCount > 0 ? `${i.linkCount} koblet` : "Ingen leverandør koblet", section: "leverandorer" },
    { id: "prisgrunnlag", label: "Prisgrunnlag", status: ce.status === "verifisert" ? "ok" : ce.status === "mangler" ? "missing" : "partial",
      detail: ce.status === "verifisert" ? "Verifisert kostpris" : ce.reason ?? (ce.status === "uverifisert" ? "Uverifisert — ingen gyldig kilde" : ce.status === "mangler" ? "Mangler gyldig kostpris" : "Prisstatus ukjent"), section: "pris" },
    { id: "kategori", label: "Kategori", status: rm.category || (rm.categories?.length ?? 0) > 0 ? "ok" : "missing", detail: rm.category ?? rm.categories?.[0] ?? "Ingen kategori", section: "grunndata" },
  ];
  if (!rm.is_packaging) {
    items.push(
      { id: "deklarasjonsnavn", label: "Deklarasjonsnavn", status: rm.declaration_name ? "ok" : "missing", detail: rm.declaration_name ?? "Mangler", section: "deklarasjon" },
      nutritionCheck(i.nutrition),
      { id: "allergener", label: "Allergener", status: rm.allergens_reviewed_at ? "ok" : "missing", detail: rm.allergens_reviewed_at ? "Vurdert" : "Ikke vurdert", section: "naering" },
      { id: "datablad", label: "Datablad", status: i.hasDatasheet ? "ok" : "missing", detail: i.hasDatasheet ? "Gjeldende datablad" : "Mangler", section: "deklarasjon" },
    );
  }
  return items;
}

/** Næring: finnes / fullstendig / verifisert er tre ulike ting. Verifisert tidspunkt gjør aldri ufullstendig data «ok». */
function nutritionCheck(n: CheckInput["nutrition"]): CheckItem {
  const st = nutritionState(n);
  const base = { id: "naering" as const, label: "Næring", section: "naering" as const };
  switch (st.kind) {
    case "mangler": return { ...base, status: "missing", detail: "Ingen næringsdata" };
    case "ufullstendig": {
      const names = st.missing.map((f) => NUTRITION_FIELD_LABEL[f]);
      const what = names.length > 0 ? `mangler ${names.join(", ")}` : "databasen markerer dataene som ufullstendige";
      return { ...base, status: "partial", detail: `Ufullstendig — ${what}${st.verified ? " (har verifiseringstidspunkt, men er ikke fullstendig)" : ""}` };
    }
    case "ikke_verifisert": return { ...base, status: "partial", detail: "Fullstendig, ikke verifisert" };
    case "verifisert": return { ...base, status: "ok", detail: "Fullstendig og verifisert" };
  }
}

/** Hovedarbeid på råvarekortet: tre faste grupper + «Mer». Seksjons-URL-ene er uendret. */
export const SECTION_GROUPS = ["oversikt", "pakning", "pris", "mer"] as const;
export type SectionGroup = (typeof SECTION_GROUPS)[number];
export const GROUP_LABEL: Record<SectionGroup, string> = { oversikt: "Oversikt", pakning: "Pakning og leverandør", pris: "Pris", mer: "Mer" };
const GROUP_SECTION: Record<Exclude<SectionGroup, "mer">, SectionId> = { oversikt: "sammendrag", pakning: "leverandorer", pris: "pris" };

export function groupOf(s: SectionId): SectionGroup {
  if (s === "sammendrag") return "oversikt";
  if (s === "leverandorer") return "pakning";
  if (s === "pris") return "pris";
  return "mer";
}

/** Seksjonen en gruppe åpner. «Mer» åpner første tilgjengelige underseksjon. */
export function groupSection(g: SectionGroup, isPackaging: boolean): SectionId {
  if (g !== "mer") return GROUP_SECTION[g];
  return moreSections(isPackaging)[0];
}

/** Underseksjonene under «Mer» (næring, deklarasjon, bruk, lager, grunndata, historikk). */
export function moreSections(isPackaging: boolean): SectionId[] {
  return sectionsFor(isPackaging).filter((s) => groupOf(s) === "mer");
}
