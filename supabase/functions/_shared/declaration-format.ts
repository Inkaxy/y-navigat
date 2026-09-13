// DENNE FILEN ER BYTE-IDENTISK MED src/varer/lib/declarationFormat.ts.
// Endres den ene, må den andre endres likt — en vitest sammenligner filene.
//
// DETERMINISTISK FORMATERING AV INGREDIENSDEKLARASJON
// ---------------------------------------------------------------------------
// Motoren er REGELSTYRT og kjører lokalt uten AI. Den brukes til:
//  - direkte forhåndsvisning mens noen skriver manuell deklarasjon
//  - kontroll av forslag fra deklarasjonsassistenten (AI kan ikke overstyre den)
//  - felles gjengivelse til React, trygg HTML, *stjernetekst*, PDF og utskrift
//
// Faglig grunnlag (kontrollert 13.09.2026):
//  - forordning (EU) 1169/2011 art. 21 og vedlegg II (Mattilsynet: «Slik skal
//    allergenene merkes») — allergenet skal framheves i ingredienslisten.
//  - Kommisjonens kunngjøring 2017/C 428/01 (pkt. 9 og 17) om framheving og om
//    at unntakene i vedlegg II gjelder for bestemte, avledede ingredienser.
//
// VIKTIG: motoren gir formateringshjelp og kontrollpunkter. Den avgjør ikke om
// en etikett er lovlig — det er alltid en faglig vurdering hos bruker.

export type DeclarationSeverity = "info" | "warning" | "critical";

export interface DeclarationSegment {
  text: string;
  bold: boolean;
}

export interface DeclarationIssue {
  code: string;
  severity: DeclarationSeverity;
  message: string;
  /** Ordet/uttrykket i teksten som utløste punktet. */
  term?: string;
}

export interface FormattedDeclaration {
  /** Teksten slik den kom inn (uendret). */
  original: string;
  /** Ferdig formaterte segmenter — kilden alle gjengivelser bygger på. */
  segments: DeclarationSegment[];
  /** «Hvetemel (*hvete*)» — formatet som lagres på produkt/etikett. */
  markerText: string;
  /** Trygg HTML med bare <strong>. */
  html: string;
  /** Ren tekst uten utheving. */
  plainText: string;
  /** Allergenkoder motoren fant dekning for i teksten. */
  allergenCodes: string[];
  /** Kontrollpunkter — aldri en garanti for at etiketten er lovlig. */
  issues: DeclarationIssue[];
  /** Sant når teksten allerede var på ønsket form. */
  unchanged: boolean;
}

/** Kjente allergener med det norske ordet som skal framheves. */
interface AllergenTerm {
  code: string;
  term: string;
  /** Etterfølgende bokstaver som betyr at treffet IKKE er allergenet. */
  notFollowedBy?: string[];
  /**
   * Sammensatte ord der allergenordet står SIST og likevel er allergenet
   * («kulturmelk»). Ord som ikke står her – f.eks. «kokosmelk» – uthevet aldri.
   */
  compoundWords?: string[];
}

const ALLERGEN_TERMS: AllergenTerm[] = [
  // Glutenholdig korn
  { code: "gluten_wheat", term: "hvete" },
  { code: "gluten_wheat", term: "durum" },
  { code: "gluten_wheat", term: "semule" },
  { code: "gluten_spelt", term: "spelt" },
  { code: "gluten_rye", term: "rug" },
  { code: "gluten_barley", term: "bygg", notFollowedBy: ["e", "et", "ing"] },
  { code: "gluten_barley", term: "malt" },
  { code: "gluten_oats", term: "havre" },
  // Melk og egg
  {
    code: "milk",
    term: "melk",
    notFollowedBy: ["esyre", "syre"],
    compoundWords: [
      "kulturmelk",
      "helmelk",
      "skummetmelk",
      "lettmelk",
      "surmelk",
      "kjernemelk",
      "tørrmelk",
      "melkepulver",
    ],
  },
  { code: "milk", term: "fløte" },
  { code: "milk", term: "smør", notFollowedBy: ["brød"] },
  { code: "milk", term: "ost" },
  { code: "milk", term: "myse" },
  { code: "milk", term: "kesam" },
  { code: "eggs", term: "egg" },
  // Nøtter og peanøtter
  { code: "peanuts", term: "peanøtt" },
  { code: "nuts_almond", term: "mandel" },
  { code: "nuts_almond", term: "mandler" },
  { code: "nuts_hazelnut", term: "hasselnøtt" },
  { code: "nuts_walnut", term: "valnøtt" },
  { code: "nuts_cashew", term: "cashew" },
  { code: "nuts_pecan", term: "pekannøtt" },
  { code: "nuts_brazil", term: "paranøtt" },
  { code: "nuts_pistachio", term: "pistasj" },
  { code: "nuts_macadamia", term: "macadamia" },
  // Øvrige i vedlegg II
  { code: "soybeans", term: "soya" },
  { code: "sesame", term: "sesam" },
  { code: "celery", term: "selleri" },
  { code: "mustard", term: "sennep" },
  { code: "lupin", term: "lupin" },
  { code: "fish", term: "fisk" },
  { code: "crustaceans", term: "krepsdyr" },
  { code: "crustaceans", term: "reke" },
  { code: "molluscs", term: "bløtdyr" },
  { code: "sulphites", term: "sulfitt" },
  { code: "sulphites", term: "svoveldioksid" },
];

