export const APP_CODE = "fakturaer" as const;
import { osloTodayISO } from "@/lib/osloDate";

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
/**
 * Beløp i fakturaens EGEN valuta. Køen viser tall fra fakturaer som kan være
 * i annen valuta enn NOK — da skal det ikke stå «kr».
 */
export function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return "—";
  const code = (currency ?? "NOK").toUpperCase();
  try {
    return new Intl.NumberFormat("nb-NO", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value);
  } catch {
    // Ukjent valutakode skal vises, ikke skjules bak en feil.
    return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(value)} ${code}`;
  }
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(d);
}
export function todayIso(): string {
  return osloTodayISO();
}
