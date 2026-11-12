/**
 * ALLERGENKONTROLL FOR MANUELL INGREDIENSLISTE
 * ---------------------------------------------------------------------------
 * Matinformasjonsforskriften (forordning (EU) nr. 1169/2011 art. 21): allergenene
 * i vedlegg II skal stå i ingredienslisten og være fremhevet slik at de skiller
 * seg tydelig ut, ved hver forekomst.
 *
 * Kontrollen sammenligner en manuell ingrediensliste med allergenene systemet
 * kjenner fra råvarene (beregnet `allergens.contains`). Den godtar fremhevingen
 * manuelle tekster bruker i dag: *stjerner*, **doble stjerner**, <strong>/<b> og
 * VERSALER. Ingen ny skrivemåte innføres.
 *
 * Kontrollen skal ikke gi falske sperrer: bøyningsformer og sammensatte ord
 * («hvetemel», «melkeprotein») teller som treff, og når allergenet bare finnes
 * som et beslektet ord («smør», «myse») uten fremheving, er det en advarsel,
 * ikke en feil. Bare «står ikke i teksten» og «står helt uten fremheving»
 * sperrer.
 */

export type AllergenFindingStatus = "ok" | "missing" | "not_highlighted" | "partly_highlighted" | "uncertain";

export interface AllergenFinding {
  allergen: string;
  status: AllergenFindingStatus;
  /** Ord i teksten der allergenet ble funnet. */
  words: string[];
  /** Ord der allergenet står uten fremheving. */
  unmarkedWords: string[];
}

export interface ManualAllergenCheck {
  /** «unknown»: allergenene fra råvarene er ikke kjent (ikke beregnet). */
  state: "unknown" | "checked";
  findings: AllergenFinding[];
  errors: AllergenFinding[];
  warnings: AllergenFinding[];
}

interface TermSpec {
  /** Selve allergennavnet og bøyningsstammer. Treff her er sikre. */
  terms: string[];
  /** Ingredienser som klart er allergenet, men ikke heter det. */
  synonyms?: string[];
  /** Ord som inneholder termen, men ikke er allergenet. */
  exclude?: string[];
}

const SPEC: Record<string, TermSpec> = {
  hvete: { terms: ["hvete"], synonyms: ["durum", "semule", "graham"], exclude: ["bokhvete"] },
  rug: { terms: ["rug"] },
  bygg: { terms: ["bygg"] },
  havre: { terms: ["havre"] },
  spelt: { terms: ["spelt"], synonyms: ["dinkel"] },
  "khorasan (kamut)": { terms: ["khorasan", "kamut"] },
  khorasan: { terms: ["khorasan", "kamut"] },
  gluten: { terms: ["gluten"], synonyms: ["hvete", "rug", "bygg", "havre", "spelt"], exclude: ["bokhvete"] },
  melk: {
    terms: ["melk", "mjølk"],
    synonyms: ["myse", "smør", "fløte", "ost", "kasein", "laktose", "yoghurt", "rømme", "kesam", "kvarg", "skyr", "kefir"],
    exclude: ["kokosmelk", "mandelmelk", "havremelk", "rismelk", "soyamelk", "kakaosmør", "peanøttsmør", "sheasmør", "nøttesmør"],
  },
  egg: { terms: ["egg"], synonyms: ["albumin"] },
  fisk: { terms: ["fisk"], synonyms: ["laks", "torsk", "ansjos", "tunfisk", "makrell", "sild", "sei"] },
  krepsdyr: { terms: ["krepsdyr"], synonyms: ["reke", "krabbe", "hummer", "kreps", "languster"] },
  bløtdyr: { terms: ["bløtdyr"], synonyms: ["skjell", "blekksprut", "østers", "snegl"] },
  peanøtter: { terms: ["peanøtt", "jordnøtt"] },
  mandler: { terms: ["mandel", "mandl"] },
  hasselnøtter: { terms: ["hasselnøtt"] },
  valnøtter: { terms: ["valnøtt"] },
  cashewnøtter: { terms: ["cashew"] },
  pekannøtter: { terms: ["pekan"] },
  paranøtter: { terms: ["paranøtt"] },
  pistasjenøtter: { terms: ["pistasj"] },
  macadamianøtter: { terms: ["macadamia"] },
  nøtter: { terms: ["nøtt"], exclude: ["peanøtt", "jordnøtt", "kokosnøtt", "muskatnøtt"] },
  soya: { terms: ["soya", "soja"] },
  selleri: { terms: ["selleri"] },
  sennep: { terms: ["sennep"] },
  sesamfrø: { terms: ["sesam"] },
  sesam: { terms: ["sesam"] },
  "svoveldioksid og sulfitt": { terms: ["sulfitt", "svoveldioksid"] },
  lupin: { terms: ["lupin"] },
};

