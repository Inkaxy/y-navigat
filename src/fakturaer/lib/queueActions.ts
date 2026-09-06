import { supabase } from "@/integrations/supabase/client";
import { acceptMatch } from "@/fakturaer/lib/acceptMatch";
import { deriveLinePackage, resolveLineCost } from "@/fakturaer/lib/units";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { QueueLineSnapshot } from "@/fakturaer/lib/queueReducer";

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
 * Returnerer navnet på varen som ble koblet.
 */
export async function acceptTopSuggestion(line: ReviewLineRow, opts?: { skipRematch?: boolean }): Promise<string> {
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

  await acceptMatch({
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

  return top.raw_material?.name ?? "varen";
}

/**
 * Kjører matchemotoren ÉN gang per faktura for de oppgitte linjene.
 * Brukes etter masse-handlinger der hver linje ble lagret med `skipRematch`.
 */
export async function rematchLines(lines: Array<{ invoice_id: string; id: string }>): Promise<void> {
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
    if (error) console.warn(`rematchLines: reberegning feilet for faktura ${invoiceId}: ${error.message}`);
  }
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
