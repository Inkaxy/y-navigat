/**
 * Gjeldende kostpris fra serverens felles prisvelger (`rm_cost_price_source`,
 * `rm_set_documented_cost_price`, `rm_cost_price_deviations`). Rene parse-funksjoner.
 */
import type { Json } from "@/integrations/supabase/types";

type Obj = { [k: string]: Json | undefined };
const isObj = (v: Json | null | undefined): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (o: Obj, k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
const num = (o: Obj, k: string): number | null => {
  const v = o[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export type CostStatus = "ok" | "avviker" | "uverifisert" | "mangler";
const STATUSES: readonly CostStatus[] = ["ok", "avviker", "uverifisert", "mangler"];

export interface CostSourceRef {
  historyId: string;
  price: number;
  effectiveDate: string;
  source: string;
  supplierId: string | null;
  supplierName: string | null;
  invoiceId: string | null;
  invoiceLineId: string | null;
  invoiceNumber: string | null;
}

export interface CostPriceSource {
  status: CostStatus;
  currentPrice: number | null;
  baseUnit: string | null;
  source: CostSourceRef | null;
  next: { price: number; effectiveDate: string; source: string } | null;
}

export function parseCostPriceSource(data: Json | null | undefined): CostPriceSource {
  const o = isObj(data) ? data : {};
  const st = str(o, "status");
  const s = isObj(o.source) ? o.source : null;
  const n = isObj(o.next) ? o.next : null;
  const ref: CostSourceRef | null = s && str(s, "history_id") && num(s, "price") != null && str(s, "effective_date") ? {
    historyId: str(s, "history_id") as string, price: num(s, "price") as number, effectiveDate: str(s, "effective_date") as string,
    source: str(s, "source") ?? "invoice", supplierId: str(s, "supplier_id"), supplierName: str(s, "supplier_name"),
    invoiceId: str(s, "invoice_id"), invoiceLineId: str(s, "invoice_line_id"), invoiceNumber: str(s, "invoice_number"),
  } : null;
  return {
    status: STATUSES.find((x) => x === st) ?? (ref ? "ok" : "mangler"),
    currentPrice: num(o, "current_price"),
    baseUnit: str(o, "base_unit"),
    source: ref,
    next: n && num(n, "price") != null && str(n, "effective_date")
      ? { price: num(n, "price") as number, effectiveDate: str(n, "effective_date") as string, source: str(n, "source") ?? "manual" } : null,
  };
}

export const COST_STATUS_LABEL: Record<CostStatus, string> = {
  ok: "Gjeldende pris",
  avviker: "Avviker fra nyeste gyldige pris",
  uverifisert: "Uverifisert — ingen gyldig kilde",
  mangler: "Mangler kostpris",
};

/** Kalkyler med pris uten gyldig kilde (eller uten pris) er ufullstendige. */
export function isIncompleteCost(status: CostStatus): boolean {
  return status === "mangler" || status === "uverifisert";
}

export interface DocumentedPriceResult { historyId: string | null; currentPrice: number | null; future: boolean; isCurrent: boolean }

export function parseDocumentedPrice(data: Json | null | undefined): DocumentedPriceResult {
  const o = isObj(data) ? data : {};
  return { historyId: str(o, "history_id"), currentPrice: num(o, "current_price"), future: o.future === true, isCurrent: o.is_current === true };
}

export function documentedPriceMessage(r: DocumentedPriceResult): string {
  if (r.future) return "Pris registrert — blir gjeldende på datoen";
  if (r.isCurrent) return "Pris registrert og er nå gjeldende kostpris";
  return "Pris registrert i historikken — en nyere gyldig pris gjelder fortsatt";
}

/** Serverkoder → norsk tekst. Aldri rå databasefeil i UI. */
export function documentedPriceError(raw: string): string {
  if (raw.startsWith("ugyldig_pris")) return "Prisen må være større enn 0";
  if (raw.startsWith("ugyldig_dato")) return "Datoen må være satt og høyst ett år frem i tid";
  if (raw.startsWith("begrunnelse")) return "Skriv en begrunnelse (minst 3 tegn)";
  if (raw.startsWith("forbidden")) return "Du har ikke skrivetilgang til denne råvaren";
  if (raw.startsWith("not_authenticated")) return "Du må være innlogget";
  return "Prisen ble ikke lagret. Prøv igjen.";
}

export interface CostDeviation {
  rawMaterialId: string; name: string; baseUnit: string | null; currentPrice: number | null; status: "avviker" | "uverifisert";
  sourcePrice: number | null; sourceDate: string | null; supplierName: string | null; invoiceId: string | null; invoiceNumber: string | null;
}
