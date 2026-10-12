import type { WorkSummary } from "@/ravarer/lib/workRpc";
import { LISTE_LABEL, listeHref, type Liste } from "@/ravarer/lib/varerWorklist";
import type { SectionTab } from "@/ravarer/ui/SectionTabs";

export const RAVARER_EYEBROW = "Råvarer";

export type VarerTabId = Liste;

/** Arbeidslistene i varearbeidsflaten (`?liste=`). Søk følger med; uforenlige filtre nullstilles. */
export function varerTabs(s: WorkSummary | undefined, sp: URLSearchParams = new URLSearchParams()): SectionTab[] {
  const dq = s?.data_quality;
  const t = (id: Liste, count?: number | null, tone?: "warning"): SectionTab => ({ id, label: LISTE_LABEL[id], href: listeHref(sp, id), count, tone });
  return [
    t("alle"),
    t("pakning", dq ? dq.missing_package + dq.unconfirmed_package : null, "warning"),
    t("deklarasjon", dq?.missing_declaration, "warning"),
    t("naering", dq?.missing_nutrition, "warning"),
    t("datablad", dq?.datasheet_changes, "warning"),
    t("prisavvik"),
    t("uten-leverandor"),
    t("ikke-kjopt"),
    t("inaktive"),
  ];
}

export const PRISKONTROLL_TABS = ["gjore", "fakturaer", "godkjenning", "saker"] as const;
export type PriskontrollTabId = (typeof PRISKONTROLL_TABS)[number];

/** Parametre som tilhører en enkelt Priskontroll-fane og fjernes ved fanebytte. */
export const PRISKONTROLL_TAB_PARAMS = [
  "visning", "modus", "innboks", "faktura", "filter", "kilde", "kreditnota", "lav", "status", "leverandor", "q", "selskap", "fra", "til", "avvik", "betalt", "sort", "dir", "side", "sak",
];

/** Godkjenning: `rm_work_summary.approval.ready_to_approve` har samme regel som listens «Klare» (ikke kansellert, ikke godkjent, ingen blokkere). */
export function priskontrollTabs(s: WorkSummary | undefined): SectionTab[] {
  return [
    { id: "gjore", label: "Å gjøre", count: s?.todo_total },
    { id: "fakturaer", label: "Fakturaer", count: s?.invoices?.open_total },
    { id: "godkjenning", label: "Godkjenning", count: s?.approval?.ready_to_approve },
    { id: "saker", label: "Leverandørsaker", count: s?.other.cases_open },
  ];
}

export function leverandorTabs(s: WorkSummary | undefined, hasInvoiceAccess: boolean): SectionTab[] {
  return [
    { id: "leverandorer", label: "Leverandører" },
    { id: "avtaler", label: "Avtaler", count: s?.other.agreements_expiring_30d, tone: "warning" },
    { id: "forhandlinger", label: "Forhandlinger", hidden: !hasInvoiceAccess },
  ];
}

export function lagerTabs(s: WorkSummary | undefined): SectionTab[] {
  return [
    { id: "beholdning", label: "Beholdning", count: s?.other.stock_below_min, tone: "warning" },
    { id: "varemottak", label: "Varemottak" },
    { id: "telling", label: "Varetelling" },
    { id: "bevegelser", label: "Bevegelser" },
    { id: "fortjeneste", label: "Fortjeneste" },
    { id: "bestilling", label: "Bestilling" },
  ];
}

export const LAGER_TABS = ["beholdning", "varemottak", "telling", "bevegelser", "fortjeneste", "bestilling"] as const;
export type LagerTab = (typeof LAGER_TABS)[number];
/** Fanespesifikke adresseparametere som fjernes ved fanebytte. */
export const LAGER_TAB_PARAMS = ["valgt", "fra", "til", "leverandor", "filter", "q", "vt", "telling"];