/**
 * Kjente ingrediensord i NBhubs standardform: små bokstaver.
 * Ord som IKKE står her blir aldri endret — merkenavn, enheter og E-numre
 * beholdes derfor akkurat slik de er skrevet.
 */
const KNOWN_WORDS: Record<string, string> = {};
const KNOWN_WORD_LIST = [
  "hvete", "hvetemel", "hvetekli", "hvetekim", "hvetestivelse", "hvetegluten", "sammalt",
  "rug", "rugmel", "rugsikt", "rugkli",
  "havre", "havremel", "havregryn", "havrekli",
  "bygg", "byggmel", "byggmalt", "malt", "maltekstrakt",
  "spelt", "speltmel", "durum", "durumhvete", "semulegryn",
  "vann", "salt", "gjær", "sukker", "surdeig", "vegetabilsk", "olje", "rapsolje",
  "solsikkeolje", "solsikkefrø", "linfrø", "sesamfrø", "sesam", "gresskarkjerner",
  "melk", "kulturmelk", "helmelk", "skummetmelk", "melkepulver", "melkesyre",
  "melkesyrekultur", "fløte", "smør", "ost", "myse", "mysepulver", "egg", "eggehvite",
  "eggeplomme", "soya", "soyamel", "soyaolje", "soyalecitin", "lecitin", "raffinert",
  "kokos", "kokosmelk", "kokosolje", "mandler", "hasselnøtter", "valnøtter",
  "peanøtter", "nøtter", "stivelse", "potetstivelse", "maisstivelse", "mel",
  "emulgator", "konserveringsmiddel", "surhetsregulerende", "bakepulver",
  "fargestoff", "antioksidant", "hevemiddel", "stabilisator", "fortykningsmiddel",
  "sulfitt", "svoveldioksid", "selleri", "sennep", "lupin", "fisk", "reker",
];
for (const w of KNOWN_WORD_LIST) KNOWN_WORDS[w] = w;

/** Uttrykk som er tvetydige: kilden går ikke fram av teksten. */
const AMBIGUOUS_TERMS: { pattern: RegExp; code: string; message: string }[] = [
  {
    pattern: /(^|[^\p{L}])mel([^\p{L}]|$)/iu,
    code: "ambiguous_flour",
    message:
      "«mel» uten kornslag: kilden må stå i teksten (f.eks. «hvetemel»). Motoren gjetter ikke kornslag.",
  },
  {
    pattern: /(^|[^\p{L}])nøtter([^\p{L}]|$)/iu,
    code: "ambiguous_nuts",
    message:
      "«nøtter» uten art: vedlegg II krever at nøttetypen navngis (f.eks. «hasselnøtter»).",
  },
  {
    pattern: /(^|[^\p{L}])stivelse([^\p{L}]|$)/iu,
    code: "ambiguous_starch",
    message:
      "«stivelse» uten kilde: hvis stivelsen kommer fra glutenholdig korn må kornet navngis.",
  },
  {
    pattern: /E\s?322/i,
    code: "ambiguous_e322",
    message:
      "E322 (lecitin) kan komme fra soya eller egg. Kilden må bekreftes mot datablad — motoren fyller den ikke inn.",
  },
  {
    pattern: /(^|[^\p{L}])gluten([^\p{L}]|$)/iu,
    code: "ambiguous_gluten",
    message: "«gluten» uten kornslag: korntypen må navngis.",
  },
];

