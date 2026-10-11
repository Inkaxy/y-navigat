// Feltbevisst tolkning av tall slik de står TRYKT på fakturaen. Ren modul (vitest + Deno).
//
// Hvorfor: Tripletex-PDF-er kan ha punktum som desimaltegn i mengdekolonnen («10.000» = 10 kg)
// og norsk komma i beløpskolonnene («1 100,00») på SAMME side. Et dokumentomfattende format
// kan ikke antas, og «siffer.3 siffer» kan ikke blindt tolkes som tusenskille.
//
// Regler:
//  - JSON-tall endres aldri. Bare råtekst (token) tolkes.
//  - Entydige former tolkes direkte: «1 234,50», «1.234,50», «1,234.50», «12,5», «110.00», «1 700», «1.234.567».
//  - «siffer{1,3}.siffer{3}» (f.eks. «10.000», «1.100») er TVETYDIG: kandidatene er desimal og tusenskille.
//  - En tvetydig verdi avgjøres bare av linjens regnestykke (mengde × pris ≈ sum) med de andre feltene,
//    og bare når nøyaktig én kombinasjon av kandidater går opp. Ellers null + kontrollbehov.
//  - Beløp skaleres aldri for å treffe en kontrollsum.

export type NumberField = "quantity" | "unit_price" | "total_amount";

export interface TokenParse {
  /** Entydig verdi, eller null når tokenet er tvetydig eller ugyldig. */
  value: number | null;
  /** Mulige verdier (1 når entydig, 2 når tvetydig, 0 når ugyldig). */
  candidates: number[];
  ambiguous: boolean;
}

const clean = (s: string) => s.replace(/[\s\u00a0\u202f]/g, "").replace(/(kr|nok|,-)$/i, "").replace(/^(kr|nok)/i, "");

/** Tolk ett trykt tall-token. Returnerer kandidater i stedet for å gjette ved tvetydighet. */
export function parseNumberToken(input: unknown): TokenParse {
  if (typeof input === "number") return Number.isFinite(input) ? { value: input, candidates: [input], ambiguous: false } : { value: null, candidates: [], ambiguous: false };
  if (typeof input !== "string") return { value: null, candidates: [], ambiguous: false };
  const s = clean(input);
  if (s === "" || !/^[-+]?[\d.,]+$/.test(s)) return { value: null, candidates: [], ambiguous: false };
  const one = (txt: string): TokenParse => {
    const n = Number(txt);
    return Number.isFinite(n) ? { value: n, candidates: [n], ambiguous: false } : { value: null, candidates: [], ambiguous: false };
  };
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    return one(lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  }
  if (lastComma >= 0) {
    const commas = (s.match(/,/g) ?? []).length;
    if (commas > 1) return /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? one(s.replace(/,/g, "")) : { value: null, candidates: [], ambiguous: false };
    return one(s.replace(",", "."));
  }
  if (lastDot >= 0) {
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) return /^[-+]?\d{1,3}(\.\d{3})+$/.test(s) ? one(s.replace(/\./g, "")) : { value: null, candidates: [], ambiguous: false };
    if (/^[-+]?\d{1,3}\.\d{3}$/.test(s)) {
      const asDecimal = Number(s);
      const asThousands = Number(s.replace(".", ""));
      return { value: null, candidates: [asDecimal, asThousands], ambiguous: true };
    }
    return one(s);
  }
  return one(s);
}

export interface NumberEvidence { field: NumberField; raw: string; value: number | null; how: "entydig" | "regnestykke" | "tvetydig" | "modelltall" }

export interface ResolvedNumbers {
  quantity: number | null;
  unit_price: number | null;
  total_amount: number | null;
  evidence: NumberEvidence[];
  /** Felt som var tvetydige og IKKE kunne avgjøres. */
  unresolved: NumberField[];
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.005);

/**
 * Avgjør linjens tall fra råtekst (`*_raw`) når den finnes, ellers modellens tall uendret.
 * `factor` er innhold per enhet når prisen gjelder per grunnenhet (per_base), ellers 1.
 */
export function resolveLineNumbers(l: Record<string, unknown>, factor = 1): ResolvedNumbers {
  const fields: NumberField[] = ["quantity", "unit_price", "total_amount"];
  const parsed = new Map<NumberField, { raw: string | null; p: TokenParse }>();
  for (const f of fields) {
    const raw = l[`${f}_raw`];
    if (typeof raw === "string" && raw.trim()) parsed.set(f, { raw: raw.trim(), p: parseNumberToken(raw) });
    else if (typeof l[f] === "string" && String(l[f]).trim()) parsed.set(f, { raw: String(l[f]).trim(), p: parseNumberToken(l[f]) });
    else parsed.set(f, { raw: null, p: parseNumberToken(l[f]) });
  }
  const evidence: NumberEvidence[] = [];
  const out: Record<NumberField, number | null> = { quantity: null, unit_price: null, total_amount: null };
  const ambiguous = fields.filter((f) => parsed.get(f)!.p.ambiguous);
  if (ambiguous.length) {
    const cand = (f: NumberField) => parsed.get(f)!.p.candidates;
    const fits: Record<NumberField, number>[] = [];
    if (fields.every((f) => cand(f).length > 0)) {
      for (const q of cand("quantity")) for (const p of cand("unit_price")) for (const t of cand("total_amount")) {
        if (near(q * factor * p, Math.abs(t)) || near(-q * factor * p, t)) fits.push({ quantity: q, unit_price: p, total_amount: t });
      }
    }
    // Unike løsninger per tvetydig felt; avgjøres bare når hvert tvetydig felt har nøyaktig én verdi.
    for (const f of fields) {
      const e = parsed.get(f)!;
      if (!e.p.ambiguous) { out[f] = e.p.value; continue; }
      const vals = [...new Set(fits.map((x) => x[f]))];
      out[f] = vals.length === 1 ? vals[0] : null;
    }
  } else {
    for (const f of fields) out[f] = parsed.get(f)!.p.value;
  }
  const unresolved: NumberField[] = [];
  for (const f of fields) {
    const e = parsed.get(f)!;
    if (e.raw == null) {
      if (typeof l[f] === "number") evidence.push({ field: f, raw: String(l[f]), value: out[f], how: "modelltall" });
      continue;
    }
    const how = e.p.ambiguous ? (out[f] == null ? "tvetydig" : "regnestykke") : "entydig";
    if (how === "tvetydig") unresolved.push(f);
    evidence.push({ field: f, raw: e.raw, value: out[f], how });
  }
  return { quantity: out.quantity, unit_price: out.unit_price, total_amount: out.total_amount, evidence, unresolved };
}
