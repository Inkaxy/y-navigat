// Feltbevisst tolkning av tall slik de står TRYKT på fakturaen. Ren modul (vitest + Deno).
//
// Hvorfor: Tripletex-PDF-er kan ha punktum som desimaltegn i mengdekolonnen («10.000» = 10 kg)
// og norsk komma i beløpskolonnene («1 100,00») på SAMME side. Et dokumentomfattende format
// kan ikke antas, og «siffer.3 siffer» kan ikke blindt tolkes som tusenskille.
//
// Regler:
//  - JSON-tall endres aldri. Bare råtekst (token) tolkes.
//  - Entydige former tolkes direkte: «1 234,50», «1.234,50», «1,234.50», «12,5», «110.00», «1 700», «1.234.567».
//  - «siffer{1,3}.siffer{3}» og «siffer{1,3},siffer{3}» (f.eks. «10.000», «1,100») er TVETYDIGE:
//    kandidatene er desimal og tusenskille. Ugyldige tusengrupper («1 23,00», «1.23.456») avvises.
//  - Negative tall: ledende minus, «−», parentes og etterstilt minus. Fortegnet bevares.
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

const WS = /[\s\u00a0\u202f]/g;
const INVALID: TokenParse = { value: null, candidates: [], ambiguous: false };
const one = (n: number): TokenParse => (Number.isFinite(n) ? { value: n, candidates: [n], ambiguous: false } : INVALID);

/** Heltallsdel med valgfritt tusenskille: første gruppe 1–3 siffer, deretter grupper på nøyaktig 3. */
function groupedInt(s: string, sep: string | null): string | null {
  if (sep == null) return /^\d+$/.test(s) ? s : null;
  const parts = s.split(sep);
  if (parts.length === 1) return /^\d+$/.test(s) ? s : null;
  if (!/^\d{1,3}$/.test(parts[0]) || !parts.slice(1).every((p) => /^\d{3}$/.test(p))) return null;
  return parts.join("");
}

/** Fortegn slik det er trykt: «-12», «−12», «(12)», «12-». Mer enn én form er ugyldig. */
function splitSign(s0: string): { neg: boolean; body: string } | null {
  let s = s0.replace(/\u2212/g, "-").trim();
  const stripCur = (x: string) => x.replace(/^(kr\.?|nok)\s*/i, "").replace(/\s*(kr\.?|nok)$/i, "").trim();
  s = stripCur(s);
  let signs = 0;
  if (/^\(.*\)$/.test(s)) { s = stripCur(s.slice(1, -1)); signs++; }
  if (/\d,-$/.test(s)) s = s.slice(0, -2); // «100,-» = hele kroner, ikke minus
  else if (/\d\s*-$/.test(s)) { s = s.replace(/\s*-$/, ""); signs++; }
  if (/^[-+]/.test(s)) { if (s[0] === "-") signs++; s = s.slice(1).trim(); }
  if (signs > 1 || /[-+()]/.test(s)) return null;
  return { neg: signs === 1, body: s };
}

/**
 * Tolk ett trykt tall-token. Returnerer kandidater i stedet for å gjette ved tvetydighet.
 * Negative beløp: «-1 234,50», «−1 234,50», «(1 234,50)» og etterstilt «1 234,50-».
 * Tusenskille (mellomrom/NBSP/punktum/komma) må ha gyldige 3-siffergrupper, ellers ugyldig.
 * «d{1,3}.ddd» og «d{1,3},ddd» uten annet skilletegn er tvetydige (desimal eller tusen),
 * unntatt når heltallsdelen er 0 («0,500» = 0,5).
 */
export function parseNumberToken(input: unknown): TokenParse {
  if (typeof input === "number") return one(input);
  if (typeof input !== "string") return INVALID;
  const sg = splitSign(input);
  if (!sg) return INVALID;
  const s = sg.body.replace(WS, " ");
  if (s === "" || !/^\d[\d., ]*$/.test(s) || !/\d$/.test(s)) return INVALID;
  const sign = sg.neg ? -1 : 1;
  const hasSpace = s.includes(" ");
  const nComma = (s.match(/,/g) ?? []).length;
  const nDot = (s.match(/\./g) ?? []).length;
  const fin = (intPart: string | null, dec: string | null): TokenParse => {
    if (intPart == null || (dec != null && !/^\d+$/.test(dec))) return INVALID;
    return one(sign * Number(dec == null ? intPart : `${intPart}.${dec}`));
  };
  if (nComma > 0 && nDot > 0) {
    // Det siste skilletegnet er desimaltegnet og forekommer én gang; det andre er tusenskille.
    const decSep = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thSep = decSep === "," ? "." : ",";
    if ((decSep === "," ? nComma : nDot) !== 1 || hasSpace) return INVALID;
    const [i, d] = s.split(decSep);
    return fin(groupedInt(i, thSep), d);
  }
  const sep = nComma > 0 ? "," : nDot > 0 ? "." : null;
  if (sep == null) return fin(groupedInt(s, hasSpace ? " " : null), null);
  const n = sep === "," ? nComma : nDot;
  if (n > 1) return hasSpace ? INVALID : fin(groupedInt(s, sep), null);
  const [i, d] = s.split(sep);
  if (hasSpace) return fin(groupedInt(i, " "), d); // mellomrom er tusenskille ⇒ skilletegnet er desimal
  if (/^[1-9]\d{0,2}$/.test(i) && /^\d{3}$/.test(d)) {
    return { value: null, candidates: [sign * Number(`${i}.${d}`), sign * Number(i + d)], ambiguous: true };
  }
  return fin(/^\d+$/.test(i) ? i : null, d);
}

export interface NumberEvidence { field: NumberField; raw: string; value: number | null; how: "entydig" | "regnestykke" | "tvetydig" | "ugyldig" | "modelltall" }

export interface ResolvedNumbers {
  quantity: number | null;
  unit_price: number | null;
  total_amount: number | null;
  evidence: NumberEvidence[];
  /** Felt som var tvetydige og IKKE kunne avgjøres. */
  unresolved: NumberField[];
  /** Felt med trykt råtekst som ikke er et gyldig tall (f.eks. feil tusengruppe). Aldri erstattet av modelltallet. */
  invalid: NumberField[];
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
  const invalid: NumberField[] = [];
  for (const f of fields) {
    const e = parsed.get(f)!;
    if (e.raw == null) {
      if (typeof l[f] === "number") evidence.push({ field: f, raw: String(l[f]), value: out[f], how: "modelltall" });
      continue;
    }
    const how = e.p.ambiguous ? (out[f] == null ? "tvetydig" : "regnestykke") : e.p.candidates.length === 0 ? "ugyldig" : "entydig";
    if (how === "tvetydig") unresolved.push(f);
    if (how === "ugyldig") invalid.push(f);
    evidence.push({ field: f, raw: e.raw, value: out[f], how });
  }
  return { quantity: out.quantity, unit_price: out.unit_price, total_amount: out.total_amount, evidence, unresolved, invalid };
}
