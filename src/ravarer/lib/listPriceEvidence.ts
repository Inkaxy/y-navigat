/**
 * Prisgrunnlag for varelisten: «siste faktura mot gjeldende kostpris», bevist av serveren
 * (`rm_list_price_evidence`). Avvik vises/filtreres/sorteres/eksporteres bare når serveren har
 * godkjent begge operander for nøyaktig denne råvareversjonen. Alt annet er ukjent — aldri 0.
 */
import { isObj, type Obj } from "@/fakturaer/lib/parseRpcJson";
import { reasonGate, versionKey } from "@/fakturaer/lib/priceSafety";

export const LIST_EVIDENCE_KEY = "raw-material-list-price-evidence";
export const LIST_EVIDENCE_BATCH = 100;
export const LIST_EVIDENCE_CONCURRENCY = 2;
/** Lokal frist fra mottak; eldre kontroll sertifiserer ingenting. */
export const LIST_EVIDENCE_MAX_AGE_MS = 10 * 60_000;
export const LIST_EVIDENCE_REFETCH_MS = 9 * 60_000;

export type EvidenceStatus = "eligible" | "unknown";

export interface ListPriceEvidence {
  rawMaterialId: string;
  materialUpdatedAt: string;
  status: EvidenceStatus;
  reason: string | null;
  costReason: string | null;
  invoiceReason: string | null;
  costEvidence: EvidenceStatus;
  invoiceEvidence: EvidenceStatus;
  currentPrice: number | null;
  baseUnit: string | null;
  costBasisStatus: string | null;
  costEffectiveDate: string | null;
  invoiceId: string | null;
  invoiceLineId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoicePricePerBaseUnit: number | null;
  deviationPct: number | null;
}

export interface ListEvidenceEnvelope { checkedAt: string; rows: ListPriceEvidence[] }

const UNITS = new Set(["kg", "g", "l", "ml", "stk"]);
const sOrNull = (o: Obj, k: string): string | null | undefined => {
  const v = o[k];
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
};
/** Bare ekte JSON-tall; strenger/NaN er ugyldige. */
const nOrNull = (o: Obj, k: string): number | null | undefined => {
  const v = o[k];
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};
const status = (v: unknown): EvidenceStatus | undefined => (v === "eligible" || v === "unknown" ? v : undefined);

function parseRow(o: Obj): ListPriceEvidence | null {
  const id = o.raw_material_id;
  const ver = o.material_updated_at;
  const st = status(o.status);
  const ce = status(o.cost_evidence_status);
  const ie = status(o.invoice_evidence_status);
  if (typeof id !== "string" || typeof ver !== "string" || versionKey(ver) == null || !st || !ce || !ie) return null;
  const f = {
    reason: sOrNull(o, "reason"), costReason: sOrNull(o, "cost_reason"), invoiceReason: sOrNull(o, "invoice_reason"),
    baseUnit: sOrNull(o, "base_unit"), costBasisStatus: sOrNull(o, "cost_basis_status"), costEffectiveDate: sOrNull(o, "cost_effective_date"),
    invoiceId: sOrNull(o, "invoice_id"), invoiceLineId: sOrNull(o, "invoice_line_id"), invoiceNumber: sOrNull(o, "invoice_number"),
    invoiceDate: sOrNull(o, "invoice_date"), currency: sOrNull(o, "currency"),
  };
  const nums = { currentPrice: nOrNull(o, "current_price"), invoicePpbu: nOrNull(o, "invoice_price_per_base_unit"), deviation: nOrNull(o, "deviation_pct") };
  if (Object.values(f).some((v) => v === undefined) || Object.values(nums).some((v) => v === undefined)) return null;
  const row: ListPriceEvidence = {
    rawMaterialId: id, materialUpdatedAt: ver, status: st, reason: f.reason ?? null, costReason: f.costReason ?? null,
    invoiceReason: f.invoiceReason ?? null, costEvidence: ce, invoiceEvidence: ie, currentPrice: nums.currentPrice ?? null,
    baseUnit: f.baseUnit ?? null, costBasisStatus: f.costBasisStatus ?? null, costEffectiveDate: f.costEffectiveDate ?? null,
    invoiceId: f.invoiceId ?? null, invoiceLineId: f.invoiceLineId ?? null, invoiceNumber: f.invoiceNumber ?? null,
    invoiceDate: f.invoiceDate ?? null, invoicePricePerBaseUnit: nums.invoicePpbu ?? null, deviationPct: nums.deviation ?? null,
  };
  if (st === "eligible") {
    // Godkjent krever begge bevis, ingen grunn, NOK, støttet enhet og positive operander.
    if (ce !== "eligible" || ie !== "eligible" || row.reason !== null || row.costReason !== null || row.invoiceReason !== null) return null;
    if (f.currency !== "NOK" || !row.baseUnit || !UNITS.has(row.baseUnit) || row.costBasisStatus !== "verifisert") return null;
    if (row.currentPrice == null || !(row.currentPrice > 0) || row.invoicePricePerBaseUnit == null || !(row.invoicePricePerBaseUnit > 0)) return null;
    if (row.deviationPct == null || !row.invoiceId || !row.invoiceLineId) return null;
  } else {
    if (row.deviationPct !== null || !row.reason) return null;
    if (row.invoiceEvidence === "unknown" && row.invoicePricePerBaseUnit !== null) return null;
  }
  return row;
}

