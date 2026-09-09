// Ren tilstandslogikk for Tripletex-synken. Ingen nettverk eller database her,
// slik at reglene kan testes med et simulert API.

export interface ChunkResult {
  from: string;
  to: string;
  failed: number;
  /** Sant når sidehentingen traff taket (20 × 1000) og dermed kan være ufullstendig. */
  truncated: boolean;
}

export type SyncStatus = "success" | "partial" | "error";

/** Sidehenting er ufullstendig når siste side var full og vi traff maks antall sider. */
export function pagesTruncated(pagesRead: number, maxPages: number, lastPageSize: number, pageSize: number): boolean {
  return pagesRead >= maxPages && lastPageSize >= pageSize;
}

/** En bit er fullført kun når ingenting feilet og hentingen var komplett. */
export function chunkComplete(c: ChunkResult): boolean {
  return c.failed === 0 && !c.truncated;
}

/**
 * Cursor stopper på FØRSTE bit som ikke ble fullført. Da hentes den samme
 * perioden på nytt neste gang i stedet for å bli hoppet over.
 */
export function nextCursor(
  chunks: ChunkResult[],
  current: string | null,
  today: string,
  opts: { isBackfill: boolean; hasExplicitFrom: boolean },
): string | null {
  if (opts.isBackfill || opts.hasExplicitFrom) return null;
  let candidate: string | null = null;
  for (const c of chunks) {
    if (!chunkComplete(c)) break;
    candidate = c.to > today ? today : c.to;
  }
  if (candidate == null) return null;
  // Aldri bakover, men en cursor som står i framtiden korrigeres ned.
  if (!current || candidate > current || current > today) return candidate;
  return null;
}

/** «success» krever at alt gikk gjennom — ellers er kjøringen delvis. */
export function syncStatus(chunks: ChunkResult[]): SyncStatus {
  if (chunks.length === 0) return "success";
  const failed = chunks.reduce((s, c) => s + c.failed, 0);
  const truncated = chunks.some((c) => c.truncated);
  if (failed > 0 || truncated) return "partial";
  return "success";
}

/** Kort, lesbar forklaring til loggen og statusfeltet. */
export function statusSummary(chunks: ChunkResult[]): string | null {
  const failed = chunks.reduce((s, c) => s + c.failed, 0);
  const truncated = chunks.filter((c) => c.truncated);
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} fakturaer feilet`);
  if (truncated.length > 0) {
    parts.push(`ufullstendig henting for ${truncated.map((c) => `${c.from}–${c.to}`).join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface ExistingInvoice {
  id: string;
  invoice_date: string | null;
  total_amount: number | null;
  is_credit_note: boolean | null;
  tripletex_voucher_id: string | null;
  tripletex_voucher_number: string | null;
  tripletex_supplier_id: string | null;
  line_extraction_status: string | null;
  tripletex_is_paid: boolean | null;
  paid_at: string | null;
}

export interface TripletexInvoiceFacts {
  invoice_date: string | null;
  total_amount: number | null;
  is_credit_note: boolean;
  tripletex_voucher_id: string | null;
  tripletex_voucher_number: string | null;
  tripletex_supplier_id: string | null;
  tripletex_is_paid: boolean | null;
  paid_at: string | null;
}

export interface ExistingUpdatePlan {
  /** Kun Tripletex-egne felt. Aldri status, matching eller avstemming. */
  patch: Record<string, unknown>;
  /** Forskjeller som et menneske må se på. Overskrives ALDRI automatisk. */
  conflicts: { field: string; ours: unknown; tripletex: unknown }[];
}

/**
 * Hva skal skje med en faktura som allerede finnes?
 * Tripletex-referansene fylles ut når de mangler eller har endret seg, men beløp,
 * dato og kreditnota-flagg røres aldri: der rapporteres konflikten i stedet, slik at
 * manuell matching og avstemming står urørt.
 */
export function planExistingUpdate(
  existing: ExistingInvoice,
  tt: TripletexInvoiceFacts,
  opts: { trackLines: boolean },
): ExistingUpdatePlan {
  const patch: Record<string, unknown> = {};
  const conflicts: ExistingUpdatePlan["conflicts"] = [];

  const ttFields: [keyof ExistingInvoice, string, string | null][] = [
    ["tripletex_voucher_id", "tripletex_voucher_id", tt.tripletex_voucher_id],
    ["tripletex_voucher_number", "tripletex_voucher_number", tt.tripletex_voucher_number],
    ["tripletex_supplier_id", "tripletex_supplier_id", tt.tripletex_supplier_id],
  ];
  for (const [key, column, value] of ttFields) {
    if (value != null && String(existing[key] ?? "") !== String(value)) patch[column] = value;
  }

  if (opts.trackLines && existing.line_extraction_status === "not_requested") {
    patch.line_extraction_status = "pending";
  }

  // Betalingsstatus overskrives alltid ved reell endring — dette er ikke noe
  // manuell matching rører, så det trenger ingen konflikthåndtering.
  if (tt.tripletex_is_paid != null && Boolean(existing.tripletex_is_paid) !== tt.tripletex_is_paid) {
    patch.tripletex_is_paid = tt.tripletex_is_paid;
  }
  if ((existing.paid_at ?? null) !== (tt.paid_at ?? null)) {
    patch.paid_at = tt.paid_at ?? null;
  }

  if (tt.invoice_date && existing.invoice_date && tt.invoice_date !== existing.invoice_date) {
    conflicts.push({ field: "invoice_date", ours: existing.invoice_date, tripletex: tt.invoice_date });
  }
  if (
    tt.total_amount != null && existing.total_amount != null &&
    Math.abs(Number(existing.total_amount) - Math.abs(tt.total_amount)) > 0.01
  ) {
    conflicts.push({ field: "total_amount", ours: existing.total_amount, tripletex: Math.abs(tt.total_amount) });
  }
  if (Boolean(existing.is_credit_note) !== tt.is_credit_note) {
    conflicts.push({ field: "is_credit_note", ours: existing.is_credit_note, tripletex: tt.is_credit_note });
  }

  return { patch, conflicts };
}
