import type { WorkSummary } from "@/ravarer/lib/workRpc";
import { paths } from "@/ravarer/lib/paths";
import type { SectionTab } from "@/ravarer/ui/SectionTabs";

export const RAVARER_EYEBROW = "Råvarer";

export type VarerTabId = "alle" | "pakninger" | "deklarasjonsnavn" | "naering" | "datablad";

/** Faneraden på Varer-sidene (lenker, aktiv etter sti). */
export function varerTabs(s: WorkSummary | undefined): SectionTab[] {
  const dq = s?.data_quality;
  return [
    { id: "alle", label: "Alle varer", href: paths.varer() },
    { id: "pakninger", label: "Pakninger", href: paths.pakninger(), count: dq ? dq.missing_package + dq.unconfirmed_package : null, tone: "warning" },
    { id: "deklarasjonsnavn", label: "Deklarasjonsnavn", href: paths.deklarasjonsnavn(), count: dq?.missing_declaration, tone: "warning" },
    { id: "naering", label: "Næring", href: paths.naering(), count: dq?.missing_nutrition, tone: "warning" },
    { id: "datablad", label: "Datablad-endringer", href: paths.databladEndringer(), count: dq?.datasheet_changes, tone: "warning" },
  ];
}

export const PRISKONTROLL_TABS = ["gjore", "fakturaer", "godkjenning", "saker"] as const;
export type PriskontrollTabId = (typeof PRISKONTROLL_TABS)[number];

/** Parametre som tilhører en enkelt Priskontroll-fane og fjernes ved fanebytte. */
export const PRISKONTROLL_TAB_PARAMS = [
  "visning", "innboks", "faktura", "filter", "status", "leverandor", "q", "selskap", "fra", "til", "avvik", "betalt", "sort", "dir", "side",
];

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
  ];
}
