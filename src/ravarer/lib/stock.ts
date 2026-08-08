/** Felles hjelpere for handelsvarer og lagerbevegelser. */

export const MOVEMENT_TYPES = [
  "purchase",
  "sale",
  "return",
  "waste",
  "adjustment",
  "opening",
  "correction",
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

const LABELS: Record<string, string> = {
  purchase: "Innkjøp",
  sale: "Salg",
  return: "Retur",
  waste: "Svinn",
  adjustment: "Justering",
  opening: "Inngående",
  correction: "Rettelse",
};

export function movementLabel(type: string): string {
  return LABELS[type] ?? type;
}

/** Lenke til kilden for en bevegelse, hvis vi kan utlede den. */
export function movementSourceLink(
  sourceTable: string | null,
  sourceId: string | null,
  invoiceIdByLineId?: Map<string, string>,
): { to: string; label: string } | null {
  if (!sourceId) return null;
  switch (sourceTable) {
    case "invoice_lines": {
      const invoiceId = invoiceIdByLineId?.get(sourceId);
      return invoiceId ? { to: `/ravarer/fakturaer/${invoiceId}`, label: "Faktura" } : null;
    }
    case "invoices":
      return { to: `/ravarer/fakturaer/${sourceId}`, label: "Faktura" };
    case "pos_transactions":
    case "pos_transaction_lines":
      return { to: `/pos-styring/transaksjoner/${sourceId}`, label: "Kassabilag" };
    case "orders":
    case "order_lines":
      return { to: `/ordre/ordrer/${sourceId}`, label: "Ordre" };
    default:
      return null;
  }
}

/** Hvor lenge holder beholdningen, gitt salget siste 30 dager. */
export function daysOfStock(currentStock: number, sold30d: number): number | null {
  if (sold30d <= 0) return null;
  if (currentStock <= 0) return 0;
  return (currentStock / (sold30d / 30));
}

/** Hastegrad: 0 = negativ beholdning, 1 = under minimum, 2 = ok. */
export function urgencyRank(currentStock: number, minStock: number | null): 0 | 1 | 2 {
  if (currentStock < 0) return 0;
  if (minStock != null && currentStock <= minStock) return 1;
  return 2;
}
