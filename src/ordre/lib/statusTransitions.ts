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
};

/**
 * Tedebe-modellen: eneste manuelle overganger er godkjenn / avvis / avbryt.
 * Pakkseddel, levering og fakturering styres av pakkseddel- og faktureringsmodulene.
 *
 * @param current      nåværende status
 * @param isReturn     returordre (kun tekstlig forskjell)
 * @param hasApprovalReason  ordren kom fra nettbutikk/kakebygger
 */
export function getStatusActions(
  current: OrderStatus,
  isReturn = false,
  hasApprovalReason = true,
): StatusAction[] {
  switch (current) {
    case "awaiting_confirmation":
      if (!hasApprovalReason) return [];
      return [
        { label: isReturn ? "Godkjenn retur" : "Godkjenn", to: "confirmed" },
        {
          label: "Avvis",
          to: "cancelled",
          variant: "destructive",
          requireComment: true,
          commentLabel: isReturn ? "Hvorfor avvises returen?" : "Hvorfor avvises ordren?",
        },
      ];
    case "confirmed":
      return [
        {
          label: "Avbryt ordre",
          to: "cancelled",
          variant: "destructive",
          requireComment: true,
          commentLabel: "Hvorfor avbrytes ordren?",
        },
      ];
    default:
      return [];
  }
}

/** Statuser hvor "Avbryt ordre" er tillatt */
export function canCancel(status: OrderStatus): boolean {
  return status === "confirmed" || status === "awaiting_confirmation";
}

/** Sjekk om "Slett" skal være synlig (UI-bestemt; RLS er kilden til sannhet) */
export function canDelete(status: OrderStatus, isWriter: boolean, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return status === "awaiting_confirmation" && isWriter;
}
