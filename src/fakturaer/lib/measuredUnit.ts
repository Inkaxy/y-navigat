// Fakturaenhet som allerede ER et mål (kg, g, l …) mot råvarens grunnenhet. Da finnes ingen
// «innhold per pakning»: mengden regnes direkte (f.eks. levert kg fra silobil). «bulk» uten
// oppgitt vekt er tvetydig — vi gjetter aldri kapasitet, men ber om levert kg via «Rett fakturalinje».
import { fmtNum, normalizeUnit, toBaseFactor } from "@/fakturaer/lib/units";

export type MeasuredBasis =
  | { kind: "direct"; factor: number; baseQuantity: number; text: string }
  | { kind: "credit"; factor: number; baseQuantity: number; text: string }
  | { kind: "missing_quantity"; text: string }
  | { kind: "needs_kg"; text: string }
  | { kind: "package" };

export function measuredBasis(unit: string | null | undefined, quantity: number | null | undefined, baseUnit: string | null | undefined): MeasuredBasis {
  const base = normalizeUnit(baseUnit) ?? null;
  const u = normalizeUnit(unit);
  if (!base) return { kind: "package" };
  if (u === "bulk") {
    return { kind: "needs_kg", text: `Linjen er ført som «bulk» uten levert vekt. Bulk er løs, veid levering – ikke en fast sekk eller full silo. Oppgi levert mengde i ${base} via «Rett fakturalinje»; kapasitet gjettes aldri.` };
  }
  const f = u ? toBaseFactor(u, base) : null;
  if (f == null || !u) return { kind: "package" };
  const q = quantity == null ? null : Number(quantity);
  if (q == null || !Number.isFinite(q) || q === 0) {
    return { kind: "missing_quantity", text: `Fakturalinjen mangler mengde i ${u}.` };
  }
  const baseQuantity = q * f;
  const calc = u === base ? `${fmtNum(q, 3)} ${u}` : `${fmtNum(q, 3)} ${u} = ${fmtNum(baseQuantity, 3)} ${base}`;
  if (q < 0) {
    return { kind: "credit", factor: f, baseQuantity, text: `Kreditlinje: ${calc} (negativt fortegn). Mengden er målt direkte i ${u}, så ingen pakning trengs. Kreditnotaen behandles med egne kontroller – den er ikke en manglende vekt.` };
  }
  return { kind: "direct", factor: f, baseQuantity, text: `Målt mengde: ${calc}. Fakturaen er ført i ${u}, så ingen pakningsstørrelse trengs (også for bulk/silo der levert vekt varierer).` };
}
