// DENNE MODULEN FINNES I TO BYTE-IDENTISKE KOPIER: src/varer/lib/declarationProposal.ts
// og supabase/functions/_shared/declaration-proposal.ts. En vitest sammenligner filene.
// DETERMINISTISK KONTROLL AV FORSLAG FRA DEKLARASJONSASSISTENTEN
// ---------------------------------------------------------------------------
// Modellen får ALDRI skrive fritt over deklarasjonen. Den leverer avgrensede
// endringsforslag med kildeposisjon, og denne modulen avgjør — uten AI — om et
// forslag er lov. Alt som ikke er en tillatt endring blir gjort om til et
// åpent spørsmål som mennesket må ta stilling til.
//
// Faste regler modellen ikke kan overstyre:
//  - ingrediensrekkefølge, nesting, tegnsetting, tall, prosent og E-numre er låst
//  - ingredienser kan ikke legges til eller fjernes
//  - kilde til E322, stivelse, gluten og nøtter kan ikke diktes opp
//  - «kan inneholde spor av» kan aldri legges til av modellen

/** Versjonen av svarformatet. Andre verdier avvises uten tolking. */
export const ASSISTANT_SCHEMA_VERSION = "1";

export type ProposalKind = "case" | "spelling" | "alias" | "spacing";

export interface DeclarationProposal {
  kind: ProposalKind;
  source_start: number;
  source_end: number;
  original: string;
  suggested: string;
  reason: string;
}

export interface AssistantFinding {
  code: string;
  basis: "verified" | "inferred";
  evidence: string;
  severity: "info" | "warning" | "critical";
}

export interface AssistantQuestion {
  question: string;
  severity: "info" | "warning" | "critical";
}

export interface AssistantOutput {
  schema_version: string;
  proposals: DeclarationProposal[];
  allergen_findings: AssistantFinding[];
  questions: AssistantQuestion[];
  source_fingerprint: string;
}

export interface RejectedProposal {
  proposal: DeclarationProposal;
  reason: string;
}

export interface ValidationResult {
  /** Teksten etter at de godkjente forslagene er brukt. */
  appliedText: string;
  accepted: DeclarationProposal[];
  rejected: RejectedProposal[];
  /** Avvisninger som gjør at forslaget ikke kan brukes i det hele tatt. */
  blocking: string[];
}

/** Kjente skrivemåter som betyr det samme. Brukes bare i denne retningen. */
const ALIAS_MAP: Record<string, string[]> = {
  hvetemel: ["hvete mel", "hvetemjøl", "hvete-mel"],
  rugmel: ["rug mel", "rugmjøl"],
  havregryn: ["havre gryn"],
  hvetekli: ["hvete kli"],
  kulturmelk: ["kultur melk"],
  soyalecitin: ["soya lecitin", "soyalecithin"],
  emulgator: ["emulgeringsmiddel"],
};

