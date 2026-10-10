import { stripPackageTokens, toBaseFactor } from "@/fakturaer/lib/units";
import type { PackageInference, SupplierItemLine } from "@/fakturaer/lib/supplierItems";

const CLOSED = new Set(["reconciled", "approved", "paid", "cancelled", "rejected"]);

export function isOpenLine(l: Pick<SupplierItemLine, "requires_review" | "invoice_status">): boolean {
  return !!l.requires_review && !CLOSED.has(l.invoice_status ?? "");
}

export function openScope(lines: SupplierItemLine[]): { lines: number; invoices: number; lastOpen: SupplierItemLine | null } {
  const open = lines.filter(isOpenLine);
  return { lines: open.length, invoices: new Set(open.map((l) => l.invoice_id)).size, lastOpen: open[0] ?? null };
}

/** Pakningsblokken trengs bare når fakturaenheten ikke kan regnes direkte til grunnenheten. */
export function needsPackage(lineUnit: string | null | undefined, baseUnit: string | null | undefined): boolean {
  if (!baseUnit) return false;
  return toBaseFactor(lineUnit, baseUnit) == null;
}

export function suggestedBaseUnit(inf: Pick<PackageInference, "description"> | null | undefined): "kg" | "l" | "stk" {
  const u = (inf?.description?.unit ?? "").toLowerCase();
  if (u === "kg" || u === "g") return "kg";
  if (["l", "ml", "dl", "cl"].includes(u)) return "l";
  return "stk";
}

/** Navn fra fakturabeskrivelsen uten pakningsord, med stor forbokstav. */
export function nameFromDescription(desc: string | null | undefined): string {
  const s = stripPackageTokens(desc).replace(/\s+/g, " ").trim().toLocaleLowerCase("nb-NO");
  return s ? s.charAt(0).toLocaleUpperCase("nb-NO") + s.slice(1) : "";
}

export const SOURCE_LABEL: Record<NonNullable<PackageInference["source"]>, string> = {
  regnestykke_og_varenavn: "Regnestykket og varenavnet er enige",
  regnestykke: "Bare regnestykket",
  varenavn: "Bare varenavnet",
};

export const NOT_ITEM_REASONS = ["Frakt", "Gebyr/avgift", "Pant som ikke skal følges", "Rabatt", "Annet"] as const;
