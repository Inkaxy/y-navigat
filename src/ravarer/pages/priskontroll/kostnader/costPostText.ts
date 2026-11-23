import { formatNok } from "@/ravarer/lib/constants";

/** Beløp for en post/leverandør/linje. Ukjent beløp vises aldri som 0 kr. */
export function amountText(amount: number | null, missing: number): string {
  if (amount == null) return missing > 0 ? "Ukjent beløp" : "–";
  return missing > 0 ? `${formatNok(amount)} + ${missing} uten beløp` : formatNok(amount);
}

export const linesText = (n: number) => `${n} ${n === 1 ? "linje" : "linjer"}`;

/** Forslag til postnavn ut fra linjeteksten og det leseren merket linjen som. */
export function suggestedPostName(text: string | null, lineKind: string | null): string {
  const t = (text ?? "").toLocaleLowerCase("nb-NO");
  if (/milj[øo]\s*(vederlag|avgift|gebyr)/.test(t)) return "Miljøvederlag";
  if (lineKind === "frakt" || /frakt|transport/.test(t)) return "Frakt";
  if (lineKind === "pant" || /\bpant/.test(t)) return "Pant";
  return "";
}