/** Alle aliaser, lengst først, slik at flerordsaliaser slår til før enkeltord. */
const ALIAS_ENTRIES: { canonical: string; alias: string }[] = Object.entries(ALIAS_MAP)
  .flatMap(([canonical, aliases]) => aliases.map((alias) => ({ canonical, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);

function foldForCompare(value: string): string {
  return value
    .toLocaleLowerCase("nb-NO")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Slår sammen kjente alias til kanonisk form FØR ordene telles, slik at
 * «hvete mel» og «hvetemel» regnes som samme ingrediens. Aliasene inneholder
 * bare bokstaver, mellomrom og bindestrek, så sammenslåingen kan aldri krysse
 * komma, parentes eller tall.
 */
function canonicalizeAliasPhrases(text: string): string {
  let out = text.toLocaleLowerCase("nb-NO");
  for (const { canonical, alias } of ALIAS_ENTRIES) {
    const pattern = alias
      .split(/[\s-]+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s-]+");
    out = out.replace(new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, "giu"), canonical);
  }
  return out;
}

/** Ordsekvensen som IKKE får endres (ingrediensidentitet og rekkefølge). */
export function ingredientWordSequence(text: string): string[] {
  return canonicalizeAliasPhrases(text).match(/\p{L}+/gu) ?? [];
}

/** Alle tall i teksten, i rekkefølge — «5,0» og «5.0» regnes likt. */
export function numberSequence(text: string): string[] {
  const hits = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return hits.map((n) => n.replace(",", "."));
}

/** Alle E-numre i rekkefølge, normalisert til «e471». */
export function eNumberSequence(text: string): string[] {
  const hits = text.match(/E\s?\d{3}[a-z]?/gi) ?? [];
  return hits.map((n) => n.toLowerCase().replace(/\s+/g, ""));
}

/** Tegnsetting og nesting — komma, parenteser og lignende er låst. */
export function punctuationSequence(text: string): string[] {
  return text.match(/[^\p{L}\p{N}\s*]/gu) ?? [];
}

function isAllowedChange(p: DeclarationProposal): string | null {
  const from = p.original;
  const to = p.suggested;
  if (!to.trim()) return "forslaget er tomt";
  if (to.length > from.length + 24) return "forslaget er vesentlig lengre enn kilden";
  if (/[<>*]/.test(to)) return "forslaget inneholder markup";
  if (punctuationSequence(from).join("") !== punctuationSequence(to).join("")) {
    return "tegnsetting eller nesting er endret";
  }
  if (numberSequence(from).join("|") !== numberSequence(to).join("|")) return "tall er endret";
  if (eNumberSequence(from).join("|") !== eNumberSequence(to).join("|")) return "E-nummer er endret";

  // 1) Kun store/små bokstaver eller mellomrom
  if (foldForCompare(from) === foldForCompare(to)) return null;

  // 2) Kjent alias — begge veier gjennom den kanoniske formen
  if (
    canonicalizeAliasPhrases(foldForCompare(from)) === canonicalizeAliasPhrases(foldForCompare(to))
  ) {
    return null;
  }

  // 3) Sammenskriving/deling av samme bokstaver (f.eks. «hvete mel» → «hvetemel»)
  const source = foldForCompare(from);
  const target = foldForCompare(to);
  if (source.replace(/[\s-]/g, "") === target.replace(/[\s-]/g, "")) return null;

  return "endringen er ikke en tillatt skrivemåtejustering";
}

function overlaps(a: DeclarationProposal, b: DeclarationProposal): boolean {
  return a.source_start < b.source_end && b.source_start < a.source_end;
}

/**
 * Sjekker alle forslag mot kildeteksten. Modellen kan ikke sette «gyldig» selv —
 * bare denne funksjonen avgjør hva som blir brukt.
 */
export function validateProposals(
  sourceText: string,
  proposals: DeclarationProposal[],
): ValidationResult {
  const accepted: DeclarationProposal[] = [];
  const rejected: RejectedProposal[] = [];
  const blocking: string[] = [];

  const sorted = [...proposals].sort((a, b) => a.source_start - b.source_start);
  let previous: DeclarationProposal | null = null;

  for (const p of sorted) {
    if (
      !Number.isInteger(p.source_start) ||
      !Number.isInteger(p.source_end) ||
      p.source_start < 0 ||
      p.source_end > sourceText.length ||
      p.source_end <= p.source_start
    ) {
      rejected.push({ proposal: p, reason: "ugyldig posisjon i kildeteksten" });
      continue;
    }
    if (sourceText.slice(p.source_start, p.source_end) !== p.original) {
      rejected.push({ proposal: p, reason: "kildeteksten stemmer ikke med forslaget" });
      continue;
    }
    if (previous && overlaps(previous, p)) {
      rejected.push({ proposal: p, reason: "overlapper et annet forslag" });
      continue;
    }
    const problem = isAllowedChange(p);
    if (problem) {
      rejected.push({ proposal: p, reason: problem });
      continue;
    }
    accepted.push(p);
    previous = p;
  }

  let appliedText = "";
  let cursor = 0;
  for (const p of accepted) {
    appliedText += sourceText.slice(cursor, p.source_start) + p.suggested;
    cursor = p.source_end;
  }
  appliedText += sourceText.slice(cursor);

  // Uavhengig sluttkontroll: identitet, rekkefølge, tegnsetting, tall og E-numre er låst.
  if (ingredientWordSequence(sourceText).join("|") !== ingredientWordSequence(appliedText).join("|")) {
    blocking.push("Ingredienser er lagt til, fjernet, byttet ut eller flyttet — forslaget kan ikke brukes.");
  }
  if (punctuationSequence(sourceText).join("") !== punctuationSequence(appliedText).join("")) {
    blocking.push("Tegnsetting eller nesting er endret — forslaget kan ikke brukes.");
  }
  if (numberSequence(sourceText).join("|") !== numberSequence(appliedText).join("|")) {
    blocking.push("Mengder eller prosenter er endret — forslaget kan ikke brukes.");
  }
  if (eNumberSequence(sourceText).join("|") !== eNumberSequence(appliedText).join("|")) {
    blocking.push("E-numre er endret — forslaget kan ikke brukes.");
  }

  if (blocking.length) {
    return { appliedText: sourceText, accepted: [], rejected, blocking };
  }
  return { appliedText, accepted, rejected, blocking };
}

/** Enkel, stabil kontrollsum av kildeteksten (brukes til å oppdage utdaterte svar). */
export function sourceFingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c + i, 2246822519) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

// --- Streng lesing av modellsvaret ----------------------------------------
// Ingenting rettes opp, fylles ut eller tvinges til en verdi. Alt som ikke er
// nøyaktig på avtalt form blir avvist, slik at et delvis eller oppdiktet svar
// aldri kan bli til en endring i deklarasjonen.

const PROPOSAL_KEYS = ["kind", "source_start", "source_end", "original", "suggested", "reason"];
const FINDING_KEYS = ["code", "basis", "evidence", "severity"];
const QUESTION_KEYS = ["question", "severity"];
const TOP_KEYS = [
  "schema_version",
  "proposals",
  "allergen_findings",
  "questions",
  "source_fingerprint",
];
const KINDS: ProposalKind[] = ["case", "spelling", "alias", "spacing"];
const SEVERITIES = ["info", "warning", "critical"];

function fail(what: string): never {
  throw new Error(`Svaret fra modellen har feil form: ${what}`);
}

function objectWithExactKeys(value: unknown, keys: string[], what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(what);
  const o = value as Record<string, unknown>;
  for (const k of keys) if (!(k in o)) fail(`${what} mangler «${k}»`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${what} har ukjent felt «${k}»`);
  return o;
}

function boundedString(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") fail(`${what} må være tekst`);
  if (value.length > max) fail(`${what} er for lang`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${what} har ugyldig verdi`);
  return value as T;
}

function boundedArray(value: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} må være en liste`);
  if (value.length > max) fail(`${what} har for mange elementer`);
  return value;
}

export interface ParseOptions {
  /** Kontrollsummen forespørselen ble sendt med. Avvik avvises. */
  expectedFingerprint?: string;
}

/** Streng kontroll av rå modellrespons før den brukes til noe som helst. */
export function parseAssistantOutput(raw: unknown, options: ParseOptions = {}): AssistantOutput {
  const o = objectWithExactKeys(raw, TOP_KEYS, "svaret");

  const schemaVersion = boundedString(o.schema_version, 20, "schema_version");
  if (schemaVersion !== ASSISTANT_SCHEMA_VERSION) fail("ukjent schema_version");

  const fingerprint = boundedString(o.source_fingerprint, 64, "source_fingerprint");
  if (options.expectedFingerprint && fingerprint !== options.expectedFingerprint) {
    fail("kontrollsummen i svaret hører ikke til teksten som ble sendt");
  }

  const proposals = boundedArray(o.proposals, 60, "proposals").map((p) => {
    const x = objectWithExactKeys(p, PROPOSAL_KEYS, "et forslag");
    if (!Number.isInteger(x.source_start) || !Number.isInteger(x.source_end)) {
      fail("posisjonene i et forslag må være hele tall");
    }
    return {
      kind: enumValue(x.kind, KINDS, "kind"),
      source_start: x.source_start as number,
      source_end: x.source_end as number,
      original: boundedString(x.original, 400, "original"),
      suggested: boundedString(x.suggested, 400, "suggested"),
      reason: boundedString(x.reason, 300, "reason"),
    } satisfies DeclarationProposal;
  });

  const allergenFindings = boundedArray(o.allergen_findings, 30, "allergen_findings").map((f) => {
    const x = objectWithExactKeys(f, FINDING_KEYS, "et allergenfunn");
    return {
      code: boundedString(x.code, 40, "code"),
      basis: enumValue(x.basis, ["verified", "inferred"] as const, "basis"),
      evidence: boundedString(x.evidence, 400, "evidence"),
      severity: enumValue(x.severity, SEVERITIES as ("info" | "warning" | "critical")[], "severity"),
    } satisfies AssistantFinding;
  });

  const questions = boundedArray(o.questions, 30, "questions").map((q) => {
    const x = objectWithExactKeys(q, QUESTION_KEYS, "et spørsmål");
    return {
      question: boundedString(x.question, 400, "question"),
      severity: enumValue(x.severity, SEVERITIES as ("info" | "warning" | "critical")[], "severity"),
    } satisfies AssistantQuestion;
  });

  return {
    schema_version: schemaVersion,
    proposals,
    allergen_findings: allergenFindings,
    questions,
    source_fingerprint: fingerprint,
  };
}

/**
 * Modellen kan ikke selv avgjøre at et allergenfunn er «bekreftet». Funnet får
 * bare stå som bekreftet når koden OG beviset gjenfinnes i de registrerte
 * allergendataene serveren faktisk har hentet. Ellers nedgraderes det.
 */
export function substantiateFindings(
  findings: AssistantFinding[],
  verified: { code: string; evidence: string }[],
): AssistantFinding[] {
  const codes = new Set(verified.map((v) => v.code.toLocaleLowerCase("nb-NO")));
  const evidence = verified.map((v) => v.evidence.toLocaleLowerCase("nb-NO"));
  return findings.map((f) => {
    if (f.basis !== "verified") return f;
    const code = f.code.toLocaleLowerCase("nb-NO");
    const claim = f.evidence.toLocaleLowerCase("nb-NO").trim();
    const codeKnown = codes.has(code);
    const evidenceKnown = claim.length > 0 && evidence.some((e) => e.includes(code) || claim.includes(e));
    if (codeKnown && evidenceKnown) return f;
    return {
      ...f,
      basis: "inferred",
      evidence: `${f.evidence} (ikke bekreftet mot registrerte allergendata)`,
    };
  });
}
