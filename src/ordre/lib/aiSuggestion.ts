// Delt typing + helpers for AI-forslag på tickets.
// Schema må holdes synkronisert med supabase/functions/analyze-email-with-ai/index.ts.

export type RequestType =
  | "new_order"
  | "change"
  | "cancellation"
  | "question"
  | "complaint"
  | "internal"
  | "unclear"
  | "spam";

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  new_order: "Ny bestilling",
  change: "Endring",
  cancellation: "Kansellering",
  question: "Spørsmål",
  complaint: "Reklamasjon",
  internal: "Internt",
  unclear: "Uklar",
  spam: "Spam",
};

// Tailwind-klasser med semantic tokens — fungerer i light og dark.
export const REQUEST_TYPE_BADGE: Record<RequestType, string> = {
  new_order: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  change: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  cancellation: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  question: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  complaint: "bg-red-600/10 text-red-700 dark:text-red-300 border-red-600/30",
  internal: "bg-muted text-muted-foreground border-border",
  unclear: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30",
  spam: "bg-muted text-muted-foreground border-border line-through",
};

export type MissingInfo = { code: string; label: string };
export type Risk = { severity: "red" | "yellow" | "green"; code: string; message: string };

export type AiOrderFields = {
  delivery_date?: string | null;
  delivery_time?: string | null;
  pickup_location_hint?: string | null;
  delivery_address_line1?: string | null;
  delivery_address_line2?: string | null;
  delivery_postal_code?: string | null;
  delivery_city?: string | null;
  customer_notes?: string | null;
  internal_notes?: string | null;
  production_notes?: string | null;
  cake_text?: string | null;
  allergies?: string | null;
  special_requests?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
};

export type AiProductLine = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  size_or_servings?: string | null;
  flavor?: string | null;
  filling?: string | null;
  decoration?: string | null;
  match_confidence: number;
};

export type AiSuggestion = {
  request_type: RequestType;
  summary: string;
  suggested_action: string;
  customer_match: {
    customer_id: string | null;
    customer_name: string | null;
    match_confidence: number;
  } | null;
  order_fields: AiOrderFields;
  products: AiProductLine[];
  missing_info: MissingInfo[];
  risks: Risk[];
  field_confidence: Record<string, number>;
  reasoning_per_field: Record<string, string>;
  tour?: { tour_id: string | null; tour_name: string | null } | null;
  delivery_date?: string | null; // bakoverkomp
  confidence_score: number;
  reasoning: string;
};

export const RISK_STYLE: Record<Risk["severity"], string> = {
  red: "bg-destructive/10 text-destructive border-destructive/30",
  yellow: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
};

export function hasRedRisk(s: AiSuggestion | null | undefined): boolean {
  return !!s?.risks?.some((r) => r.severity === "red");
}

export function hasMissingInfo(s: AiSuggestion | null | undefined): boolean {
  return !!s?.missing_info?.length;
}

// Normalisér jsonb fra DB til AiSuggestion (best-effort; tolererer gammelt format).
export function normalizeAiSuggestion(raw: unknown): AiSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // Hvis vi har et minimum av nye felt, returner direkte
  if (typeof r.request_type === "string" && Array.isArray(r.products)) {
    return raw as AiSuggestion;
  }
  // Gammelt format → wrap til nytt minimum
  if (Array.isArray((r as any).products)) {
    return {
      request_type: "unclear",
      summary: "",
      suggested_action: "",
      customer_match: (r as any).customer_match ?? null,
      order_fields: {
        delivery_date: (r as any).delivery_date ?? null,
      },
      products: (r as any).products ?? [],
      missing_info: [],
      risks: [],
      field_confidence: {},
      reasoning_per_field: {},
      tour: (r as any).tour ?? null,
      delivery_date: (r as any).delivery_date ?? null,
      confidence_score: (r as any).confidence_score ?? 0,
      reasoning: (r as any).reasoning ?? "",
    };
  }
  return null;
}
