// Hva slags PDF er dette? Avgjøres BARE av dokumentets eget innhold/metadata, aldri av at fakturaen kom via Tripletex.
// «leverandør-original» påstås aldri automatisk: uten tydelige kjennetegn er kilden ukjent.

export type DocumentOrigin = "tripletex_generert" | "ukjent";

const GENERATED_MARKERS: RegExp[] = [
  /\btripletex\b/i, // produsent/skaper-metadata eller bunntekst som navngir Tripletex
];

export interface OriginEvidence { producer?: string | null; creator?: string | null; text?: string | null }

export function classifyDocumentOrigin(e: OriginEvidence): { origin: DocumentOrigin; evidence: string | null } {
  for (const [field, v] of [["Produsent", e.producer], ["Laget med", e.creator]] as const) {
    if (v && GENERATED_MARKERS.some((r) => r.test(v))) return { origin: "tripletex_generert", evidence: `${field}: ${v.slice(0, 80)}` };
  }
  const t = (e.text ?? "").slice(0, 20000);
  const m = /(generert|laget|produsert|created|generated)[^\n]{0,40}\btripletex\b/i.exec(t);
  if (m) return { origin: "tripletex_generert", evidence: m[0].slice(0, 80) };
  return { origin: "ukjent", evidence: null };
}

export const ORIGIN_LABEL: Record<DocumentOrigin, string> = {
  tripletex_generert: "Generert Tripletex-visning – ikke leverandørens original",
  ukjent: "Kilde ikke fastslått fra dokumentet",
};
