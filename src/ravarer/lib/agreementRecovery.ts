import type { AgreementPayload } from "@/ravarer/lib/rpcContracts";

/**
 * Uavklart avtalelagring (ukjent utfall fra `rm_apply_agreement`). Holdes utenfor skjemaet, så lukk/åpne
 * ikke nullstiller den. Ny lagring for samme mål krever avstemming mot lest kobling eller et eksplisitt valg.
 * `rm_apply_agreement` har ingen operasjonskvittering; avstemmingen sammenligner lagrede felt med det frosne innholdet.
 */
export interface PendingAgreement {
  entityId: string;
  payload: AgreementPayload;
  /** Sti til opplastet dokument når opplastingen lyktes før det ukjente utfallet. */
  documentPath: string | null;
  at: string;
}

const store = new Map<string, PendingAgreement>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const agreementKey = (entityId: string, rawMaterialId: string, supplierId: string) => `${entityId}|${rawMaterialId}|${supplierId}`;

export function rememberPendingAgreement(p: PendingAgreement) {
  store.set(agreementKey(p.entityId, p.payload.raw_material_id, p.payload.supplier_id), p);
  emit();
}
export function pendingAgreementFor(entityId: string, rawMaterialId: string, supplierId: string): PendingAgreement | null {
  if (!entityId || !rawMaterialId || !supplierId) return null;
  return store.get(agreementKey(entityId, rawMaterialId, supplierId)) ?? null;
}
export function clearPendingAgreement(p: PendingAgreement) {
  store.delete(agreementKey(p.entityId, p.payload.raw_material_id, p.payload.supplier_id));
  emit();
}
export function subscribePendingAgreements(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/** Kun for tester. */
export function resetPendingAgreementsForTest() { store.clear(); emit(); }

export interface StoredLink {
  agreed_price: number | null;
  agreed_price_per_base_unit: number | null;
  agreement_valid_from: string | null;
  agreement_valid_to: string | null;
  agreement_document_url: string | null;
}

const numEq = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));

/**
 * `saved` bare når lest kobling har nøyaktig det frosne innholdet (og dokumentstien når den finnes).
 * `not_observed` betyr at lagret tilstand ikke er lik — det beviser ikke at kallet feilet (en annen kan ha
 * endret avtalen etterpå), så ny lagring krever et eksplisitt valg.
 */
export function reconcileAgreement(p: PendingAgreement, row: StoredLink | null): "saved" | "not_observed" {
  if (!row) return "not_observed";
  const ok =
    numEq(row.agreed_price, p.payload.agreed_price) &&
    numEq(row.agreed_price_per_base_unit, p.payload.agreed_price_per_base_unit) &&
    (row.agreement_valid_from ?? null) === (p.payload.agreement_valid_from ?? null) &&
    (row.agreement_valid_to ?? null) === (p.payload.agreement_valid_to ?? null) &&
    (p.documentPath == null || row.agreement_document_url === p.documentPath);
  return ok ? "saved" : "not_observed";
}
