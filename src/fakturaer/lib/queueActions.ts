import { supabase } from "@/integrations/supabase/client";
import { acceptMatch } from "@/fakturaer/lib/acceptMatch";
import { deriveLinePackage, resolveLineCost } from "@/fakturaer/lib/units";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { QueueLineSnapshot } from "@/fakturaer/lib/queueReducer";
import { allReasons } from "@/fakturaer/lib/reviewReasons";

/** Tilstanden linjen hadde før handlingen — grunnlaget for «angre». */
export function snapshotOf(line: ReviewLineRow): QueueLineSnapshot {
  return {
    raw_material_id: line.raw_material_id,
    match_confidence: line.match_confidence,
    requires_review: line.requires_review,
    review_reason: line.review_reason,
  };
}

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Ikke innlogget");
  return user.id;
}

/**
 * Godtar det høyest rangerte forslaget på linjen — samme vei gjennom
 * acceptMatch som match-skuffen og masse-godkjenningen bruker.
 * Returnerer navnet på varen som ble koblet og leverandørkoblingen den fikk,
 * slik at den samme koblingen kan tilbys på flere linjer.
 */
export async function acceptTopSuggestion(
  line: ReviewLineRow,
  opts?: { skipRematch?: boolean },
): Promise<{
  name: string;
  rmsId: string | null;
  lineIds: string[];
  recalculationPending: boolean;
  recalculationError: string | null;
}> {
  const top = line.suggestions?.[0];
  if (!top) throw new Error("Linjen har ingen forslag å godta");
  const userId = await currentUserId();

  const pkg = deriveLinePackage({
    package_size: line.package_size,
    package_unit: line.package_unit,
    count_per_package: line.count_per_package,
    description: line.description,
  });
  const baseUnit = top.raw_material?.base_unit ?? null;
  const cost = baseUnit
    ? resolveLineCost({
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unit_price,
        totalAmount: line.total_amount,
        packageSize: line.package_size,
        packageUnit: line.package_unit,
        countPerPackage: line.count_per_package,
        description: line.description,
        baseUnit,
        knownPricePerBaseUnit: top.raw_material?.current_cost_price ?? null,
      })
    : null;
  if (cost?.needsInput) throw new Error(cost.reason ?? "Mangler pakningsstørrelse");

  const res = await acceptMatch({
    line,
    rawMaterialId: top.raw_material_id,
    userId,
    packageSize: pkg?.size ?? null,
    packageUnit: pkg?.unit ?? null,
    baseUnitsPerPackage: cost?.baseUnitsPerPackage ?? null,
    rememberSku: !!line.supplier_sku,
    rememberName: !!line.description && line.description !== line.supplier_sku,
    skipRematch: opts?.skipRematch ?? false,
  });

  return {
    name: top.raw_material?.name ?? "varen",
    rmsId: res.rmsId,
    lineIds: res.lineIds,
    recalculationPending: res.recalculationPending,
    recalculationError: res.recalculationError,
  };
}

/**
 * Kjører matchemotoren ÉN gang per faktura for de oppgitte linjene.
 * Brukes etter masse-handlinger der hver linje ble lagret med `skipRematch`.
 */
export async function rematchLines(
  lines: Array<{ invoice_id: string; id: string }>,
): Promise<Array<{ invoiceId: string; lineIds: string[]; message: string }>> {
  const failures: Array<{ invoiceId: string; lineIds: string[]; message: string }> = [];
  const byInvoice = new Map<string, string[]>();
  for (const l of lines) {
    const arr = byInvoice.get(l.invoice_id) ?? [];
    arr.push(l.id);
    byInvoice.set(l.invoice_id, arr);
  }
  for (const [invoiceId, lineIds] of byInvoice) {
    const { error } = await supabase.functions.invoke("match-invoice-lines", {
      body: { invoice_id: invoiceId, line_ids: lineIds },
    });
    if (error) failures.push({ invoiceId, lineIds, message: error.message });
  }
  // Kalleren må få vite hvilke linjer som fortsatt står til ny beregning.
  return failures;
}

