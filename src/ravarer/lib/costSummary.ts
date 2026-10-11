/**
 * Én tolkning av gjeldende kostpris for råvarekortets topptekst, KPI-stripa og peek-panelet.
 * Bare `cost_basis_status = 'verifisert'` er gyldig kostpris; alt annet vises som ukjent/uverifisert,
 * aldri som en fullstendig pris. Full presisjon er alltid tilgjengelig.
 */
import { formatDate, formatNok, priceSourceLabel } from "@/ravarer/lib/constants";
import type { CostEvidence } from "@/ravarer/lib/listPriceEvidence";

export const COST_STATUS_LABEL: Record<string, string> = { verifisert: "Verifisert", uverifisert: "Uverifisert", mangler: "Mangler gyldig kilde" };

export interface CostSummaryInput {
  current_cost_price: number | null;
  cost_basis_status?: string | null;
  price_source?: string | null;
  price_updated_at?: string | null;
  base_unit: string;
}

export interface CostSummary {
  verified: boolean;
  /** Kort verdi (avrundet) eller «Ukjent». */
  value: string;
  /** Full presisjon, eller null. */
  precise: string | null;
  status: string;
  /** «Faktura · 3. sep 2026», eller null. */
  source: string | null;
  unit: string;
}

export const fullPrecision = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/**
 * Med `evidence` (fra bundet, ferskt serverbevis) styrer den status og «verified»; lagret
 * «verifisert» uten bekreftelse blir aldri verifisert. Uten argument: bare lagret status (eldre kall).
 */
export function costSummary(rm: CostSummaryInput, evidence?: CostEvidence): CostSummary {
  const verified = evidence ? evidence.status === "verifisert" : rm.cost_basis_status === "verifisert";
  const has = rm.current_cost_price != null && Number.isFinite(rm.current_cost_price);
  return {
    verified,
    value: has ? formatNok(rm.current_cost_price) : "Ukjent",
    precise: has ? fullPrecision(rm.current_cost_price as number) : null,
    status: evidence?.reason ?? (evidence && evidence.status === "ukjent" ? "Prisstatus ukjent" : (COST_STATUS_LABEL[rm.cost_basis_status ?? ""] ?? "Prisstatus ukjent")),
    source: rm.price_updated_at ? `${priceSourceLabel(rm.price_source ?? null)} · ${formatDate(rm.price_updated_at)}` : rm.price_source ? priceSourceLabel(rm.price_source) : null,
    unit: rm.base_unit,
  };
}
