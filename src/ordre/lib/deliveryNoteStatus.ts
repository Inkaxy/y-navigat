/** Pakkseddel-statuser — separate fra ordre-statuser (eget domene). */

export type DeliveryNoteStatus = "draft" | "finalized" | "cancelled";

export const DELIVERY_NOTE_STATUSES: {
  value: DeliveryNoteStatus;
  label: string;
  tokenVar: string;
}[] = [
  { value: "draft", label: "Utkast", tokenVar: "--dn-status-draft" },
  { value: "finalized", label: "Ferdigstilt", tokenVar: "--dn-status-finalized" },
  { value: "cancelled", label: "Avbrutt", tokenVar: "--dn-status-cancelled" },
];

export function getDeliveryNoteStatusMeta(status: string) {
  return (
    DELIVERY_NOTE_STATUSES.find((s) => s.value === status) ?? {
      value: status as DeliveryNoteStatus,
      label: status,
      tokenVar: "--dn-status-draft",
    }
  );
}
