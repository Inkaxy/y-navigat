/**
 * Felles klientkontrakt for de offentlige leverandørportalene (`/tilbud/:token`
 * og `/bekreftelse/:token`). Svarene leses strengt felt for felt — aldri casting.
 *
 * Utfallsklassene for kall:
 *  - `ok`       : 2xx med parsebar JSON.
 *  - `rejected` : 4xx med parsebar JSON — serveren har bevislig avvist.
 *  - `unknown`  : nettverksfeil, 5xx eller uleselig svar — operasjonen kan ha
 *                 skjedd. Skrivinger sendes aldri automatisk på nytt.
 */

export const FN_BASE = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;

export type PortalRecord = Record<string, unknown>;
export type CallOutcome =
  | { kind: "ok"; body: PortalRecord }
  | { kind: "rejected"; code: string | null; status: number }
  | { kind: "unknown" };

export function isRecord(v: unknown): v is PortalRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
export function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function callPortal(fn: string, body: PortalRecord): Promise<CallOutcome> {
  let res: Response;
  try {
    res = await fetch(`${FN_BASE}/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "unknown" };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status >= 500 || !isRecord(json)) return { kind: "unknown" };
  if (!res.ok) return { kind: "rejected", code: strOrNull(json.result) ?? strOrNull(json.error), status: res.status };
  return { kind: "ok", body: json };
}

export const ACCESS_ERRORS: Record<string, string> = {
  invalid_token: "Ugyldig lenke",
  wrong_password: "Feil passord",
  locked: "Tilgang midlertidig låst (for mange forsøk)",
  expired: "Lenken er utløpt",
  rate_limited: "For mange forsøk – vent litt før du prøver igjen",
  wrong_mode: "Denne lenken hører ikke til en live-forhandling",
};
export function accessErrorText(o: CallOutcome): string {
  if (o.kind === "unknown") return "Fikk ikke kontakt med tjenesten. Prøv igjen.";
  if (o.kind === "rejected") return (o.code && ACCESS_ERRORS[o.code]) || "Tilgang nektet";
  return "Uventet svar fra tjenesten. Prøv igjen.";
}

// ---------- RFQ ----------
export interface RfqItem {
  id: string;
  raw_material_id: string | null;
  expected_annual_volume: number | null;
  expected_annual_volume_unit: string | null;
  suggested_package_size: number | null;
  suggested_package_unit: string | null;
  rm_name: string | null;
  base_unit: string | null;
}
export interface RfqResponse {
  negotiation_item_id: string;
  offered_price: number | null;
  offered_package_size: number | null;
  offered_package_unit: string | null;
  contract_length_months: number | null;
  min_order_volume: number | null;
  min_order_unit: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  notes: string | null;
  datasheet_url: string | null;
  status: string | null;
}
export interface RfqBundle {
  recipient_id: string;
  negotiation_id: string;
  negotiation_title: string | null;
  response_deadline: string | null;
  supplier_name: string | null;
  items: RfqItem[];
  responses: RfqResponse[];
}

export function emptyResponse(itemId: string): RfqResponse {
  return {
    negotiation_item_id: itemId, offered_price: null, offered_package_size: null, offered_package_unit: null,
    contract_length_months: null, min_order_volume: null, min_order_unit: null, payment_terms: null,
    delivery_terms: null, notes: null, datasheet_url: null, status: null,
  };
}

function rm(v: unknown): { name: string | null; base_unit: string | null } {
  return isRecord(v) ? { name: strOrNull(v.name), base_unit: strOrNull(v.base_unit) } : { name: null, base_unit: null };
}

export function parseRfqBundle(b: PortalRecord): RfqBundle | null {
  const recipient = strOrNull(b.recipient_id);
  const negotiation = strOrNull(b.negotiation_id);
  // Begge listene er påkrevd: manglende svarliste er en feilet lesing, aldri «ingen svar».
  if (b.result !== "ok" || !recipient || !negotiation || !Array.isArray(b.items) || !Array.isArray(b.responses)) return null;
  const items: RfqItem[] = [];
  for (const raw of b.items) {
    if (!isRecord(raw) || !strOrNull(raw.id)) return null;
    const r = rm(raw.raw_materials);
    items.push({
      id: String(raw.id),
      raw_material_id: strOrNull(raw.raw_material_id),
      expected_annual_volume: numOrNull(raw.expected_annual_volume),
      expected_annual_volume_unit: strOrNull(raw.expected_annual_volume_unit),
      suggested_package_size: numOrNull(raw.suggested_package_size),
      suggested_package_unit: strOrNull(raw.suggested_package_unit),
      rm_name: r.name,
      base_unit: r.base_unit,
    });
  }
  const ids = new Set(items.map((i) => i.id));
  if (ids.size !== items.length) return null;
  const responses: RfqResponse[] = [];
  const seen = new Set<string>();
  for (const raw of b.responses) {
    if (!isRecord(raw)) return null;
    const itemId = strOrNull(raw.negotiation_item_id);
    // Svar for linjer som ikke hører til denne forespørselen ignoreres (egen mottaker/egne linjer).
    if (!itemId || !ids.has(itemId)) continue;
    if (seen.has(itemId)) return null;
    seen.add(itemId);
    responses.push({
      negotiation_item_id: itemId,
      offered_price: numOrNull(raw.offered_price),
      offered_package_size: numOrNull(raw.offered_package_size),
      offered_package_unit: strOrNull(raw.offered_package_unit),
      contract_length_months: numOrNull(raw.contract_length_months),
      min_order_volume: numOrNull(raw.min_order_volume),
      min_order_unit: strOrNull(raw.min_order_unit),
      payment_terms: strOrNull(raw.payment_terms),
      delivery_terms: strOrNull(raw.delivery_terms),
      notes: strOrNull(raw.notes),
      datasheet_url: strOrNull(raw.datasheet_url),
      status: strOrNull(raw.status),
    });
  }
  return {
    recipient_id: recipient,
    negotiation_id: negotiation,
    negotiation_title: strOrNull(b.negotiation_title),
    response_deadline: strOrNull(b.response_deadline),
    supplier_name: strOrNull(b.supplier_name),
    items,
    responses,
  };
}

// ---------- Live-bekreftelse ----------
export interface LiveItem {
  id: string;
  live_agreed_price: number | null;
  live_agreed_price_unit: string | null;
  live_agreed_package_size: number | null;
  live_agreed_package_unit: string | null;
  live_agreed_contract_months: number | null;
  live_agreed_min_volume: number | null;
  live_agreed_min_volume_unit: string | null;
  live_status: string | null;
  rm_name: string | null;
  base_unit: string | null;
}
export interface LiveBundle {
  recipient_id: string;
  negotiation_id: string;
  negotiation_title: string | null;
  confirmation_deadline: string | null;
  supplier_name: string | null;
  items: LiveItem[];
}

export function parseLiveBundle(b: PortalRecord): LiveBundle | null {
  const recipient = strOrNull(b.recipient_id);
  const negotiation = strOrNull(b.negotiation_id);
  if (b.result !== "ok" || !recipient || !negotiation || !Array.isArray(b.items)) return null;
  const items: LiveItem[] = [];
  for (const raw of b.items) {
    if (!isRecord(raw) || !strOrNull(raw.id)) return null;
    const r = rm(raw.raw_materials);
    items.push({
      id: String(raw.id),
      live_agreed_price: numOrNull(raw.live_agreed_price),
      live_agreed_price_unit: strOrNull(raw.live_agreed_price_unit),
      live_agreed_package_size: numOrNull(raw.live_agreed_package_size),
      live_agreed_package_unit: strOrNull(raw.live_agreed_package_unit),
      live_agreed_contract_months: numOrNull(raw.live_agreed_contract_months),
      live_agreed_min_volume: numOrNull(raw.live_agreed_min_volume),
      live_agreed_min_volume_unit: strOrNull(raw.live_agreed_min_volume_unit),
      live_status: strOrNull(raw.live_status),
      rm_name: r.name,
      base_unit: r.base_unit,
    });
  }
  if (new Set(items.map((i) => i.id)).size !== items.length) return null;
  return {
    recipient_id: recipient,
    negotiation_id: negotiation,
    negotiation_title: strOrNull(b.negotiation_title),
    confirmation_deadline: strOrNull(b.confirmation_deadline),
    supplier_name: strOrNull(b.supplier_name),
    items,
  };
}

export interface LiveLineDraft {
  confirmed: boolean;
  supplier_note: string;
  datasheet_path: string | null;
  datasheet_skipped: boolean;
  uploadedName: string | null;
}
export const emptyLiveDraft = (): LiveLineDraft => ({
  confirmed: false, supplier_note: "", datasheet_path: null, datasheet_skipped: false, uploadedName: null,
});

/** Leser lokal kladd strengt; bare linjer som finnes i gjeldende bunt gjenopprettes. */
export function parseLiveDraft(raw: string | null, itemIds: ReadonlySet<string>): { states: Record<string, LiveLineDraft>; paymentDays: string } | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v) || !isRecord(v.states)) return null;
  const states: Record<string, LiveLineDraft> = {};
  for (const [id, s] of Object.entries(v.states)) {
    if (!itemIds.has(id) || !isRecord(s)) continue;
    states[id] = {
      confirmed: s.confirmed === true,
      supplier_note: strOrNull(s.supplier_note) ?? "",
      datasheet_path: strOrNull(s.datasheet_path),
      datasheet_skipped: s.datasheet_skipped === true,
      uploadedName: strOrNull(s.uploadedName),
    };
  }
  return { states, paymentDays: strOrNull(v.paymentDays) ?? "" };
}

export function liveDraftKey(token: string): string {
  return `live-confirm-draft-${token}`;
}

/** Betalingsdager: tomt = ikke oppgitt; ellers heltall 0–365. */
export function parsePaymentDays(v: string): { ok: true; value: number | null } | { ok: false } {
  const t = v.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d{1,3}$/.test(t)) return { ok: false };
  const n = Number(t);
  return n <= 365 ? { ok: true, value: n } : { ok: false };
}

/** Opplastingsbillett fra `request-*-datasheet-upload`. */
export function parseUploadTicket(b: PortalRecord): { path: string; signedUrl: string } | null {
  const path = strOrNull(b.path);
  const signedUrl = strOrNull(b.signedUrl) ?? strOrNull(b.signed_url);
  return b.result === "ok" && path && signedUrl ? { path, signedUrl } : null;
}

/**
 * Laster opp én PDF via signert URL. `isCurrent` kontrolleres før den andre skrivingen (PUT):
 * etter avbrudd (lukk/lenkebytte/lagring) startes ingen ny lagringsskriving. En allerede
 * sendt PUT kan ikke trekkes tilbake. Gir sti ved suksess, «cancelled» ved avbrudd, ellers null.
 */
export async function uploadPdf(fn: string, auth: PortalRecord, itemId: string, file: File, isCurrent: () => boolean): Promise<string | null | "cancelled"> {
  if (!isCurrent()) return "cancelled";
  const ticket = await callPortal(fn, { ...auth, negotiation_item_id: itemId, filename: file.name });
  if (!isCurrent()) return "cancelled";
  if (ticket.kind !== "ok") return null;
  const t = parseUploadTicket(ticket.body);
  if (!t) return null;
  try {
    const put = await fetch(t.signedUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/pdf" }, body: file });
    return put.ok ? t.path : null;
  } catch {
    return null;
  }
}

export function formatNok(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
export function formatDeadline(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/**
 * `submit-negotiation-response` svarer nøyaktig `{success:true, finalized:boolean}`.
 * Suksess krever at `finalized` er lik den frosne forespørselen; alt annet er ukjent.
 * Svaret er ingen kvittering per linje.
 */
export function isRfqSubmitReceipt(body: PortalRecord, finalize: boolean): boolean {
  return body.success === true && typeof body.finalized === "boolean" && body.finalized === finalize;
}

/** `submit-live-confirmation` svarer `{success:true, all_confirmed:boolean}`. Ufullstendig = ukjent. */
export function liveSubmitReceipt(body: PortalRecord): { allConfirmed: boolean } | null {
  return body.success === true && typeof body.all_confirmed === "boolean" ? { allConfirmed: body.all_confirmed } : null;
}

/** Innsendt-tilstand for gjeldende linjer: alle, noen (delvis/må kontrolleres) eller ingen. */
export function rfqSubmissionState(items: readonly RfqItem[], responses: readonly RfqResponse[]): "all" | "partial" | "none" {
  const submitted = new Set(responses.filter((r) => r.status === "submitted").map((r) => r.negotiation_item_id));
  const n = items.filter((i) => submitted.has(i.id)).length;
  if (n === 0) return "none";
  return n === items.length ? "all" : "partial";
}
