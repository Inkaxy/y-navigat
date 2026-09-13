// DENNE FILEN ER BYTE-IDENTISK MED supabase/functions/_shared/declaration-format.ts.
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
//
// MOTOREN GJETTER ALDRI KILDE. Generiske ord («mel», «malt», «semule»,
// «stivelse», «nøtter», «gluten») gir kontrollpunkt, ikke et kornslag.

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
  /**
   * Sant når punktet må avklares av et menneske FØR teksten kan brukes
   * automatisk (uavklart unntak eller uavklart terskel).
   */
  blocksAutoApply?: boolean;
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
  /** Punktene som må avklares før teksten kan brukes automatisk. */
  requiresConfirmation: DeclarationIssue[];
  /** Sant når minst ett punkt sperrer automatisk bruk. */
  blocked: boolean;
  /** Sant når teksten allerede var på ønsket form. */
  unchanged: boolean;
}

/**
 * Opplysninger motoren IKKE kan lese ut av teksten selv. Uten svar forblir
 * spørsmålet uavklart, og teksten kan ikke brukes automatisk.
 */
export interface DeclarationContext {
  /**
   * Bekreftet fra leverandør at soyaolje/-fett er HELRAFFINERT (vedlegg II,
   * unntak). true = unntaket gjelder, false = soya skal framheves,
   * undefined = uavklart.
   */
  refinedSoyFullyRefined?: boolean;
  /**
   * Bekreftet nivå av sulfitt/svoveldioksid i ferdigvaren.
   * true = over 10 mg/kg (skal merkes), false = under grensen,
   * undefined = uavklart.
   */
  sulphitesAboveThreshold?: boolean;
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
  // Glutenholdig korn. «malt» og «semule» står bevisst IKKE her: de sier ikke
  // hvilket korn kilden er, og motoren skal ikke gjette (se AMBIGUOUS_TERMS).
  { code: "gluten_wheat", term: "hvete" },
  { code: "gluten_wheat", term: "durum" },
  { code: "gluten_spelt", term: "spelt" },
  { code: "gluten_rye", term: "rug" },
  { code: "gluten_barley", term: "bygg", notFollowedBy: ["e", "et", "ing"] },
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
  // Generisk «nøtter» framheves, men arten må navngis — se AMBIGUOUS_TERMS.
  { code: "nuts_unspecified", term: "nøtter" },
  { code: "nuts_unspecified", term: "nøtt" },
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

/** Ord der soyaunntaket for helraffinert olje/fett kan være aktuelt. */
const REFINED_SOY_WORDS = ["soyaolje", "soyafett", "soyaoljen"];

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
  "spelt", "speltmel", "durum", "durumhvete", "semule", "semulegryn",
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
    pattern: /(^|[^\p{L}])malt(ekstrakt|mel|sirup)?([^\p{L}]|$)/iu,
    code: "ambiguous_malt",
    message:
      "«malt» uten kornslag: malt lages oftest av bygg, men kan også være hvete eller rug. Kornet må stå i teksten (f.eks. «byggmalt») — motoren gjetter ikke kilden.",
  },
  {
    pattern: /(^|[^\p{L}])semule(gryn)?([^\p{L}]|$)/iu,
    code: "ambiguous_semolina",
    message:
      "«semule/semulegryn» sier ikke hvilket korn kilden er. Er det durumhvete, skal hvete stå i teksten — motoren legger det ikke til selv.",
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
  // Kjente tagger normaliseres uansett skrivemåte: <STRONG>, <B >, </Em>.
  text = text.replace(/<\s*(\/?)\s*(strong|b|em|i)\s*>/gi, (_m, slash: string) =>
    slash ? "</strong>" : "<strong>",
  );
  text = text.replace(/<\s*br\s*\/?\s*>/gi, " ");
  text = text.replace(/<\s*\/?\s*p[^>]*>/gi, " ");
  text = text.replace(/<(?!\/?strong>)[^>]*>/g, "");
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

/** Hele ordet et treff ligger inni, i små bokstaver. */
function wordAround(text: string, start: number, end: number): string {
  const head = text.slice(0, start).match(/\p{L}+$/u);
  const tail = text.slice(end).match(/^\p{L}+/u);
  return ((head?.[0] ?? "") + text.slice(start, end) + (tail?.[0] ?? "")).toLocaleLowerCase("nb-NO");
}

/** Deler ett segment i deler der allergenordene er uthevet. */
function boldAllergensInText(
  text: string,
  found: Set<string>,
  ctx: DeclarationContext,
  notes: Set<string>,
): DeclarationSegment[] {
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
        const fullWord = wordAround(text, start, end);
        if (!entry.compoundWords?.includes(fullWord)) continue;
      }
      const after = text.slice(end);
      if (entry.notFollowedBy?.some((s) => after.toLocaleLowerCase("nb-NO").startsWith(s))) continue;

      // Unntaket for helraffinert soyaolje gjelder BARE når det er bekreftet.
      if (entry.code === "soybeans") {
        const fullWord = wordAround(text, start, end);
        if (REFINED_SOY_WORDS.includes(fullWord)) {
          if (ctx.refinedSoyFullyRefined === true) {
            notes.add("soy_refined_confirmed");
            continue;
          }
          notes.add(
            ctx.refinedSoyFullyRefined === false ? "soy_not_refined" : "soy_refined_unresolved",
          );
        }
      }

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

/**
 * Deler teksten i ingredienser på toppnivå. Komma inne i parentes hører til
 * ingrediensen foran, slik at «speltmel (hvete), vann» blir to enheter.
 */
export function splitIngredientItems(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let buffer = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      items.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  items.push(buffer);
  return items.filter((s) => s.trim());
}

function collectIssues(
  plain: string,
  codes: Set<string>,
  ctx: DeclarationContext,
  notes: Set<string>,
): DeclarationIssue[] {
  const issues: DeclarationIssue[] = [];
  const lower = plain.toLocaleLowerCase("nb-NO");
  const items = splitIngredientItems(plain);

  for (const a of AMBIGUOUS_TERMS) {
    if (a.pattern.test(plain)) {
      issues.push({ code: a.code, severity: "warning", message: a.message });
    }
  }

  // Hvetetilhørighet må stå på SAMME ingrediens — «speltmel, hvetemel» er ikke nok.
  const speltItems = items.filter((i) => /(^|[^\p{L}])spelt/iu.test(i) && !/hvete/i.test(i));
  if (speltItems.length) {
    issues.push({
      code: "spelt_is_wheat",
      severity: "warning",
      term: "spelt",
      message:
        "Spelt er en hvetesort. Hvetetilhørigheten må stå på samme ingrediens, f.eks. «speltmel (hvete)» — at hvete nevnes et annet sted i lista er ikke nok.",
    });
  }
  const durumItems = items.filter((i) => /durum/i.test(i) && !/hvete/i.test(i));
  if (durumItems.length) {
    issues.push({
      code: "durum_is_wheat",
      severity: "warning",
      term: "durum",
      message:
        "Durum er hvete. Skriv «durumhvete» eller «durum (hvete)» på samme ingrediens — hvete nevnt lenger ned i lista teller ikke.",
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

  // Soya: unntaket for helraffinert olje krever bekreftelse fra leverandør.
  if (notes.has("soy_refined_confirmed")) {
    issues.push({
      code: "soy_refined_exempt",
      severity: "info",
      term: "soyaolje",
      message:
        "Helraffinert soyaolje/-fett er registrert som bekreftet og er derfor ikke uthevet (unntak i vedlegg II).",
    });
  }
  if (notes.has("soy_not_refined")) {
    issues.push({
      code: "soy_not_refined",
      severity: "warning",
      term: "soyaolje",
      message:
        "Soyaoljen er registrert som ikke helraffinert. Soya er derfor uthevet som allergen.",
    });
  }
  if (notes.has("soy_refined_unresolved")) {
    issues.push({
      code: "soy_refined_unresolved",
      severity: "warning",
      term: "soyaolje",
      blocksAutoApply: true,
      message:
        "Uavklart: unntaket for helraffinert soyaolje gjelder bare når leverandøren har bekreftet at oljen er helraffinert. Til det er avklart holdes soya uthevet, og teksten kan ikke brukes automatisk.",
    });
  }

  if (codes.has("sulphites") || SULPHITE_E_NUMBERS.test(plain)) {
    if (ctx.sulphitesAboveThreshold === true) {
      issues.push({
        code: "sulphite_above_threshold",
        severity: "info",
        term: "sulfitt",
        message: "Registrert over 10 mg/kg (10 mg/l): sulfitt/svoveldioksid skal merkes og er uthevet.",
      });
    } else if (ctx.sulphitesAboveThreshold === false) {
      issues.push({
        code: "sulphite_below_threshold",
        severity: "info",
        term: "sulfitt",
        message:
          "Registrert under 10 mg/kg (10 mg/l). Da er merkeplikten ikke utløst — vurder faglig om ordet likevel skal stå.",
      });
    } else {
      issues.push({
        code: "sulphite_threshold_unresolved",
        severity: "warning",
        term: "sulfitt",
        blocksAutoApply: true,
        message:
          "Uavklart: sulfitt/svoveldioksid skal merkes over 10 mg/kg eller 10 mg/l i ferdigvaren. Nivået er ikke registrert, så teksten kan ikke brukes automatisk før det er kontrollert mot datablad.",
      });
    }
  }
  return issues;
}

export interface FormatOptions {
  /** Slå av standardisering av ordform (bare utheving kjøres). */
  canonicalizeKnownWords?: boolean;
  /** Opplysninger motoren ikke kan lese ut av teksten. */
  context?: DeclarationContext;
}

/** Hovedinngangen: gjør en råtekst om til NBhubs standardform. */
export function formatDeclaration(
  input: string | null | undefined,
  options: FormatOptions = {},
): FormattedDeclaration {
  const original = String(input ?? "");
  const canonicalize = options.canonicalizeKnownWords !== false;
  const ctx = options.context ?? {};
  const parsed = parseDeclarationInput(original);
  const codes = new Set<string>();
  const notes = new Set<string>();

  const segments: DeclarationSegment[] = [];
  for (const seg of parsed) {
    const text = canonicalize ? canonicalizeWords(seg.text) : seg.text;
    if (seg.bold) {
      // Allerede uthevet tekst beholdes uthevet.
      segments.push({ text, bold: true });
      boldAllergensInText(text, codes, ctx, notes);
      continue;
    }
    for (const part of boldAllergensInText(text, codes, ctx, notes)) segments.push(part);
  }

  const merged = mergeSegments(segments);
  const plainText = merged.map((s) => s.text).join("");
  const issues = collectIssues(plainText, codes, ctx, notes);

  // Er ALT uthevet, skiller ingenting allergenet fra resten av lista.
  const hasText = merged.some((s) => s.text.trim());
  const everythingBold = hasText && merged.every((s) => s.bold || !s.text.trim());
  if (everythingBold) {
    issues.unshift({
      code: "bold_whole_list",
      severity: "warning",
      blocksAutoApply: true,
      message:
        "Hele ingredienslista er uthevet. Da skiller ingenting allergenene fra de andre ingrediensene (art. 21). Fjern uthevingen på det som ikke er allergen.",
    });
  }

  const markerText = segmentsToMarkerText(merged);
  const requiresConfirmation = issues.filter((i) => i.blocksAutoApply);

  return {
    original,
    segments: merged,
    markerText,
    html: segmentsToHtml(merged),
    plainText,
    allergenCodes: Array.from(codes).sort(),
    issues,
    requiresConfirmation,
    blocked: requiresConfirmation.length > 0,
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

/**
 * Gjør HTML eller ren tekst om til *stjernetekst* UTEN å endre ordform eller
 * legge til utheving. Brukes der lagret tekst skal videre til forhåndsvisning,
 * PDF og utskrift med uthevingen i behold.
 */
export function htmlToMarkerText(input: string | null | undefined): string {
  return segmentsToMarkerText(parseDeclarationInput(input));
}

/** Kobling mellom motorens koder og allergennavnene som er registrert på råvarene. */
export const DECLARATION_CODE_TO_ALLERGEN: Record<string, string> = {
  gluten_wheat: "hvete",
  gluten_spelt: "spelt",
  gluten_rye: "rug",
  gluten_barley: "bygg",
  gluten_oats: "havre",
  milk: "melk",
  eggs: "egg",
  peanuts: "peanøtter",
  soybeans: "soya",
  sesame: "sesam",
  celery: "selleri",
  mustard: "sennep",
  lupin: "lupin",
  fish: "fisk",
  crustaceans: "krepsdyr",
  molluscs: "bløtdyr",
  sulphites: "svoveldioksid",
};

export interface MetadataConflict {
  allergen: string;
  direction: "text_only" | "metadata_only";
  message: string;
}

/**
 * Deterministisk sammenligning mellom teksten og de registrerte allergendataene.
 * Dette kjøres uavhengig av modellen, slik at et avvik aldri er avhengig av at
 * modellen husket å nevne det.
 */
export function compareTextAgainstMetadata(
  textAllergenCodes: readonly string[],
  registeredAllergens: readonly string[],
): MetadataConflict[] {
  const inText = new Set<string>();
  for (const code of textAllergenCodes) {
    const name = DECLARATION_CODE_TO_ALLERGEN[code];
    if (name) inText.add(name);
  }
  const registered = new Set(
    registeredAllergens.map((a) => a.toLocaleLowerCase("nb-NO").trim()).filter(Boolean),
  );

  const out: MetadataConflict[] = [];
  for (const name of inText) {
    if (!registered.has(name)) {
      out.push({
        allergen: name,
        direction: "text_only",
        message: `Teksten nevner ${name}, men ${name} er ikke registrert som allergen på råvarene. Enten mangler teksten dekning, eller så mangler råvaredataene.`,
      });
    }
  }
  for (const name of registered) {
    if (!inText.has(name) && Object.values(DECLARATION_CODE_TO_ALLERGEN).includes(name)) {
      out.push({
        allergen: name,
        direction: "metadata_only",
        message: `${name} er registrert som allergen på råvarene, men er ikke framhevet i teksten. Kontroller om ingrediensen mangler i deklarasjonen.`,
      });
    }
  }
  return out.sort((a, b) => a.allergen.localeCompare(b.allergen, "nb-NO"));
}
