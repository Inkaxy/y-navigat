/**
 * Mottaksstatus per fakturalinje.
 *
 * Lagerbevegelse og bekreftet varemottak er TO ulike fakta:
 * - `stock_movements` (purchase/return mot linja) kan finnes før mottaket er
 *   bekreftet, fordi fakturatriggeren kan ha ført mengden.
 * - Bare en rad i `rm_goods_receipts` betyr at mottaket er bekreftet (med parti).
 * En linje med bevegelse men uten mottak kan derfor fortsatt bekreftes; RPC-en
 * knytter da mottak/parti til den eksisterende bevegelsen uten ny bevegelse.
 */

export type Evidence<T> = { status: "ok"; value: T } | { status: "error" };

export interface ReceiptRecord {
  quantity_base: number;
  received_at: string;
  lot_id: string | null;
}

export interface MovementEvidence {
  /** Sum av purchase/return-bevegelser knyttet til linja. */
  quantity_base: number;
  types: string[];
}

export interface ReceiptLineFacts {
  raw_material_id: string | null;
  stock_tracking: boolean;
  quantity: number | null;
  unit: string | null;
  base_quantity: number | null;
  base_unit: string | null;
  requires_review: boolean;
  not_applicable: boolean;
  is_credit_note: boolean;
  receipt: Evidence<ReceiptRecord | null>;
  movement: Evidence<MovementEvidence | null>;
}

export type ReceiptState =
  | { kind: "unlinked" }
  | { kind: "not_applicable" }
  | { kind: "untracked" }
  | { kind: "unknown" }
  | { kind: "confirmed"; receipt: ReceiptRecord; credit: boolean }
  | { kind: "review" }
  | { kind: "needs_quantity" }
  | { kind: "receivable"; quantity: number; credit: boolean; hasMovement: boolean | null };

/** Samme mengderegel som serveren: base_quantity, ellers fakturamengde når enheten er baseenheten. */
export function serverQuantity(f: Pick<ReceiptLineFacts, "base_quantity" | "quantity" | "unit" | "base_unit" | "is_credit_note">): number | null {
  let q = f.base_quantity;
  if (q == null && f.quantity != null && (f.unit ?? "").toLowerCase() === (f.base_unit ?? "").toLowerCase() && (f.unit ?? "") !== "") {
    q = f.quantity;
  }
  if (q == null || !Number.isFinite(q) || q === 0) return null;
  if (f.is_credit_note) return -Math.abs(q);
  if (q < 0) return null;
  return q;
}

export function receiptState(f: ReceiptLineFacts): ReceiptState {
  if (!f.raw_material_id) return { kind: "unlinked" };
  if (f.not_applicable) return { kind: "not_applicable" };
  if (!f.stock_tracking) return { kind: "untracked" };
  // Uten svar fra mottaksoppslaget kan vi verken love «mottatt» eller tilby mottak.
  if (f.receipt.status === "error") return { kind: "unknown" };
  if (f.receipt.value) return { kind: "confirmed", receipt: f.receipt.value, credit: f.receipt.value.quantity_base < 0 };
  if (f.requires_review) return { kind: "review" };
  const qty = serverQuantity(f);
  if (qty == null) return { kind: "needs_quantity" };
  const hasMovement = f.movement.status === "ok" ? f.movement.value != null : null;
  return { kind: "receivable", quantity: qty, credit: qty < 0, hasMovement };
}

export function movementLabel(m: Evidence<MovementEvidence | null>): string {
  if (m.status === "error") return "Lagerbevegelse ukjent";
  if (!m.value) return "Ingen lagerbevegelse";
  return m.value.types.includes("return") ? "Retur ført på lager" : "Innkjøp ført på lager";
}

/* ------------------------------------------------------------------ */
/* Parti og best før                                                   */
/* ------------------------------------------------------------------ */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Gyldig ISO-dato (yyyy-mm-dd) som faktisk finnes i kalenderen. Tom = ingen dato. */
export function validateBestBefore(v: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const s = v.trim();
  if (s === "") return { ok: true, value: null };
  const m = ISO.exec(s);
  if (!m) return { ok: false, message: "Bruk datoformat åååå-mm-dd." };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { ok: false, message: "Datoen finnes ikke." };
  if (y < 2000 || y > 2100) return { ok: false, message: "Året ser feil ut." };
  return { ok: true, value: s };
}

export function validateLotNumber(v: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const s = v.trim();
  if (s === "") return { ok: true, value: null };
  if (s.length > 64) return { ok: false, message: "Partinummeret kan være høyst 64 tegn." };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(s)) return { ok: false, message: "Partinummeret inneholder ugyldige tegn." };
  return { ok: true, value: s };
}

/* ------------------------------------------------------------------ */
/* RPC-svar                                                            */
/* ------------------------------------------------------------------ */

export type ReceiveOutcome =
  | { kind: "not_stock" }
  | { kind: "already"; quantity_base: number; received_at: string | null; lot_id: string | null }
  | { kind: "received"; quantity_base: number; lot_id: string | null; movement_id: string };

export class ReceiveOutcomeUnknownError extends Error {
  constructor() {
    super("Vi vet ikke om mottaket ble registrert. Mottaksstatus hentes på nytt før du prøver igjen.");
    this.name = "ReceiveOutcomeUnknownError";
  }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optId = (v: unknown): v is string | null | undefined => v == null || typeof v === "string";

/** Streng lesing av `rm_receive_invoice_line`. Alt annet enn de tre kjente svarene er ukjent utfall. */
export function parseReceiveResult(data: unknown): ReceiveOutcome {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ReceiveOutcomeUnknownError();
  const o = data as Record<string, unknown>;
  if (o.ok !== true) throw new ReceiveOutcomeUnknownError();
  if (o.skipped === "ikke_lagerfort") return { kind: "not_stock" };
  if (o.skipped != null) throw new ReceiveOutcomeUnknownError();
  if (o.already_received === true) {
    if (!finite(o.quantity_base) || !optId(o.lot_id) || !(o.received_at == null || typeof o.received_at === "string")) throw new ReceiveOutcomeUnknownError();
    return { kind: "already", quantity_base: o.quantity_base, received_at: (o.received_at as string | null | undefined) ?? null, lot_id: (o.lot_id as string | null | undefined) ?? null };
  }
  if (o.already_received === false) {
    if (!finite(o.quantity_base) || typeof o.movement_id !== "string" || !o.movement_id || !optId(o.lot_id)) throw new ReceiveOutcomeUnknownError();
    return { kind: "received", quantity_base: o.quantity_base, lot_id: (o.lot_id as string | null | undefined) ?? null, movement_id: o.movement_id };
  }
  throw new ReceiveOutcomeUnknownError();
}
