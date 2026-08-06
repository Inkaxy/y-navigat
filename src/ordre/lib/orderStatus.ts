export type OrderStatus =
  | "draft"
  | "awaiting_confirmation"
  | "confirmed"
  | "in_production"
  | "packed"
  | "partial_delivery"
  | "delivered"
  | "on_hold"
  | "invoiced"
  | "cancelled";

export type OrderSource = "manual" | "website" | "email" | "edi" | "subscription" | "portal";

export const ORDER_STATUSES: { value: OrderStatus; label: string; tokenVar: string }[] = [
  { value: "draft", label: "Utkast", tokenVar: "--status-draft" },
  { value: "awaiting_confirmation", label: "Venter godkjenning", tokenVar: "--status-awaiting" },
  { value: "confirmed", label: "Bekreftet", tokenVar: "--status-confirmed" },
  { value: "in_production", label: "I produksjon", tokenVar: "--status-in-production" },
  { value: "packed", label: "Pakket", tokenVar: "--status-packed" },
  { value: "partial_delivery", label: "Delvis levert", tokenVar: "--status-partial" },
  { value: "delivered", label: "Levert", tokenVar: "--status-delivered" },
  { value: "on_hold", label: "På vent", tokenVar: "--status-on-hold" },
  { value: "invoiced", label: "Fakturert", tokenVar: "--status-invoiced" },
  { value: "cancelled", label: "Avbrutt", tokenVar: "--status-cancelled" },
];

export const SOURCE_LABELS: Record<OrderSource, string> = {
  manual: "Manuell",
  website: "Web",
  email: "E-post",
  edi: "EDI",
  subscription: "Abonnement",
  portal: "Portal",
};

export function getStatusMeta(status: string) {
  return ORDER_STATUSES.find((s) => s.value === status) ?? {
    value: status as OrderStatus,
    label: status,
    tokenVar: "--status-draft",
  };
}

export function getSourceLabel(source: string) {
  return SOURCE_LABELS[source as OrderSource] ?? source;
}

/** Default-status som ekskluderes i ordreliste-filteret */
export const DEFAULT_EXCLUDED_STATUSES: OrderStatus[] = ["cancelled", "invoiced"];
