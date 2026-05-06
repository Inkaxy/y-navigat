export const APP_CODE = "fakturaer" as const;

export const INVOICE_STATUSES = [
  { value: "pending", label: "Venter", tone: "muted" },
  { value: "parsing", label: "Behandles", tone: "muted" },
  { value: "matched", label: "Matchet", tone: "info" },
  { value: "approved", label: "Godkjent", tone: "success" },
  { value: "disputed", label: "Reklamert", tone: "danger" },
  { value: "paid", label: "Betalt", tone: "muted" },
  { value: "pending_parse", label: "Venter parsing", tone: "muted" },
] as const;

export const INVOICE_SOURCES = [
  { value: "manual", label: "Manuell" },
  { value: "ehf", label: "EHF" },
  { value: "pdf_upload", label: "PDF" },
  { value: "email", label: "E-post" },
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
