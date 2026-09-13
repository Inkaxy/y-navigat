// DENNE FILEN ER BYTE-IDENTISK MED src/varer/lib/declarationProposal.ts.
//
// DETERMINISTISK KONTROLL AV FORSLAG FRA DEKLARASJONSASSISTENTEN
// ---------------------------------------------------------------------------
// Modellen får ALDRI skrive fritt over deklarasjonen. Den leverer avgrensede
// endringsforslag med kildeposisjon, og denne modulen avgjør — uten AI — om et
// forslag er lov. Alt som ikke er en tillatt endring blir gjort om til et
// åpent spørsmål som mennesket må ta stilling til.
//
// Faste regler modellen ikke kan overstyre:
//  - ingrediensrekkefølge, nesting, tall, prosent og E-numre er låst
//  - ingredienser kan ikke legges til eller fjernes
//  - kilde til E322, stivelse, gluten og nøtter kan ikke dikt es opp
//  - «kan inneholde spor av» kan aldri legges til av modellen

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

function foldForCompare(value: string): string {
  return value
    .toLocaleLowerCase("nb-NO")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ordsekvensen som IKKE får endres (ingrediensidentitet og rekkefølge). */
export function ingredientWordSequence(text: string): string[] {
  const words = text.toLocaleLowerCase("nb-NO").match(/\p{L}+/gu) ?? [];
  return words.map((w) => {
    for (const [canonical, aliases] of Object.entries(ALIAS_MAP)) {
      if (w === canonical) return canonical;
      if (aliases.some((a) => a.replace(/[\s-]/g, "") === w)) return canonical;
    }
    return w;
  });
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

function isAllowedChange(p: DeclarationProposal): string | null {
  const from = p.original;
  const to = p.suggested;
  if (!to.trim()) return "forslaget er tomt";
  if (to.length > from.length + 24) return "forslaget er vesentlig lengre enn kilden";
  if (/[<>*]/.test(to)) return "forslaget inneholder markup";
  if (numberSequence(from).join("|") !== numberSequence(to).join("|")) return "tall er endret";
  if (eNumberSequence(from).join("|") !== eNumberSequence(to).join("|")) return "E-nummer er endret";

  // 1) Kun store/små bokstaver eller mellomrom
  if (foldForCompare(from) === foldForCompare(to)) return null;

  // 2) Kjent alias
  const target = foldForCompare(to);
  const source = foldForCompare(from);
  const aliases = ALIAS_MAP[target];
  if (aliases && aliases.some((a) => foldForCompare(a) === source)) return null;

  // 3) Sammenskriving/deling av samme bokstaver (f.eks. «hvete mel» → «hvetemel»)
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

  // Uavhengig sluttkontroll: identitet, rekkefølge, tall og E-numre er låst.
  if (ingredientWordSequence(sourceText).join("|") !== ingredientWordSequence(appliedText).join("|")) {
    blocking.push("Ingredienser er lagt til, fjernet, byttet ut eller flyttet — forslaget kan ikke brukes.");
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

/** Streng kontroll av rå modellrespons før den brukes til noe som helst. */
export function parseAssistantOutput(raw: unknown): AssistantOutput {
  if (!raw || typeof raw !== "object") throw new Error("Svaret fra modellen har feil form");
  const o = raw as Record<string, unknown>;
  const proposals = Array.isArray(o.proposals) ? o.proposals : [];
  const findings = Array.isArray(o.allergen_findings) ? o.allergen_findings : [];
  const questions = Array.isArray(o.questions) ? o.questions : [];
  if (proposals.length > 60) throw new Error("For mange forslag i svaret");

  const kinds: ProposalKind[] = ["case", "spelling", "alias", "spacing"];
  const parsedProposals: DeclarationProposal[] = proposals.map((p) => {
    const x = p as Record<string, unknown>;
    const kind = kinds.includes(x.kind as ProposalKind) ? (x.kind as ProposalKind) : "spelling";
    return {
      kind,
      source_start: Number(x.source_start),
      source_end: Number(x.source_end),
      original: String(x.original ?? ""),
      suggested: String(x.suggested ?? ""),
      reason: String(x.reason ?? "").slice(0, 300),
    };
  });

  return {
    schema_version: String(o.schema_version ?? "1"),
    proposals: parsedProposals,
    allergen_findings: findings.slice(0, 30).map((f) => {
      const x = f as Record<string, unknown>;
      return {
        code: String(x.code ?? "").slice(0, 40),
        basis: x.basis === "verified" ? "verified" : "inferred",
        evidence: String(x.evidence ?? "").slice(0, 400),
        severity:
          x.severity === "critical" ? "critical" : x.severity === "warning" ? "warning" : "info",
      };
    }),
    questions: questions.slice(0, 30).map((q) => {
      const x = q as Record<string, unknown>;
      return {
        question: String(x.question ?? "").slice(0, 400),
        severity:
          x.severity === "critical" ? "critical" : x.severity === "warning" ? "warning" : "info",
      };
    }),
    source_fingerprint: String(o.source_fingerprint ?? ""),
  };
}
