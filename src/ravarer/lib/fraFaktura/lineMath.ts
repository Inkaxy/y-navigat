// Nye varer: regnestykket på fakturalinjen (mengde × pris − trykt rabatt = linjesum). Ren logikk (testes).
// Bruker den delte lesekontrollen (`lineReadIssues`) – ingen egen toleranse for om linjen er ren. Antallet som
// utledes her er bare et FORSLAG i raden; fakturalinjen rettes aldri her (bare via «Rett fakturalinje»).
import { lineReadIssues } from "@/fakturaer/lib/invoiceReadCheck";
import { normalizeUnit } from "@/fakturaer/lib/units";

export interface MathLine {
  quantity: number | null; unit: string | null; unit_price: number | null; total_amount: number | null;
  package_size: number | null; package_unit: string | null; count_per_package: number | null;
  discount_amount?: number | null; unit_price_basis?: string | null; line_kind?: string | null;
  is_credit_note?: boolean | null; extraction_issues?: unknown;
}

export interface LineMath {
  /** Linjen er lest rent: lesekontrollen har ingen merknad og ingen lagret lesemerknad. */
  clean: boolean;
  /** Antall av fakturaens enhet (flaske, eske …) som prisen skal regnes på. null = ukjent. */
  units: number | null;
  /** Antall stk i én beholder når regnestykket viser det (1 eske = 6 stk). */
  subUnits: number | null;
  /** Regnestykket som forklaring i raden (norske tall). null når linjen er ren. */
  note: string | null;
}

/** Beholdere som rommer flere stk (eske, kartong …). Flaske, boks og pose er én enhet. */
const MULTI = new Set(["eske", "pakke", "kartong", "brett", "kolli", "bunt", "kasse", "d-pak", "dpak"]);
// Flertall for antall-teksten («6 flasker»). units.ts holdes byte-identisk med edge-versjonen, så egen liten tabell her.
const PLURAL: Record<string, string> = { flaske: "flasker", eske: "esker", pakke: "pakker", sekk: "sekker", pose: "poser", boks: "bokser", kanne: "kanner", tube: "tuber", beger: "begre", kartong: "kartonger" };
const plural = (unit: string, n: number) => (n === 1 ? unit : PLURAL[unit] ?? unit);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const kr = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 3 });

function storedIssue(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first: unknown = v[0];
  if (first && typeof first === "object" && "message" in first && typeof first.message === "string") return first.message;
  return "Fakturaleseren har en merknad på linjen.";
}

/**
 * Er linjen lest rent, og hvor mange enheter gjelder prisen? Når mengde × pris ikke stemmer, men
 * (linjesum + trykt rabatt) ÷ enhetspris er et helt tall n, foreslås n: enten som antall (1 flaske lest, 6 solgt)
 * eller som stk per beholder (1 eske = 6 stk). Rabatt utledes aldri – bare trykt rabatt brukes.
 */
export function lineMath(l: MathLine): LineMath {
  const stored = storedIssue(l.extraction_issues);
  const issues = lineReadIssues({
    quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, total_amount: l.total_amount,
    package_size: l.package_size, package_unit: l.package_unit, count_per_package: l.count_per_package,
    unit_price_basis: l.unit_price_basis ?? null, discount_amount: l.discount_amount ?? null, line_kind: l.line_kind ?? null,
    is_credit: l.is_credit_note === true,
  });
  const q = l.quantity, p = l.unit_price, t = l.total_amount;
  if (issues.length === 0 && !stored) return { clean: true, units: fin(q) ? q : null, subUnits: null, note: null };
  if (issues.length === 0 && stored) return { clean: false, units: fin(q) ? q : null, subUnits: null, note: stored };
  const d = fin(l.discount_amount) && l.discount_amount > 0 ? l.discount_amount : 0;
  if (fin(q) && q > 0 && fin(p) && p > 0 && fin(t) && t > 0) {
    const gross = t + d;
    const n = Math.round(gross / p);
    if (n >= 2 && Math.abs(n * p - gross) <= Math.max(0.05, 0.002 * gross)) {
      const unit = normalizeUnit(l.unit) ?? (l.unit ?? "").trim().toLowerCase();
      const calc = `${kr(t)}${d ? ` + ${kr(d)} i rabatt` : ""} = ${n} × ${kr(p)}`;
      const cpp = fin(l.count_per_package) && l.count_per_package > 0 ? l.count_per_package : null;
      if (cpp != null && n === q * cpp) {
        return { clean: false, units: q, subUnits: cpp, note: `${calc}. Prisen gjelder per stk: ${num(q)} ${unit} = ${n} stk.` };
      }
      if (MULTI.has(unit) && Number.isInteger(q) && n % q === 0 && n / q >= 2) {
        return { clean: false, units: q, subUnits: n / q, note: `${calc}. Trolig 1 ${unit} = ${n / q} stk.` };
      }
      if (n !== q) return { clean: false, units: n, subUnits: null, note: `${calc}. Trolig ${n} ${unit ? plural(unit, n) : "enheter"}, ikke ${num(q)}.` };
    }
  }
  return { clean: false, units: null, subUnits: null, note: stored ?? issues[0]?.message ?? "Tallene på linjen går ikke opp." };
}

/** Pris per fakturaens enhet og per stk når regnestykket viser antall i beholderen. Null = ukjent. */
export function unitPrices(l: Pick<MathLine, "total_amount" | "unit">, m: LineMath | null): { amount: number; unit: string }[] {
  if (!m || m.units == null || !(m.units > 0) || !fin(l.total_amount) || !(l.total_amount > 0)) return [];
  const unit = (normalizeUnit(l.unit) ?? (l.unit ?? "").trim().toLowerCase()) || "enhet";
  const out = [{ amount: l.total_amount / m.units, unit }];
  if (m.subUnits != null && m.subUnits > 1) out.push({ amount: l.total_amount / (m.units * m.subUnits), unit: "stk" });
  return out;
}