/** Merker linjen som «ikke aktuell» (frakt, gebyr, pant og lignende). */
export async function markNotApplicable(line: ReviewLineRow, reason = "Ikke råvare"): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("invoice_lines")
    .update({
      match_confidence: "not_applicable",
      requires_review: false,
      review_reason: null,
      resolution_note: reason,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", line.id);
  if (error) throw new Error(`Kunne ikke merke linjen som ikke aktuell: ${error.message}`);
}

/** Setter linjen tilbake slik den var før forrige handling. */
export async function restoreLine(lineId: string, snapshot: QueueLineSnapshot): Promise<void> {
  const { error } = await supabase
    .from("invoice_lines")
    .update({
      raw_material_id: snapshot.raw_material_id,
      match_confidence: snapshot.match_confidence,
      requires_review: snapshot.requires_review,
      review_reason: snapshot.review_reason,
      resolution_note: null,
      resolved_by: null,
      resolved_at: null,
    })
    .eq("id", lineId);
  if (error) throw new Error(`Kunne ikke angre: ${error.message}`);
}

/** Fjerner flagget og sender fakturaen tilbake til gjennomgang. */
export async function unflagInvoice(invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from("invoices")
    .update({
      status: "needs_review",
      flagged_at: null,
      flagged_by: null,
      flag_reason: null,
      flag_action_type: null,
    })
    .eq("id", invoiceId);
  if (error) throw new Error(`Kunne ikke fjerne flagget: ${error.message}`);
}

/** Kjører auto-match på nytt for hele fakturaen. */
export async function runAutoMatch(invoiceId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("match-invoice-lines", {
    body: { invoice_id: invoiceId },
  });
  if (error) throw new Error(`Auto-match feilet: ${error.message}`);
}

/**
 * Kjører auto-match rett etter import. Feiler den, skal ikke selve importen
 * regnes som mislykket — brukeren kan kjøre den på nytt fra innboksen.
 */
export async function runAutoMatchAfterImport(invoiceId: string): Promise<boolean> {
  try {
    await runAutoMatch(invoiceId);
    return true;
  } catch (e) {
    console.warn(`Auto-match etter import feilet for faktura ${invoiceId}:`, e);
    return false;
  }
}

/** Årsaker en medarbeider kan godta direkte: rene prisavvik mot en kjent sammenligningspris. */
const ACCEPTABLE_PRICE_REASONS: ReadonlySet<string> = new Set(["price_variance", "price_increase", "price_drop"]);

/**
 * Kan prisavviket godtas på linjen? Bare når både fakturapris og sammenligningspris
 * er beregnet, og det ENESTE som gjenstår er selve avviket.
 */
export function canAcceptPriceVariance(line: ReviewLineRow): boolean {
  const pos = (v: number | null) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;
  if (!pos(line.price_per_base_unit) || !pos(line.expected_price_per_base_unit)) return false;
  if (!line.raw_material_id || !["manual", "auto_high"].includes(line.match_confidence ?? "")) return false;
  const reasons = allReasons(line);
  return reasons.length > 0 && reasons.every((r) => ACCEPTABLE_PRICE_REASONS.has(r));
}

const ACCEPT_ERRORS: Record<string, string> = {
  stale_line: "Linjen er endret siden du åpnet den. Last inn på nytt og kontroller prisen igjen.",
  not_only_price_variance: "Linjen har andre punkter som må avklares før prisen kan godtas.",
  price_basis_missing: "Prisen kan ikke godtas uten beregnet pris og sammenligningspris.",
  line_not_linked: "Linjen er ikke koblet til en råvare.",
  invoice_locked: "Fakturaen er flagget eller allerede fullført.",
  forbidden: "Du har ikke tilgang til å godta priser for dette selskapet.",
  line_not_found: "Fant ikke linjen. Den kan være slettet.",
  not_authenticated: "Du er ikke innlogget.",
};

/** Oversetter feilkoden fra serveren til en norsk forklaring — aldri rå backend-tekst. */
export function acceptPriceErrorMessage(message: string | undefined): string {
  const key = Object.keys(ACCEPT_ERRORS).find((k) => (message ?? "").includes(k));
  return key ? ACCEPT_ERRORS[key] : "Kunne ikke godta prisen. Prøv igjen.";
}

/** Grunnlaget brukeren så. Serveren avviser godkjenningen hvis noe av dette er endret. */
export function observedPriceBasis(line: ReviewLineRow): Record<string, string | number | null> {
  return {
    raw_material_id: line.raw_material_id,
    quantity: line.quantity,
    unit: line.unit,
    unit_price: line.unit_price,
    total_amount: line.total_amount,
    base_quantity: line.base_quantity,
    package_size: line.package_size,
    package_unit: line.package_unit,
    count_per_package: line.count_per_package,
    price_per_base_unit: line.price_per_base_unit,
    expected_price_per_base_unit: line.expected_price_per_base_unit,
    price_reference_source: line.price_reference_source,
    price_reference_id: line.price_reference_id,
    price_reference_date: line.price_reference_date,
  };
}

/**
 * Godtar prisavviket på ÉN linje via serveren. Serveren låser linjen, sjekker
 * tilgang, at tallene er de samme som brukeren så, og at prisavvik er det
 * eneste som gjenstår. Grunnlaget lagres slik at en ny matching med samme
 * grunnlag beholder godkjenningen, mens endret grunnlag åpner avviket igjen.
 */
export async function acceptPriceVariance(line: ReviewLineRow): Promise<void> {
  if (!canAcceptPriceVariance(line)) throw new Error("Prisavviket kan ikke godtas på denne linjen");
  const { error } = await supabase.rpc("accept_invoice_line_price_variance", {
    p_line_id: line.id,
    p_observed: observedPriceBasis(line),
  });
  if (error) throw new Error(acceptPriceErrorMessage(error.message));
}