const lc = (s: string) => s.toLocaleLowerCase("nb-NO");

function specFor(allergen: string): TermSpec {
  const key = lc(allergen).trim();
  if (SPEC[key]) return SPEC[key];
  const base = key.replace(/\(.*?\)/g, "").trim();
  if (SPEC[base]) return SPEC[base];
  // Ukjent navn: selve ordet, og en enkel stamme for flertall/bestemt form.
  const stem = base.length > 5 ? base.replace(/(ene|er|en|et|e|r)$/u, "") : base;
  return { terms: Array.from(new Set([base, stem].filter((t) => t.length >= 3))) };
}

/** Teksten uten markører, med et flagg per tegn for om tegnet er markert. */
export function markedPlainText(input: string): { plain: string; marked: boolean[] } {
  let plain = "";
  const marked: boolean[] = [];
  let strong = 0;
  let star = false;
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    const tag = /^<\/?\s*(strong|b)\s*>/i.exec(rest);
    if (tag) {
      strong += tag[0][1] === "/" ? -1 : 1;
      if (strong < 0) strong = 0;
      i += tag[0].length;
      continue;
    }
    const other = /^<[^>]*>/.exec(rest);
    if (other) {
      plain += " ";
      marked.push(false);
      i += other[0].length;
      continue;
    }
    const ent = /^&(amp|nbsp|lt|gt);/i.exec(rest);
    if (ent) {
      const map: Record<string, string> = { amp: "&", nbsp: " ", lt: "<", gt: ">" };
      plain += map[lc(ent[1])];
      marked.push(strong > 0 || star);
      i += ent[0].length;
      continue;
    }
    if (input[i] === "*") {
      const n = input[i + 1] === "*" ? 2 : 1;
      star = !star;
      i += n;
      continue;
    }
    plain += input[i];
    marked.push(strong > 0 || star);
    i += 1;
  }
  return { plain, marked };
}

interface Occurrence {
  start: number;
  end: number;
  word: string;
  synonym: boolean;
  highlighted: boolean;
}

function isUpper(s: string): boolean {
  return /\p{L}/u.test(s) && s === s.toLocaleUpperCase("nb-NO") && s !== s.toLocaleLowerCase("nb-NO");
}

function occurrencesFor(plain: string, marked: boolean[], spec: TermSpec): Occurrence[] {
  const out: Occurrence[] = [];
  const lower = lc(plain);
  const words = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = words.exec(plain)) !== null) {
    const wStart = m.index;
    const word = m[0];
    const wLower = lower.slice(wStart, wStart + word.length);
    // Utelukkede deler av ordet («bok» + «hvete»).
    const blocked: Array<[number, number]> = [];
    for (const ex of spec.exclude ?? []) {
      let at = wLower.indexOf(ex);
      while (at >= 0) {
        blocked.push([at, at + ex.length]);
        at = wLower.indexOf(ex, at + 1);
      }
    }
    const taken: Array<[number, number]> = [];
    const needles = [
      ...spec.terms.map((t) => ({ t, synonym: false })),
      ...(spec.synonyms ?? []).map((t) => ({ t, synonym: true })),
    ];
    for (const { t, synonym } of needles) {
      let at = wLower.indexOf(t);
      while (at >= 0) {
        const end = at + t.length;
        const inBlocked = blocked.some(([a, b]) => at >= a && end <= b);
        const overlaps = taken.some(([a, b]) => at < b && end > a);
        if (!inBlocked && !overlaps) {
          taken.push([at, end]);
          const s = wStart + at;
          const e = wStart + end;
          const allMarked = marked.slice(s, e).every(Boolean);
          out.push({ start: s, end: e, word, synonym, highlighted: allMarked || isUpper(plain.slice(s, e)) });
        }
        at = wLower.indexOf(t, at + 1);
      }
    }
  }
  return out;
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list));
}