/**
 * Streng lesing av én batch. Konvolutten må gjelde nøyaktig selskap og forespurte ID-er,
 * med én rad per ID. Alt annet → null (hele batchen er ukjent; ingen delvise nuller).
 */
export function parseListEvidence(data: unknown, legalEntityId: string, requested: readonly string[]): ListEvidenceEnvelope | null {
  if (!isObj(data)) return null;
  if (data.schema_version !== 1 || data.legal_entity_id !== legalEntityId) return null;
  if (typeof data.checked_at !== "string" || versionKey(data.checked_at) == null) return null;
  if (data.requested_count !== requested.length || !Array.isArray(data.rows) || data.rows.length !== requested.length) return null;
  const want = new Set(requested);
  const seen = new Set<string>();
  const rows: ListPriceEvidence[] = [];
  for (const x of data.rows) {
    const r = isObj(x) ? parseRow(x) : null;
    if (!r || !want.has(r.rawMaterialId) || seen.has(r.rawMaterialId)) return null;
    seen.add(r.rawMaterialId);
    rows.push(r);
  }
  return { checkedAt: data.checked_at, rows };
}

export type EvidenceRpc = (ids: string[], signal: AbortSignal) => Promise<unknown>;

/**
 * Henter hele listen i batcher à maks 100, høyst to samtidig. Første feil avbryter resten.
 * Resultatet publiseres bare når alle batcher er komplette og gyldige.
 */
export async function fetchListEvidence(legalEntityId: string, ids: readonly string[], rpc: EvidenceRpc, outer?: AbortSignal): Promise<{ checkedAt: string; byId: Map<string, ListPriceEvidence> }> {
  const sorted = [...new Set(ids)].sort();
  const batches: string[][] = [];
  for (let i = 0; i < sorted.length; i += LIST_EVIDENCE_BATCH) batches.push(sorted.slice(i, i + LIST_EVIDENCE_BATCH));
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort);
  if (outer?.aborted) ctrl.abort();
  const byId = new Map<string, ListPriceEvidence>();
  let oldest: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      if (ctrl.signal.aborted) throw new Error("avbrutt");
      const b = batches[next++];
      const env = parseListEvidence(await rpc(b, ctrl.signal), legalEntityId, b);
      if (ctrl.signal.aborted) throw new Error("avbrutt");
      if (!env) throw new Error("ugyldig_prisgrunnlag");
      for (const r of env.rows) byId.set(r.rawMaterialId, r);
      if (oldest == null || Date.parse(env.checkedAt) < Date.parse(oldest)) oldest = env.checkedAt;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(LIST_EVIDENCE_CONCURRENCY, batches.length) }, () => worker()));
  } catch (e) {
    ctrl.abort();
    throw e;
  } finally {
    outer?.removeEventListener("abort", onAbort);
  }
  if (byId.size !== sorted.length) throw new Error("ufullstendig_prisgrunnlag");
  return { checkedAt: oldest ?? new Date().toISOString(), byId };
}

