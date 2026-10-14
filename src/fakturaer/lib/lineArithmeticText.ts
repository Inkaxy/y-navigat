import { formatMoney } from "@/fakturaer/lib/constants";
import { fmtNum } from "@/fakturaer/lib/units";

/** Linjens lagrede tall slik de står på dokumentet. Rabatt vises alltid når den er registrert. */
export interface ArithmeticLine {
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number | null;
  discount_amount?: number | null;
}

export function registeredDiscount(l: ArithmeticLine): number | null {
  const d = l.discount_amount;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * «10 pose × 977,74 kr − rabatt 3 079,90 kr = 6 697,50 kr». Bare visning av lagrede felt —
 * ingen tall utledes, avrundes inn i lagring eller gjettes.
 */
export function lineArithmeticText(l: ArithmeticLine, currency: string): string {
  const q = l.quantity == null ? "—" : fmtNum(Number(l.quantity));
  const d = registeredDiscount(l);
  return `${q} ${l.unit ?? ""} × ${formatMoney(l.unit_price, currency)}${d != null ? ` − rabatt ${formatMoney(d, currency)}` : ""} = ${formatMoney(l.total_amount, currency)}`.replace(/\s+/g, " ");
}
