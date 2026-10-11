import type { GateFor, SafetyLineRef } from "@/fakturaer/hooks/useInvoicePriceSafety";

/**
 * Arbeidsflatens prisport: kallerens EGEN radversjon og råvare sendes videre uendret.
 * Mangler de (eller gjelder raden en annen faktura), sendes `null` slik at prisen blir ukjent —
 * aldri lånt fra en annen cache.
 */
export function ownLineGate(gateFor: GateFor, invoiceId: string): GateFor {
  return (line: SafetyLineRef) => gateFor({
    id: line.id,
    invoice_id: line.invoice_id,
    updated_at: line.invoice_id === invoiceId ? line.updated_at ?? null : null,
    raw_material_id: line.invoice_id === invoiceId ? line.raw_material_id ?? null : null,
  });
}
