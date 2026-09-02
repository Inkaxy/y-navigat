/**
 * Ordremodellen (Tedebe-modellen), trinn 1.
 * Status er redusert til fem verdier — livssyklus utledes i databasen (orders_lifecycle).
 */
export type OrderStatus =
  | "awaiting_confirmation"
  | "confirmed"
  | "delivered"
  | "invoiced"
  | "cancelled";

export type OrderKind = "dated" | "fixed" | "repeating" | "extra" | "return" | "closed";

export type OrderLifecycle =
  | "awaiting"
  | "open"
  | "delivery_note"
  | "delivered"
  | "invoiced"
  | "cancelled";

export type ApprovalReason = "website" | "cake_builder";

export type OrderSource =
  | "manual"
  | "website"
  | "email"
  | "ticket"
  | "phone"
  | "in_store"
  | "matrix_entry"
  | "edi"
  | "subscription"
  | "portal"
  | "pos"
  | "pos_kakebygger";

export const ORDER_STATUSES: { value: OrderStatus; label: string; tokenVar: string }[] = [
  { value: "awaiting_confirmation", label: "Venter godkjenning", tokenVar: "--status-awaiting" },
  { value: "confirmed", label: "Ordre", tokenVar: "--status-confirmed" },
  { value: "delivered", label: "Levert", tokenVar: "--status-delivered" },
  { value: "invoiced", label: "Fakturert", tokenVar: "--status-invoiced" },
  { value: "cancelled", label: "Avbrutt", tokenVar: "--status-cancelled" },
];

export const ORDER_KINDS: { value: OrderKind; label: string; tokenVar: string }[] = [
  { value: "dated", label: "Datert", tokenVar: "--kind-dated" },
  { value: "fixed", label: "Fastordre", tokenVar: "--kind-fixed" },
  { value: "repeating", label: "Repeterende", tokenVar: "--kind-repeating" },
  { value: "extra", label: "Ekstraordre", tokenVar: "--kind-extra" },
  { value: "return", label: "Retur", tokenVar: "--kind-return" },
  { value: "closed", label: "Lukket i kundeportal", tokenVar: "--kind-closed" },
];

export const ORDER_LIFECYCLES: { value: OrderLifecycle; label: string; tokenVar: string }[] = [
  { value: "awaiting", label: "Venter godkjenning", tokenVar: "--lifecycle-awaiting" },
  { value: "open", label: "Uten pakkseddel", tokenVar: "--lifecycle-open" },
  { value: "delivery_note", label: "Pakkseddel", tokenVar: "--lifecycle-delivery-note" },
  { value: "delivered", label: "Levert", tokenVar: "--lifecycle-delivered" },
  { value: "invoiced", label: "Fakturert", tokenVar: "--lifecycle-invoiced" },
  { value: "cancelled", label: "Avbrutt", tokenVar: "--lifecycle-cancelled" },
];

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manuell",
  website: "Web",
  email: "E-post",
  ticket: "E-post/ticket",
  phone: "Telefon",
  in_store: "I butikk",
  matrix_entry: "Matrise",
  edi: "EHF",
  subscription: "Fastordre",
  portal: "Portal",
  pos: "POS",
  pos_kakebygger: "POS kakebygger",
};

export function getStatusMeta(status: string) {
  return (
    ORDER_STATUSES.find((s) => s.value === status) ?? {
      value: status as OrderStatus,
      label: status,
      tokenVar: "--status-confirmed",
    }
  );
}

export function getKindMeta(kind: string | null | undefined) {
  return (
    ORDER_KINDS.find((k) => k.value === kind) ?? {
      value: "dated" as OrderKind,
      label: "Datert",
      tokenVar: "--kind-dated",
    }
  );
}

export function getLifecycleMeta(lifecycle: string | null | undefined) {
  return (
    ORDER_LIFECYCLES.find((l) => l.value === lifecycle) ?? {
      value: "open" as OrderLifecycle,
      label: "Uten pakkseddel",
      tokenVar: "--lifecycle-open",
    }
  );
}

export function getSourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source;
}

/** Grunn til at ordren venter godkjenning — i klartekst */
export function approvalReasonText(reason: string | null | undefined): string {
  if (reason === "website") return "nettbutikken";
  if (reason === "cake_builder") return "kakebyggeren i kundeportalen";
  return "en ekstern kilde";
}

/** Default-status som ekskluderes i ordreliste-filteret */
export const DEFAULT_EXCLUDED_STATUSES: OrderStatus[] = ["cancelled", "invoiced"];
