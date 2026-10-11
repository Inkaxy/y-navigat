/**
 * Uavklart manuell lagerbevegelse fra mottaksavvik. Bevegelsen (`stock_movements`-insert) er ikke idempotent og har
 * ingen operasjonskvittering, så et uklart svar kan bety at den er skrevet.
 *
 * Livsløp: markøren settes FØR kallet sendes («pending») og ligger i en modulbutikk utenfor dialogen og panelet. Den
 * overlever lukk/åpne av dialog og mottakspanel og at svaret kommer etter avmontering, men bare så lenge fanen lever
 * (ingen lagring i nettleseren; en ny sideinnlasting glemmer den). Bekreftet suksess eller et kjent avslag fjerner
 * markøren som hører til nettopp det kallet. Uklart utfall blir «unknown» og fjernes bare når brukeren eksplisitt
 * bekrefter å ha kontrollert lagerbevegelsene. Det finnes aldri noe automatisk nytt forsøk, og fravær av en bevegelse
 * i en bufret liste brukes aldri som bevis.
 */
export interface AdjustmentPayload {
  raw_material_id: string;
  quantity_base: number;
  kind: "waste" | "adjustment";
  note: string;
}
export interface PendingAdjustment {
  token: string;
  entityId: string;
  invoiceId: string;
  lineId: string;
  payload: AdjustmentPayload;
  state: "pending" | "unknown";
  at: string;
}

const store = new Map<string, PendingAdjustment>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const adjustmentKey = (entityId: string, invoiceId: string, lineId: string, rawMaterialId: string) =>
  `${entityId}|${invoiceId}|${lineId}|${rawMaterialId}`;
const keyOf = (p: PendingAdjustment) => adjustmentKey(p.entityId, p.invoiceId, p.lineId, p.payload.raw_material_id);

export function beginAdjustment(p: Omit<PendingAdjustment, "state" | "token" | "at">): PendingAdjustment | null {
  const k = adjustmentKey(p.entityId, p.invoiceId, p.lineId, p.payload.raw_material_id);
  if (store.has(k)) return null;
  const rec: PendingAdjustment = { ...p, state: "pending", token: crypto.randomUUID(), at: new Date().toISOString() };
  store.set(k, rec);
  emit();
  return rec;
}
/** Bekreftet utfall (suksess eller kjent avslag): fjerner bare markøren for dette kallet. */
export function settleAdjustment(rec: PendingAdjustment) {
  if (store.get(keyOf(rec))?.token !== rec.token) return;
  store.delete(keyOf(rec));
  emit();
}
export function markAdjustmentUnknown(rec: PendingAdjustment) {
  const cur = store.get(keyOf(rec));
  if (cur?.token !== rec.token) return;
  store.set(keyOf(rec), { ...cur, state: "unknown" });
  emit();
}
/** Eksplisitt «jeg har kontrollert bevegelsene» — skriver ingenting. Bare et uavklart (ikke pågående) kall. */
export function acknowledgeAdjustment(rec: PendingAdjustment) {
  const cur = store.get(keyOf(rec));
  if (cur?.token !== rec.token || cur.state !== "unknown") return;
  store.delete(keyOf(rec));
  emit();
}
export function pendingAdjustmentFor(entityId: string | null, invoiceId: string, lineId: string, rawMaterialId: string | null): PendingAdjustment | null {
  if (!entityId || !rawMaterialId) return null;
  return store.get(adjustmentKey(entityId, invoiceId, lineId, rawMaterialId)) ?? null;
}
export function subscribePendingAdjustments(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function resetPendingAdjustmentsForTest() { store.clear(); emit(); }

/** Bare en SQLSTATE fra databasen (avslag på data/tilgang) beviser at ingenting ble skrevet. Alt annet er uklart. */
export function isKnownRejection(e: unknown): boolean {
  if (typeof e !== "object" || e === null || !("code" in e)) return false;
  const code = (e as { code: unknown }).code;
  return typeof code === "string" && /^(22|23|28|42|P0)[0-9A-Z]{3}$/.test(code);
}