const SULPHITE_E_NUMBERS = /E\s?2(2[0-8])/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Leser inn tekst som kan være ren tekst, *stjernemerket* tekst eller HTML med
 * <strong>, og gir segmenter. Alt annet markup fjernes.
 */
export function parseDeclarationInput(input: string | null | undefined): DeclarationSegment[] {
  const raw = String(input ?? "");
  if (!raw) return [];
  let text = raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<\/?(b|em|i)\s*>/gi, (m) => (m.startsWith("</") ? "</strong>" : "<strong>"));
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text.replace(/<\/?p[^>]*>/gi, " ");
  text = text.replace(/<(?!\/?strong\s*>)[^>]*>/gi, "");
  text = text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");

  const segments: DeclarationSegment[] = [];
  let bold = false;
  let buffer = "";
  const push = () => {
    if (buffer) segments.push({ text: buffer, bold });
    buffer = "";
  };
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("<strong>", i)) {
      push();
      bold = true;
      i += 7;
      continue;
    }
    if (text.startsWith("</strong>", i)) {
      push();
      bold = false;
      i += 8;
      continue;
    }
    if (text[i] === "*") {
      push();
      bold = !bold;
      continue;
    }
    buffer += text[i];
  }
  push();
  return mergeSegments(segments);
}

function mergeSegments(segments: DeclarationSegment[]): DeclarationSegment[] {
  const out: DeclarationSegment[] = [];
  for (const s of segments) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.bold === s.bold) last.text += s.text;
    else out.push({ text: s.text, bold: s.bold });
  }
  return out;
}

/** Setter kjente ingrediensord i standardform (små bokstaver). */
function canonicalizeWords(text: string): string {
  return text.replace(/\p{L}+/gu, (word, offset: number, whole: string) => {
    // E-numre og koder som «E471» / «B12» skal ikke røres.
    const next = whole[offset + word.length];
    if (next && /[0-9]/.test(next)) return word;
    const lower = word.toLocaleLowerCase("nb-NO");
    const known = KNOWN_WORDS[lower];
    return known ?? word;
  });
}

/** Deler ett segment i deler der allergenordene er uthevet. */
function boldAllergensInText(text: string, found: Set<string>): DeclarationSegment[] {
  interface Hit { start: number; end: number }
  const hits: Hit[] = [];

  for (const entry of ALLERGEN_TERMS) {
    const re = new RegExp(escapeRegExp(entry.term), "giu");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Treffet må starte på et ordstart — «kokosmelk» er ikke melk,
      // mens «hvetemel» er hvete. Unntaket er kjente sammensatte ord der
      // allergenordet står sist, f.eks. «kulturmelk».
      const before = text[start - 1];
      if (before && /\p{L}/u.test(before)) {
        const wordStart = text.slice(0, start).search(/\p{L}+$/u);
        const tail = text.slice(end).match(/^\p{L}+/u);
        const fullWord = text
          .slice(wordStart < 0 ? start : wordStart, end + (tail ? tail[0].length : 0))
          .toLocaleLowerCase("nb-NO");
        if (!entry.compoundWords?.includes(fullWord)) continue;
      }
      const after = text.slice(end);
      if (entry.notFollowedBy?.some((s) => after.toLocaleLowerCase("nb-NO").startsWith(s))) continue;
      hits.push({ start, end });
      found.add(entry.code);
    }
  }

  if (hits.length === 0) return [{ text, bold: false }];
  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  const out: DeclarationSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) out.push({ text: text.slice(cursor, hit.start), bold: false });
    out.push({ text: text.slice(hit.start, hit.end), bold: true });
    cursor = hit.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), bold: false });
  return out;
}

