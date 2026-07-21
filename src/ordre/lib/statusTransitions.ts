import type { OrderStatus } from "./orderStatus";

export type StatusAction = {
  /** Knapp-etikett */
  label: string;
  /** Måletilstand */
  to: OrderStatus;
  /** Hvor "destruktiv" knappen oppleves */
  variant?: "default" | "outline" | "secondary" | "destructive";
  /** Krever obligatorisk kommentar i modalen */
  requireComment?: boolean;
  /** Etikett på kommentar-feltet (overstyrer standard) */
  commentLabel?: string;
  /** Setter previous_status_before_hold = current før overgangen */
  storesPreviousStatus?: boolean;
  /** Nullstiller previous_status_before_hold etter overgangen */
  clearsPreviousStatus?: boolean;
};

/**
 * Standard fremover-handlinger basert på nåværende status.
 * For returordrer hoppes produksjon/pakking over — «Godkjenn» går rett til fakturert.
 */
export function getStatusActions(current: OrderStatus, isReturn = false): StatusAction[] {
  if (isReturn) {
    switch (current) {
      case "draft":
        return [{ label: "Godkjenn og fakturer", to: "invoiced" }];
      case "awaiting_confirmation":
        return [
          { label: "Godkjenn og fakturer", to: "invoiced" },
          {
            label: "Avvis",
            to: "cancelled",
            variant: "destructive",
            requireComment: true,
            commentLabel: "Hvorfor avvises returen?",
          },
        ];
      case "confirmed":
        return [{ label: "Marker som fakturert", to: "invoiced" }];
      case "on_hold":
      case "invoiced":
      case "cancelled":
        return [];
      default:
        return [{ label: "Marker som fakturert", to: "invoiced" }];
    }
  }

  switch (current) {
    case "draft":
      return [{ label: "Bekreft ordre", to: "confirmed" }];
    case "awaiting_confirmation":
      return [
        { label: "Godkjenn", to: "confirmed" },
        {
          label: "Avvis",
          to: "cancelled",
          variant: "destructive",
          requireComment: true,
          commentLabel: "Hvorfor avvises ordren?",
        },
      ];
    case "confirmed":
      return [
        { label: "Send til produksjon", to: "in_production" },
        {
          label: "Sett på vent",
          to: "on_hold",
          variant: "outline",
          requireComment: true,
          commentLabel: "Hvorfor settes ordren på vent?",
          storesPreviousStatus: true,
        },
      ];
    case "in_production":
      return [
        { label: "Marker som pakket", to: "packed" },
        {
          label: "Sett på vent",
          to: "on_hold",
          variant: "outline",
          requireComment: true,
          commentLabel: "Hvorfor settes ordren på vent?",
          storesPreviousStatus: true,
        },
      ];
    case "packed":
      return [
        { label: "Marker som levert", to: "delivered" },
        {
          label: "Marker som delvis levert",
          to: "partial_delivery",
          variant: "outline",
          requireComment: true,
          commentLabel: "Hva mangler?",
        },
      ];
    case "partial_delivery":
      return [{ label: "Marker som fullført", to: "delivered" }];
    case "delivered":
      return [{ label: "Marker som fakturert", to: "invoiced" }];
    case "on_hold":
      // "Frigi" returnerer til previous_status_before_hold — håndteres dynamisk
      return [];
    case "invoiced":
    case "cancelled":
      return [];
    default:
      return [];
  }
}

/** Hovedflytens "spine" — vises i statusbjelken */
export const MAIN_FLOW: OrderStatus[] = [
  "draft",
  "confirmed",
  "in_production",
  "packed",
  "delivered",
  "invoiced",
];

/** Sidegrener vist som badges over/under flyten */
export const SIDE_BRANCHES: OrderStatus[] = [
  "awaiting_confirmation",
  "on_hold",
  "partial_delivery",
  "cancelled",
];

/** Rekkefølge for å bestemme hvor langt vi har kommet i hovedflyten */
export function flowIndex(status: OrderStatus): number {
  return MAIN_FLOW.indexOf(status);
}

/** Statuser hvor "Avbryt ordre" er tillatt */
export function canCancel(status: OrderStatus): boolean {
  return !["delivered", "invoiced", "cancelled"].includes(status);
}

/** Sjekk om "Slett" skal være synlig (UI-bestemt; RLS er kilden til sannhet) */
export function canDelete(status: OrderStatus, isWriter: boolean, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return status === "draft" && isWriter;
}
