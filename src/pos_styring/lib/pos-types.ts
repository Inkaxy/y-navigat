// Delte typer for POS-modulen.
// Shape er valgt (option C) i F4 — Kiosk-implementasjonen MÅ følge disse
// når pos_record_sale faktisk implementeres. Brukes også av F5.

export type PaymentMethod =
  | "cash"
  | "card"
  | "vipps"
  | "invoice"
  | "gift_card"
  | "other";

export interface PaymentEntry {
  method: PaymentMethod;
  amount: number;
  reference?: string;
  card_brand?: string;
}

export interface PaymentSummary {
  payments: PaymentEntry[];
  total_paid: number;
  change_given?: number;
}

export interface MvaBreakdownEntry {
  rate: number; // f.eks. 15, 25
  net: number;
  vat: number;
  gross: number;
}
export type MvaBreakdown = MvaBreakdownEntry[];

export interface ProductSnapshot {
  display_name: string;
  display_number: string | null;
  unit: string | null;
  mva_rate: number;
}

export type TransactionType = "sale" | "return" | "correction" | "training";
export type DiningMode = "takeaway" | "eatin";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Kontant",
  card: "Kort",
  vipps: "Vipps",
  invoice: "Faktura",
  gift_card: "Gavekort",
  other: "Annet",
};

export function paymentLabel(p: PaymentEntry): string {
  const base = PAYMENT_METHOD_LABEL[p.method] ?? p.method;
  if (p.method === "card" && p.card_brand) return `${base} (${p.card_brand})`;
  return base;
}

// ─── Defensive parsers (jsonb kommer som unknown fra Supabase) ───────────

export function parsePaymentSummary(raw: unknown): PaymentSummary {
  const fallback: PaymentSummary = { payments: [], total_paid: 0 };
  if (!raw || typeof raw !== "object") return fallback;
  const obj = raw as Record<string, unknown>;
  const paymentsRaw = Array.isArray(obj.payments) ? obj.payments : [];
  const payments: PaymentEntry[] = paymentsRaw.flatMap((p): PaymentEntry[] => {
    if (!p || typeof p !== "object") return [];
    const e = p as Record<string, unknown>;
    const method = (e.method as PaymentMethod) ?? "other";
    const amount = Number(e.amount) || 0;
    const out: PaymentEntry = { method, amount };
    if (typeof e.reference === "string") out.reference = e.reference;
    if (typeof e.card_brand === "string") out.card_brand = e.card_brand;
    return [out];
  });
  return {
    payments,
    total_paid: Number(obj.total_paid) || payments.reduce((s, p) => s + p.amount, 0),
    change_given: obj.change_given != null ? Number(obj.change_given) : undefined,
  };
}

export function parseMvaBreakdown(raw: unknown): MvaBreakdown {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): MvaBreakdownEntry[] => {
    if (!e || typeof e !== "object") return [];
    const o = e as Record<string, unknown>;
    return [{
      rate: Number(o.rate) || 0,
      net: Number(o.net) || 0,
      vat: Number(o.vat) || 0,
      gross: Number(o.gross) || 0,
    }];
  });
}

export function parseProductSnapshot(raw: unknown): ProductSnapshot {
  const fallback: ProductSnapshot = {
    display_name: "(ukjent produkt)",
    display_number: null,
    unit: null,
    mva_rate: 0,
  };
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  return {
    display_name: typeof o.display_name === "string" ? o.display_name : fallback.display_name,
    display_number: typeof o.display_number === "string" ? o.display_number : null,
    unit: typeof o.unit === "string" ? o.unit : null,
    mva_rate: Number(o.mva_rate) || 0,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────

export function formatReceiptDisplay(opts: {
  receipt_number: string | null | undefined;
  terminal_code: string;
  receipt_sequence: number | string | null | undefined;
}): string {
  const rn = (opts.receipt_number ?? "").trim();
  if (rn) return rn;
  const seq = opts.receipt_sequence ?? "?";
  return `T-${opts.terminal_code}-${seq}`;
}