function collectIssues(plain: string, codes: Set<string>): DeclarationIssue[] {
  const issues: DeclarationIssue[] = [];
  const lower = plain.toLocaleLowerCase("nb-NO");

  for (const a of AMBIGUOUS_TERMS) {
    if (a.pattern.test(plain)) {
      issues.push({ code: a.code, severity: "warning", message: a.message });
    }
  }

  if (/(^|[^\p{L}])spelt/iu.test(plain) && !/hvete/i.test(plain)) {
    issues.push({
      code: "spelt_is_wheat",
      severity: "warning",
      term: "spelt",
      message:
        "Spelt er en hvetesort. Vurder å vise hvetetilhørigheten, f.eks. «speltmel (hvete)».",
    });
  }
  if (/durum/i.test(plain) && !/hvete/i.test(plain)) {
    issues.push({
      code: "durum_is_wheat",
      severity: "warning",
      term: "durum",
      message: "Durum er hvete. Vurder «durumhvete» eller «durum (hvete)».",
    });
  }
  if (/melkesyre/i.test(plain)) {
    issues.push({
      code: "lactic_acid_not_milk",
      severity: "info",
      term: "melkesyre",
      message: "«melkesyre» er ikke melk og er derfor ikke uthevet.",
    });
  }
  if (/kokos/i.test(lower)) {
    issues.push({
      code: "coconut_not_nut",
      severity: "info",
      term: "kokos",
      message:
        "Kokos er ikke en nøtt i vedlegg II, og «kokosmelk» er ikke melk. Ingen utheving er lagt til.",
    });
  }
  if (/raffinert\s+soya/i.test(plain) || /soyaolje/i.test(plain)) {
    issues.push({
      code: "soy_refined_exemption",
      severity: "info",
      term: "soyaolje",
      message:
        "Helraffinert soyaolje/-fett er unntatt i vedlegg II. Unntaket gjelder bare hvis leverandøren bekrefter at oljen er helraffinert — ellers skal soya utheves.",
    });
  }
  if (codes.has("sulphites") || SULPHITE_E_NUMBERS.test(plain)) {
    issues.push({
      code: "sulphite_threshold",
      severity: "info",
      term: "sulfitt",
      message:
        "Svoveldioksid og sulfitt skal merkes ved mer enn 10 mg/kg eller 10 mg/l i ferdigvaren. Kontroller nivået mot datablad.",
    });
  }
  return issues;
}

export interface FormatOptions {
  /** Slå av standardisering av ordform (bare utheving kjøres). */
  canonicalizeKnownWords?: boolean;
}

/** Hovedinngangen: gjør en råtekst om til NBhubs standardform. */
export function formatDeclaration(
  input: string | null | undefined,
  options: FormatOptions = {},
): FormattedDeclaration {
  const original = String(input ?? "");
  const canonicalize = options.canonicalizeKnownWords !== false;
  const parsed = parseDeclarationInput(original);
  const codes = new Set<string>();

  const segments: DeclarationSegment[] = [];
  for (const seg of parsed) {
    const text = canonicalize ? canonicalizeWords(seg.text) : seg.text;
    if (seg.bold) {
      // Allerede uthevet tekst beholdes uthevet.
      segments.push({ text, bold: true });
      boldAllergensInText(text, codes);
      continue;
    }
    for (const part of boldAllergensInText(text, codes)) segments.push(part);
  }

  const merged = mergeSegments(segments);
  const plainText = merged.map((s) => s.text).join("");
  const issues = collectIssues(plainText, codes);
  const markerText = segmentsToMarkerText(merged);

  return {
    original,
    segments: merged,
    markerText,
    html: segmentsToHtml(merged),
    plainText,
    allergenCodes: Array.from(codes).sort(),
    issues,
    unchanged: original.trim() === markerText.trim(),
  };
}

/** «Hvetemel (*hvete*)» — brukes av produkt, etikett-PDF og nettbutikk. */
export function segmentsToMarkerText(segments: DeclarationSegment[]): string {
  return segments.map((s) => (s.bold && s.text.trim() ? `*${s.text}*` : s.text)).join("");
}

/** Trygg HTML — bare <strong>, all annen tekst escapes. */
export function segmentsToHtml(segments: DeclarationSegment[]): string {
  return segments
    .map((s) => (s.bold && s.text.trim() ? `<strong>${escapeHtml(s.text)}</strong>` : escapeHtml(s.text)))
    .join("");
}

/** Ren tekst for utskrift uten uthevingsstøtte. */
export function segmentsToPlainText(segments: DeclarationSegment[]): string {
  return segments.map((s) => s.text).join("");
}