/** Ren funksjon: kontrollerer den manuelle teksten mot allergenene fra råvarene. */
export function checkManualAllergens(
  text: string | null | undefined,
  known: readonly string[] | null | undefined,
): ManualAllergenCheck {
  if (known == null) return { state: "unknown", findings: [], errors: [], warnings: [] };
  const allergens = uniq(known.map((a) => a.trim()).filter(Boolean).map(lc));
  const { plain, marked } = markedPlainText(text ?? "");
  const findings: AllergenFinding[] = allergens.map((allergen) => {
    const occ = occurrencesFor(plain, marked, specFor(allergen));
    const words = uniq(occ.map((o) => o.word));
    const unmarkedWords = uniq(occ.filter((o) => !o.highlighted).map((o) => o.word));
    let status: AllergenFindingStatus;
    if (occ.length === 0) status = "missing";
    else if (occ.every((o) => o.highlighted)) status = "ok";
    else if (occ.some((o) => o.highlighted)) status = "partly_highlighted";
    else if (occ.some((o) => !o.synonym)) status = "not_highlighted";
    else status = "uncertain";
    return { allergen, status, words, unmarkedWords };
  });
  return {
    state: "checked",
    findings,
    errors: findings.filter((f) => f.status === "missing" || f.status === "not_highlighted"),
    warnings: findings.filter((f) => f.status === "partly_highlighted" || f.status === "uncertain"),
  };
}

/** Kort tekst per funn, til kortet, «Gjenstår» og godkjenningssperren. */
export function allergenFindingText(f: AllergenFinding): string {
  const w = f.unmarkedWords.slice(0, 3).map((x) => `«${x}»`).join(", ");
  switch (f.status) {
    case "missing":
      return `${f.allergen} er i råvarene, men står ikke i ingredienslisten.`;
    case "not_highlighted":
      return `${f.allergen} står uten fremheving (${w}).`;
    case "partly_highlighted":
      return `Ikke alle forekomster av ${f.allergen} er fremhevet (${w}).`;
    case "uncertain":
      return `${f.allergen} står bare som ${w} uten fremheving. Kontroller at det er riktig.`;
    default:
      return `${f.allergen} er fremhevet.`;
  }
}

export interface ManualAllergenIssueInput {
  check: ManualAllergenCheck;
  /** Råvarer som ikke er vurdert for allergener — kontrollen kan være ufullstendig. */
  unreviewedCount?: number | null;
}

/** Sperrer (må rettes) og advarsler (bør sjekkes) som tekst. */
export function manualAllergenIssues(input: ManualAllergenIssueInput): { errors: string[]; warnings: string[] } {
  const { check } = input;
  const warnings: string[] = [];
  if (check.state === "unknown") {
    warnings.push("Allergenkontrollen kan ikke kjøres før merkedata er beregnet fra råvarene.");
  }
  const n = input.unreviewedCount ?? 0;
  if (n > 0) {
    warnings.push(`${n} råvare${n === 1 ? "" : "r"} er ikke vurdert for allergener, så kontrollen kan være ufullstendig.`);
  }
  return {
    errors: check.errors.map(allergenFindingText),
    warnings: [...check.warnings.map(allergenFindingText), ...warnings],
  };
}
