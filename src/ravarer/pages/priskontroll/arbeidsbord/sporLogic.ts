/**
 * Statusoversikt for arbeidsbordet — ren logikk over serverens egne tellere.
 * Ingen tall regnes fra den lastede siden; ukjent teller er null og vises som «ukjent».
 * Enheten følger telleren: varekort (leverandørvarer) og fakturaer blandes aldri i én sum.
 */
import type { WorkGroup, WorkItemsCounts, WorkSummary } from "@/ravarer/lib/workRpcTypes";

export type CountUnit = "varekort" | "fakturaer";

export interface StatusEntry {
  label: string;
  count: number | null;
  unit: CountUnit;
  /** Gruppefilter i arbeidsbordet (serverens køkategori, ikke nødvendigvis første blokkering). */
  group?: WorkGroup;
  /** Ellers lenke til eksisterende liste. */
  href?: string;
}

export interface StatusTile {
  id: "avklaring" | "klar" | "behandlet";
  title: string;
  explain: string;
  entries: StatusEntry[];
}

const n = (v: number | undefined | null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sum = (...v: Array<number | null>): number | null => (v.some((x) => x == null) ? null : v.reduce<number>((a, b) => a + (b ?? 0), 0));

export function statusTiles(counts: WorkItemsCounts | undefined, summary: WorkSummary | null | undefined): StatusTile[] {
  const c = (k: keyof WorkItemsCounts) => n(counts?.[k]);
  const invoiceBlocked = sum(c("faktura_mangler_linjer"), c("faktura_sumavvik"), c("faktura_flagget"));
  return [
    {
      id: "avklaring",
      title: "Avklaringer",
      explain: "Må løses før prisen kan vurderes.",
      entries: [
        { label: "Mangler kobling", count: c("kobling"), unit: "varekort", group: "kobling" },
        { label: "Mangler pakning", count: c("pakning"), unit: "varekort", group: "pakning" },
        { label: "Kontroll", count: c("kontroll"), unit: "varekort", group: "kontroll" },
        { label: "Fakturaer med feil", count: invoiceBlocked, unit: "fakturaer", group: "fakturaer" },
      ],
    },
    {
      id: "klar",
      title: "Prisendringer å vurdere",
      explain: "Registrerte prisavvik. Åpne kortet for å se hva som må avklares før prisen kan vurderes.",
      entries: [
        { label: "Prisendringer å vurdere", count: c("pris"), unit: "varekort", group: "pris" },
        { label: "Klare til avstemming", count: c("faktura_klar"), unit: "fakturaer", href: "/ravarer/priskontroll?fane=fakturaer&visning=klar" },
      ],
    },
    {
      id: "behandlet",
      title: "Behandlet",
      explain: "Siste 7 dager.",
      entries: [
        { label: "Avstemt", count: n(summary?.invoices?.reconciled_7d), unit: "fakturaer", href: "/ravarer/priskontroll?fane=fakturaer&visning=avstemt" },
      ],
    },
  ];
}

export function countText(e: Pick<StatusEntry, "count" | "unit">): string {
  if (e.count == null) return "ukjent";
  const word = e.unit === "varekort" ? "varekort" : e.count === 1 ? "faktura" : "fakturaer";
  return `${e.count.toLocaleString("nb-NO")} ${word}`;
}

/** Delvisning på smal skjerm: beslutning eller original. */
export type DetailPart = "beslutning" | "original";
export const parseDel = (v: string | null): DetailPart => (v === "original" ? "original" : "beslutning");