/** Hva listen viser for prissammenligningen. `pending` = ikke kontrollert (laster/feil/utløpt). */
export type ListComparison =
  | { state: "eligible"; deviation: number; invoicePpbu: number; invoiceDate: string | null; invoiceNumber: string | null; invoiceId: string; checkedAt: string }
  | { state: "unknown"; label: string; needsControl: boolean; invoiceId: string | null; invoiceDate: string | null; checkedAt: string }
  | { state: "pending"; label: string };

export const PENDING_LOADING: ListComparison = { state: "pending", label: "Kontrollerer prisgrunnlag …" };
export const PENDING_UNCHECKED: ListComparison = { state: "pending", label: "Prisgrunnlag ikke kontrollert" };

const LIST_REASONS: Record<string, string> = {
  no_invoice_observation: "Ingen fakturalinje å sammenligne med",
  invoice_access_missing: "Krever fakturatilgang",
  cost_unverified: "Kostprisen er ikke verifisert",
  cost_invalid: "Kostprisen mangler eller er ugyldig",
  cost_source_stale: "Kostprisens kilde må kontrolleres",
  cost_source_held: "Kostprisens kilde er til kontroll",
  invoice_unverified: "Siste fakturalinje må kontrolleres",
  identity_mismatch: "Siste fakturalinje må kontrolleres",
  unit_mismatch: "Enhet må avklares (pakning/grunnenhet)",
  currency_mismatch: "Valuta må avklares",
  invoice_capacity_limited: "For stor faktura til listekontroll — åpne fakturaen",
};
/** Grunner som ikke er et kontrollbehov (ingen kjøp / ingen tilgang). */
const NOT_CONTROL = new Set(["no_invoice_observation", "invoice_access_missing"]);

export function reasonLabel(code: string | null): string {
  if (!code) return "Prisgrunnlag må kontrolleres";
  return LIST_REASONS[code] ?? reasonGate(code).label;
}

/**
 * Binder serverbeviset til raden som faktisk vises: samme råvareversjon (full presisjon),
 * samme kostpris og grunnenhet. Uoverensstemmelse = ikke kontrollert til begge er oppdatert.
 */
export function comparisonFor(
  row: { id: string; updatedAt: string; costPrice: number | null; baseUnit: string },
  ev: ListPriceEvidence | undefined,
  checkedAt: string,
): ListComparison {
  if (!ev || ev.rawMaterialId !== row.id) return PENDING_UNCHECKED;
  const v = versionKey(row.updatedAt);
  if (v == null || v !== versionKey(ev.materialUpdatedAt)) return PENDING_UNCHECKED;
  if (ev.currentPrice !== row.costPrice) return PENDING_UNCHECKED;
  if (ev.status === "eligible") {
    if (ev.baseUnit !== row.baseUnit || ev.deviationPct == null || ev.invoicePricePerBaseUnit == null || !ev.invoiceId) return PENDING_UNCHECKED;
    return { state: "eligible", deviation: ev.deviationPct, invoicePpbu: ev.invoicePricePerBaseUnit, invoiceDate: ev.invoiceDate, invoiceNumber: ev.invoiceNumber, invoiceId: ev.invoiceId, checkedAt };
  }
  const code = ev.costReason ?? ev.invoiceReason ?? ev.reason;
  // Kostprisgrunn vises først. Ingen kjøp/ingen tilgang er ikke et kontrollbehov.
  const needsControl = !(code != null && NOT_CONTROL.has(code));
  return { state: "unknown", label: reasonLabel(code), needsControl, invoiceId: ev.invoiceId, invoiceDate: ev.invoiceDate, checkedAt };
}

export type CostStatus = "verifisert" | "uverifisert" | "mangler" | "ukjent";
export function costStatusOf(v: string | null | undefined): CostStatus {
  return v === "verifisert" || v === "uverifisert" || v === "mangler" ? v : "ukjent";
}
export const COST_STATUS_LABEL: Record<CostStatus, string> = {
  verifisert: "Verifisert",
  uverifisert: "Ikke verifisert",
  mangler: "Mangler grunnlag",
  ukjent: "Status ukjent",
};
