export const APP_CODE = "fakturaer" as const;

// Status-modell etter Tripletex-omlegging: NBhub validerer kun pris.
// Lifecycle (mottak, godkjenning, attestering, betaling) eies av Tripletex.
export const INVOICE_STATUSES = [
  { value: "imported", label: "Importert", tone: "muted" },
  { value: "needs_review", label: "Krever gjennomgang", tone: "warning" },
  { value: "ready", label: "Klar for avstemming", tone: "info" },
  { value: "reconciled", label: "Avstemt", tone: "success" },
  { value: "flagged", label: "Flagget", tone: "danger" },
] as const;

export const INVOICE_SOURCES = [
  { value: "tripletex", label: "Tripletex" },
  { value: "manual", label: "Manuell" },
  { value: "ehf", label: "EHF (legacy)" },
  { value: "pdf_upload", label: "PDF (legacy)" },
  { value: "email", label: "E-post (legacy)" },
] as const;

export const LINE_UNITS = ["kg", "g", "l", "ml", "stk", "pakke", "kartong", "sekk", "pall"] as const;

export function formatNok(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 2 }).format(value);
}
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(d);
}
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
